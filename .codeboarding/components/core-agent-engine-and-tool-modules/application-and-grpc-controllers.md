---
component_id: 1.2
component_name: Application & gRPC Controllers
---

# Application & gRPC Controllers

## Component Description

Handles gRPC requests, UI state synchronization, model configuration endpoints, file and rule management, and workspace commands.

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

### /Users/highlands/pools/Development/dirac/src/core/controller/commands/addToDirac.ts (lines 13-51)
```
export async function addToDirac(controller: Controller, request: CommandContext, notebookContext?: string): Promise<Empty> {
	if (!request.selectedText?.trim() && !notebookContext) {
		Logger.log("❌ No text selected and no notebook context - returning early")
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)

	let input = `${fileMention}\n\`\`\`\n${request.selectedText}\n\`\`\``

	// Add notebook context if provided (includes cell JSON)
	if (notebookContext) {
		Logger.log("Adding notebook context for enhanced editing")
		input += `\n${notebookContext}`
	}

	if (request.diagnostics.length) {
		const problemsString = await singleFileDiagnosticsToProblemsString(filePath, request.diagnostics)
		input += `\nProblems:\n${problemsString}`
	}

	// Notebooks send immediately, regular adds just fill input
	if (notebookContext && controller.task) {
		const cardId = controller.task.stateView.lastWaitingCardId
		if (cardId) {
			await controller.task.submitCardResponse(cardId, DiracAskResponse.MESSAGE, input)
		}
	} else if (notebookContext) {
		await controller.initTask(input)
	} else {
		await sendAddToInputEvent(input)
	}

	Logger.log("addToDirac", request.selectedText, filePath, request.language)
	telemetryService.captureButtonClick("codeAction_addToChat", controller.task?.ulid)

	return {}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/models/updateApiConfigurationProto.ts (lines 15-42)
```
export async function updateApiConfigurationProto(
	controller: Controller,
	request: UpdateApiConfigurationRequest,
): Promise<Empty> {
	try {
		if (!request.apiConfiguration) {
			Logger.log("[APICONFIG: updateApiConfigurationProto] API configuration is required")
			throw new Error("API configuration is required")
		}

		const protoApiConfiguration = request.apiConfiguration

		const convertedApiConfigurationFromProto = convertProtoToApiConfiguration(protoApiConfiguration)

		const previousProfiles = controller.stateManager.getApiConfiguration().openAiCompatibleProfiles || []

		await applyApiConfigurationTransaction(controller, convertedApiConfigurationFromProto)
		recordSavedOpenAiCompatibleProfileChanges(controller.stateManager, previousProfiles)

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/models/apiConfigurationPersistence.ts (lines 77-79)
```
export function persistApiConfigurationPatch(stateManager: StateManager, configurationPatch: Partial<ApiConfiguration>): void {
	persistApiConfigurationAndMode(stateManager, configurationPatch)
}
```


## Source Files:

- `src/core/controller/auth/AuthController.ts`
- `src/core/controller/commands/addToDirac.ts`
- `src/core/controller/commands/explainWithDirac.ts`
- `src/core/controller/commands/fixWithDirac.ts`
- `src/core/controller/commands/improveWithDirac.ts`
- `src/core/controller/file/copyToClipboard.ts`
- `src/core/controller/file/createHook.ts`
- `src/core/controller/file/createRuleFile.ts`
- `src/core/controller/file/createSkillFile.ts`
- `src/core/controller/file/deleteHook.ts`
- `src/core/controller/file/deleteRuleFile.ts`
- `src/core/controller/file/deleteSkillFile.ts`
- `src/core/controller/file/getRelativePaths.ts`
- `src/core/controller/file/ifFileExistsRelativePath.ts`
- `src/core/controller/file/openDiskConversationHistory.ts`
- `src/core/controller/file/openFile.ts`
- `src/core/controller/file/openFileRelativePath.ts`
- `src/core/controller/file/openImage.ts`
- `src/core/controller/file/openMention.ts`
- `src/core/controller/file/refreshHooks.ts`
- `src/core/controller/file/refreshRules.ts`
- `src/core/controller/file/refreshSkills.ts`
- `src/core/controller/file/searchCommits.ts`
- `src/core/controller/file/searchFiles.ts`
- `src/core/controller/file/searchFilesHelpers.ts`
- `src/core/controller/file/selectFiles.ts`
- `src/core/controller/file/toggleAgentsRule.ts`
- `src/core/controller/file/toggleCursorRule.ts`
- `src/core/controller/file/toggleDiracRule.ts`
- `src/core/controller/file/toggleHook.ts`
- `src/core/controller/file/toggleSkill.ts`
- `src/core/controller/file/toggleWindsurfRule.ts`
- `src/core/controller/file/toggleWorkflow.ts`
- `src/core/controller/goal/pauseGoal.ts`
- `src/core/controller/goal/resumeGoal.ts`
- `src/core/controller/goal/selectGoal.ts`
- `src/core/controller/goal/sendGoalMessage.ts`
- `src/core/controller/goal/steerGoal.ts`
- `src/core/controller/goal/stopGoal.ts`
- `src/core/controller/grpc-handler.ts`
- `src/core/controller/grpc-recorder/grpc-recorder.builder.ts`
- `src/core/controller/grpc-recorder/grpc-recorder.ts`
- `src/core/controller/grpc-recorder/log-file-handler.ts`
- `src/core/controller/grpc-recorder/test-hooks.ts`
- `src/core/controller/grpc-recorder/types.ts`
- `src/core/controller/grpc-request-registry.ts`
- `src/core/controller/grpc-service.ts`
- `src/core/controller/index-initializer.ts`
- `src/core/controller/models/apiConfigurationPersistence.ts`
- `src/core/controller/models/apiConfigurationTransaction.ts`
- `src/core/controller/models/authenticateOpenAiCodex.ts`
- `src/core/controller/models/fetchAndCacheModels.ts`
- `src/core/controller/models/fetchOpenRouterModelRankings.ts`
- `src/core/controller/models/getAihubmixModels.ts`
- `src/core/controller/models/getLmStudioModels.ts`
- `src/core/controller/models/getOpenRouterEndpoints.ts`
- `src/core/controller/models/getVsCodeLmModels.ts`
- `src/core/controller/models/refreshBasetenModelsRpc.ts`
- `src/core/controller/models/refreshGithubCopilotModels.ts`
- `src/core/controller/models/refreshGroqModels.ts`
- `src/core/controller/models/refreshGroqModelsRpc.ts`
- `src/core/controller/models/refreshHuggingFaceModels.ts`
- `src/core/controller/models/refreshLiteLlmModels.ts`
- `src/core/controller/models/refreshLiteLlmModelsRpc.ts`
- `src/core/controller/models/refreshOpenAiCodexUsage.ts`
- `src/core/controller/models/refreshOpenAiModels.ts`
- `src/core/controller/models/refreshOpenRouterModels.ts`
- `src/core/controller/models/refreshOpenRouterModelsRpc.ts`
- `src/core/controller/models/refreshRequestyModels.ts`
- `src/core/controller/models/refreshVercelAiGatewayModels.ts`
- `src/core/controller/models/refreshVercelAiGatewayModelsRpc.ts`
- `src/core/controller/models/signOutOpenAiCodex.ts`
- `src/core/controller/models/subscribeToLiteLlmModels.ts`
- `src/core/controller/models/subscribeToOpenRouterModels.ts`
- `src/core/controller/models/updateApiConfiguration.ts`
- `src/core/controller/models/updateApiConfigurationPartial.ts`
- `src/core/controller/models/updateApiConfigurationProto.ts`
- `src/core/controller/slash/condense.ts`
- `src/core/controller/slash/getAvailableSlashCommands.ts`
- `src/core/controller/state/StateController.ts`
- `src/core/controller/state/StatePublicationQueue.ts`
- `src/core/controller/state/activateModelProviderPreset.ts`
- `src/core/controller/state/captureOnboardingProgress.ts`
- `src/core/controller/state/dismissBanner.ts`
- `src/core/controller/state/flushPendingState.ts`
- `src/core/controller/state/getAvailableTerminalProfiles.ts`
- `src/core/controller/state/getLatestState.ts`
- `src/core/controller/state/getProcessInfo.ts`
- `src/core/controller/state/persistModeSelection.ts`
- `src/core/controller/state/reasoningEffort.ts`
- `src/core/controller/state/resetState.ts`
- `src/core/controller/state/setWelcomeViewCompleted.ts`
- `src/core/controller/state/settingsApiConfig.ts`
- `src/core/controller/state/settingsTerminalProfile.ts`
- `src/core/controller/state/settingsWebview.ts`
- `src/core/controller/state/subscribeToState.ts`
- `src/core/controller/state/testOtelConnection.ts`
- `src/core/controller/state/testPromptUploading.ts`
- `src/core/controller/state/toggleFavoriteModel.ts`
- `src/core/controller/state/togglePlanActModeProto.ts`
- `src/core/controller/state/trackBannerEvent.ts`
- `src/core/controller/state/updateAutoApprovalSettings.ts`
- `src/core/controller/state/updateInfoBannerVersion.ts`
- `src/core/controller/state/updateModelBannerVersion.ts`
- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/state/updateTelemetrySetting.ts`
- `src/core/controller/state/updateTerminalConnectionTimeout.ts`
- `src/core/controller/state/updateTerminalReuseEnabled.ts`
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
- `src/core/controller/ui/UiController.ts`
- `src/core/controller/ui/assembleAuthState.ts`
- `src/core/controller/ui/assembleModelState.ts`
- `src/core/controller/ui/assembleRuntimeState.ts`
- `src/core/controller/ui/assembleToolState.ts`
- `src/core/controller/ui/discoverAvailableSkills.ts`
- `src/core/controller/ui/getWebviewHtml.ts`
- `src/core/controller/ui/githubCopilotLogin.ts`
- `src/core/controller/ui/initializeWebview.ts`
- `src/core/controller/ui/onDidShowAnnouncement.ts`
- `src/core/controller/ui/openUrl.ts`
- `src/core/controller/ui/openWalkthrough.ts`
- `src/core/controller/ui/processTaskHistory.ts`
- `src/core/controller/ui/scrollToSettings.ts`
- `src/core/controller/ui/setTerminalExecutionMode.ts`
- `src/core/controller/ui/subscribeToAccountButtonClicked.ts`
- `src/core/controller/ui/subscribeToAddToInput.ts`
- `src/core/controller/ui/subscribeToChatButtonClicked.ts`
- `src/core/controller/ui/subscribeToHistoryButtonClicked.ts`
- `src/core/controller/ui/subscribeToRelinquishControl.ts`
- `src/core/controller/ui/subscribeToSettingsButtonClicked.ts`
- `src/core/controller/ui/subscribeToShowWebview.ts`
- `src/core/controller/ui/subscribeToWorktreesButtonClicked.ts`
- `src/core/controller/web/checkIsImageUrl.ts`
- `src/core/controller/web/fetchOpenGraphData.ts`
- `src/core/controller/worktree/checkoutBranch.ts`
- `src/core/controller/worktree/createWorktree.ts`
- `src/core/controller/worktree/createWorktreeInclude.ts`
- `src/core/controller/worktree/deleteWorktree.ts`
- `src/core/controller/worktree/getAvailableBranches.ts`
- `src/core/controller/worktree/getWorktreeDefaults.ts`
- `src/core/controller/worktree/getWorktreeIncludeStatus.ts`
- `src/core/controller/worktree/listWorktrees.ts`
- `src/core/controller/worktree/mergeWorktree.ts`
- `src/core/controller/worktree/switchWorktree.ts`
- `src/core/controller/worktree/trackWorktreeViewOpened.ts`

