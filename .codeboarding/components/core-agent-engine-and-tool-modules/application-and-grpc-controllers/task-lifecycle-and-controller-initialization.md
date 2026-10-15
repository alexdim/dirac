---
component_id: 1.2.6
component_name: Task Lifecycle & Controller Initialization
---

# Task Lifecycle & Controller Initialization

## Component Description

Initializes controller sub-modules and manages agent task execution, steering, cancellation, user feedback, and task history operations.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/index-initializer.ts (lines 39-120)
```
	createConfig(
		controller: Pick<
			Controller,
			"task" | "postStateToWebview" | "postPresentationToWebview" | "toggleActModeForYoloMode" | "cancelTask"
		>,
		workspaceCwd?: string,
	): InitializerConfig {
		Session.reset() // Reset session on controller initialization
		PromptRegistry.getInstance() // Ensure prompts and tools are registered

		const stateManager = StateManager.get()
		const taskHistoryController = new TaskHistoryController(stateManager)

		const authController = new AuthController({
			stateManager,
			postStateToWebview: () => controller.postStateToWebview(),
			get task() {
				return controller.task
			},
		})
		const workspaceController = new WorkspaceController(stateManager, workspaceCwd)

		const taskController = new TaskController(
			{
				task: controller.task,
				controller: controller as unknown as Controller,
				stateManager,
				workspaceManager: undefined, // Will be set later by Controller
				workspaceCwd,
				backgroundCommandRunning: false,
				cancelInProgress: false,
				postStateToWebview: () => controller.postStateToWebview(),
				postPresentationToWebview: () => controller.postPresentationToWebview(),
				updateTaskHistory: (item: any) => taskHistoryController.updateTaskHistory(item),
				deleteTaskFromState: (id: string) => taskHistoryController.deleteTaskFromState(id),
				getTaskWithId: (id: string) => taskHistoryController.getTaskWithId(id),
				clearTaskSettings: () => stateManager.clearTaskSettings(),
				toggleActModeForYoloMode: () => controller.toggleActModeForYoloMode(),
			},
			undefined, // tryAcquireTaskLockWithRetry - use default
			undefined, // setupWorkspaceManager - use default
			undefined, // detectRoots - use default
			undefined, // getCwd - use default
			undefined, // getDesktopDir - use default
			undefined, // cleanupLegacyCheckpoints - use default
			async () => false, // Background command cancellation not available during initialization
		)

		const stateController = new StateController({
			stateManager,
			get task() {
				return controller.task
			},
			buildApiHandlerFn: buildApiHandler,
			postStateToWebviewFn: () => controller.postStateToWebview(),
			cancelTaskFn: () => controller.cancelTask(),
			captureModeSwitchFn: (taskId, mode) => void telemetryService.captureModeSwitch(taskId, mode),
		})

		stateManager.registerCallbacks({
			onPersistenceError: async ({ error }: PersistenceErrorEvent) => {
				// Just log - don't call reInitialize() (that sets isInitialized=false which
				// breaks running tasks) and don't show a warning (data is safe in memory
				// and will be retried automatically on the next debounced persistence).
				Logger.error("[Controller] Storage persistence failed (will retry):", error)
			},
			onSyncExternalChange: async () => {
				await controller.postStateToWebview()
			},
		})

		Logger.log("[Controller] DiracProvider instantiated")

		return {
			stateManager,
			taskHistoryController,
			authController,
			workspaceController,
			taskController,
			stateController,
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/task/newTask.ts (lines 16-79)
```
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<String> {
	const convertPlanActMode = (mode: PlanActMode): string => {
		return mode === PlanActMode.PLAN ? "plan" : "act"
	}

	const filteredTaskSettings: Partial<Settings> = Object.fromEntries(
		Object.entries({
			...request.taskSettings,
			...(request.taskSettings?.autoApprovalSettings && {
				autoApprovalSettings: (() => {
					// Merge with global settings to ensure complete settings for new task
					const globalSettings = controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
					const incomingSettings = request.taskSettings.autoApprovalSettings
					return {
						...globalSettings,
						...(incomingSettings.version !== undefined && {
							version: incomingSettings.version,
						}),
						...(incomingSettings.enableNotifications !== undefined && {
							enableNotifications: incomingSettings.enableNotifications,
						}),
						actions: {
							...globalSettings.actions,
							...(incomingSettings.actions
								? Object.fromEntries(Object.entries(incomingSettings.actions).filter(([_, v]) => v !== undefined))
								: {}),
						},
					}
				})(),
			}),
			...(request.taskSettings?.browserSettings && {
				browserSettings: {
					viewport: request.taskSettings.browserSettings.viewport || DEFAULT_BROWSER_SETTINGS.viewport,
					remoteBrowserHost: request.taskSettings.browserSettings.remoteBrowserHost,
					remoteBrowserEnabled: request.taskSettings.browserSettings.remoteBrowserEnabled,
					chromeExecutablePath: request.taskSettings.browserSettings.chromeExecutablePath,
					disableToolUse: request.taskSettings.browserSettings.disableToolUse,
					customArgs: request.taskSettings.browserSettings.customArgs,
				},
			}),
			...(request.taskSettings?.planModeReasoningEffort !== undefined && {
				planModeReasoningEffort: normalizeOpenaiReasoningEffort(request.taskSettings.planModeReasoningEffort),
			}),
			...(request.taskSettings?.actModeReasoningEffort !== undefined && {
				actModeReasoningEffort: normalizeOpenaiReasoningEffort(request.taskSettings.actModeReasoningEffort),
			}),
			...(request.taskSettings?.mode !== undefined && {
				mode: convertPlanActMode(request.taskSettings.mode),
			}),
			...(request.taskSettings?.customPrompt === "compact" && {
				customPrompt: "compact",
			}),
			...(request.taskSettings?.planModeApiProvider !== undefined && {
				planModeApiProvider: convertProtoToApiProvider(request.taskSettings.planModeApiProvider),
			}),
			...(request.taskSettings?.actModeApiProvider !== undefined && {
				actModeApiProvider: convertProtoToApiProvider(request.taskSettings.actModeApiProvider),
			}),
		}).filter(([_, value]) => value !== undefined),
	)

	const taskId = await controller.initTask(request.text, request.images, request.files, undefined, filteredTaskSettings)
	return String.create({ value: taskId || "" })
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/task/showTaskWithId.ts (lines 26-88)
```
export async function showTaskWithId(controller: Controller, request: StringRequest): Promise<TaskResponse> {
	try {
		const id = request.value

		// First check if task exists in global state for faster access
		const taskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
		const historyItem = taskHistory.find((item) => item.id === id)
		if (historyItem && isGoalHistoryItem(historyItem)) {
			await controller.selectGoal(id)
			await sendChatButtonClickedEvent()
			return goalHistoryItemToTaskResponse(historyItem)
		}

		// We need to initialize the task before returning data
		if (historyItem) {
			// Always initialize the task with the history item
			await controller.initTask(undefined, undefined, undefined, historyItem)

			// Send UI update to show the chat view
			await sendChatButtonClickedEvent()

			// Return task data for gRPC response
			return TaskResponse.create({
				id: historyItem.id,
				task: historyItem.task || "",
				ts: historyItem.ts || 0,
				isFavorited: historyItem.isFavorited || false,
				size: historyItem.size || 0,
				totalCost: historyItem.totalCost || 0,
				tokensIn: historyItem.tokensIn || 0,
				tokensOut: historyItem.tokensOut || 0,
				cacheWrites: historyItem.cacheWrites || 0,
				cacheReads: historyItem.cacheReads || 0,
			})
		}

		// If not in global state, fetch from storage
		const { historyItem: fetchedItem } = await controller.getTaskWithId(id)
		if (isGoalHistoryItem(fetchedItem)) throw new Error(`Run ${id} was loaded as a Goal through Task storage`)

		// Initialize the task with the fetched item
		await controller.initTask(undefined, undefined, undefined, fetchedItem)

		// Send UI update to show the chat view
		await sendChatButtonClickedEvent()

		return TaskResponse.create({
			id: fetchedItem.id,
			task: fetchedItem.task || "",
			ts: fetchedItem.ts || 0,
			isFavorited: fetchedItem.isFavorited || false,
			size: fetchedItem.size || 0,
			totalCost: fetchedItem.totalCost || 0,
			tokensIn: fetchedItem.tokensIn || 0,
			tokensOut: fetchedItem.tokensOut || 0,
			cacheWrites: fetchedItem.cacheWrites || 0,
			cacheReads: fetchedItem.cacheReads || 0,
		})
	} catch (error) {
		Logger.error("Error in showTaskWithId:", error)
		throw error
	}
}
```


## Source Files:

- `src/core/controller/index-initializer.ts`
- `src/core/controller/task/askResponse.ts`
- `src/core/controller/task/cancelBackgroundCommand.ts`
- `src/core/controller/task/cancelTask.ts`
- `src/core/controller/task/clearTask.ts`
- `src/core/controller/task/deleteAllTaskHistory.ts`
- `src/core/controller/task/deleteTasksWithIds.ts`
- `src/core/controller/task/executeQuickWin.ts`
- `src/core/controller/task/getTaskHistory.ts`
- `src/core/controller/task/getTotalTasksSize.ts`
- `src/core/controller/task/newTask.ts`
- `src/core/controller/task/showTaskWithId.ts`
- `src/core/controller/task/steerTask.ts`
- `src/core/controller/task/taskCompletionViewChanges.ts`
- `src/core/controller/task/taskFeedback.ts`
- `src/core/controller/task/toggleTaskFavorite.ts`

