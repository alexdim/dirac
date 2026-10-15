---
component_id: 5.2.3
component_name: Core Session & Goal Controller
---

# Core Session & Goal Controller

## Component Description

Coordinates core application controller state, Goal execution lifecycles, task history repair, and folder lock acquisition utilities.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/index.ts (lines 55-528)
```
export class Controller implements ITaskHost {
	public discoveredSkillsCache?: SkillMetadata[]
	readonly stateManager: StateManager
	private availableToolsFingerprint?: string

	// NEW: Add workspace manager (optional initially)
	private workspaceManager?: WorkspaceRootManager

	private authController!: AuthController
	private stateController!: StateController
	private workspaceController!: WorkspaceController
	private taskController!: TaskController
	private taskHistoryController!: import("./TaskHistoryController").TaskHistoryController
	private initializerConfig!: InitializerConfig
	private readonly goalController: GoalController
	private goalRoutingEnabled: boolean
	private taskInitializationDefaults?: TaskInitializationOptions

	get task(): Task | undefined {
		return this.goalController?.coordinator ?? this.taskController?.task
	}

	set task(value: Task | undefined) {
		this.taskController.task = value
	}

	// Promise for the in-flight task run; created inside TaskController.initTask (from main).
	get taskRunPromise(): Promise<void> | undefined {
		return this.taskController?.taskRunPromise
	}

	onTaskReplaced(listener: (taskId: string) => void | Promise<void>): () => void {
		return this.taskController.onTaskReplaced(listener)
	}

	private lastPublishedPresentation?: {
		surfaceId?: string
		source?: object
		generation?: number
	}
	private readonly statePublicationQueue = new StatePublicationQueue<OutboundStatePublication, StatePublicationRequest>(
		(request) => this.getStatePublication(request),
		async (publication, sequenceNumber) => {
			await sendStateUpdate(publication.state, sequenceNumber, publication.presentation)
			publication.acknowledge()
		},
		(pending, requested) => (pending === "control" || requested === "control" ? "control" : "presentation"),
	)

	private openAiCodexUsageUnsubscribe?: () => void

	// Public getter for workspace manager with lazy initialization - To get workspaces when task isn't initialized (Used by file mentions)
	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		const manager = await this.workspaceController.ensureWorkspaceManager()
		if (manager && !this.workspaceManager) {
			this.workspaceManager = manager
		}
		return this.workspaceManager
	}

	// Synchronous getter for workspace manager
	getWorkspaceManager(): WorkspaceRootManager | undefined {
		const tm = this.taskController.workspaceManager
		if (tm) {
			this.workspaceManager = tm
		}
		return this.workspaceManager || this.taskController.workspaceManager
	}

	constructor(
		readonly context: DiracExtensionContext,
		options: ControllerOptions = {},
	) {
		const initializer = new Initializer(context)
		this.initializerConfig = initializer.createConfig(this, options.workspaceCwd)
		Object.assign(this, this.initializerConfig)
		this.stateManager = this.initializerConfig.stateManager
		this.goalRoutingEnabled = options.goalRoutingEnabled ?? HostProvider.get().diracType === "extension"
		this.goalController = new GoalController({
			controller: this,
			stateManager: this.stateManager,
			getStandaloneTask: () => this.taskController.task,
			clearStandaloneTask: () => this.taskController.clearTask(),
			updateGoalHistory: (item) => this.taskHistoryController.updateGoalHistory(item),
			postState: () => this.postStateToWebview(),
		})

		this.openAiCodexUsageUnsubscribe = openAiCodexUsageService.subscribe(() => {
			void this.postStateToWebview()
		})

		BannerService.initialize(this)

		// Clean up legacy checkpoints
		cleanupLegacyCheckpoints().catch((error) => {
			Logger.error("Failed to cleanup legacy checkpoints:", error)
		})

		// Check CLI installation status once on startup
		checkCliInstallation(this)

		// Initialize workspace manager in background
		this.ensureWorkspaceManager()
			.then(() => {
				this.postStateToWebview()
			})
			.catch((error) => {
				Logger.error("Failed to initialize workspace manager:", error)
			})
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		this.openAiCodexUsageUnsubscribe?.()
		this.openAiCodexUsageUnsubscribe = undefined
		await this.goalController.dispose()
		await this.taskController.clearTask()

		Logger.debug("Controller disposed")
	}

	// Task lifecycle delegation (via TaskController)

	setTaskInitializationDefaults(options: TaskInitializationOptions): void {
		this.taskInitializationDefaults = options
	}

	private resolveTaskInitializationOptions(options?: TaskInitializationOptions): TaskInitializationOptions | undefined {
		if (!this.taskInitializationDefaults) return options
		return { ...this.taskInitializationDefaults, ...options }
	}

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: any,
		conversationUlid?: string,
		_watcherFactory?: any,
		initializationOptions?: TaskInitializationOptions,
	): Promise<string> {
		if (!historyItem && task !== undefined) {
			const goalRequest = parseGoalRequest(task)
			if (goalRequest.matched) {
				this.assertGoalSurfaceSupported(initializationOptions)
				if (images?.length || files?.length) throw new Error("/goal currently accepts a text objective only")
				return this.goalController.start(goalRequest.objective)
			}
		}
		if (historyItem && isGoalHistoryItem(historyItem)) {
			this.assertGoalSurfaceSupported()
			await this.goalController.select(historyItem.id)
			return historyItem.id
		}
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after starting another run")
		}
		return this.taskController.initTask(
			task,
			images,
			files,
			historyItem,
			taskSettings,
			conversationUlid,
			_watcherFactory,
			this.resolveTaskInitializationOptions(initializationOptions),
		)
	}

	async reinitExistingTaskFromId(taskId: string, initializationOptions?: TaskInitializationOptions): Promise<void> {
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after loading another run")
		}
		return this.taskController.reinitExistingTaskFromId(taskId, this.resolveTaskInitializationOptions(initializationOptions))
	}

	async prepareTaskForFollowUp(initializationOptions?: TaskInitializationOptions): Promise<Task> {
		return this.taskController.prepareTaskForFollowUp(this.resolveTaskInitializationOptions(initializationOptions))
	}

	async cancelTask(): Promise<void> {
		if (this.goalController.hasRunningCoordinator) {
			await this.goalController.cancelCurrentExecution("Cancelled by user")
			return
		}
		return this.taskController.cancelTask()
	}

	updateBackgroundCommandState(running: boolean, taskId?: string): void {
		this.taskController.updateBackgroundCommandState(running, taskId)
	}

	get backgroundCommandRunning(): boolean {
		return this.taskController.backgroundCommandRunning
	}

	get backgroundCommandTaskId(): string | undefined {
		return this.taskController.backgroundCommandTaskId
	}

	async cancelBackgroundCommand(): Promise<void> {
		return this.taskController.cancelBackgroundCommand()
	}

	async clearTask(): Promise<void> {
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after leaving the Goal")
			return
		}
		await this.taskController.clearTask()
	}

	async createTask(prompt: string) {
		await sendChatButtonClickedEvent()
		await this.initTask(prompt)
	}

	// OpenRouter

	async completeOpenRouterAuth(code: string) {
		return this.authController.completeOpenRouterAuth(code)
	}

	// GitHub Copilot
	async completeGithubLogin() {
		return this.authController.completeGithubLogin()
	}

	// Requesty

	async completeRequestyAuth(code: string) {
		return this.authController.completeRequestyAuth(code)
	}

	// Read OpenRouter models from disk cache (delegates to TaskHistoryController)
	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		return this.taskHistoryController.readOpenRouterModels()
	}

	// Task history (delegates to TaskHistoryController)

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		return this.taskHistoryController.getTaskWithId(id)
	}

	async getPromptHistory(workspacePath: string, excludedRunId?: string) {
		return this.taskHistoryController.getPromptHistory(workspacePath, excludedRunId)
	}

	async exportTaskWithId(id: string) {
		return this.taskHistoryController.exportTaskWithId(id)
	}

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		const updated = await this.taskHistoryController.deleteTaskFromState(id)
		await this.postStateToWebview()
		return updated
	}

	async postStateToWebview(): Promise<void> {
		await this.statePublicationQueue.requestPublication("control")
	}

	async postPresentationToWebview(): Promise<void> {
		await this.statePublicationQueue.requestPublication("presentation")
	}

	async waitForGoalStartupReconciliation(): Promise<void> {
		await this.goalController.waitForStartupReconciliation()
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		const presentation = await this.captureSelectedPresentation()
		return this.assembleStateToPostToWebview(true, presentation)
	}

	private async captureSelectedPresentation(): Promise<SelectedPresentation> {
		while (true) {
			const selectedGoalId = this.goalController.selectedGoalId
			const surfaceId = selectedGoalId ?? this.task?.taskId
			const source = selectedGoalId ? this.goalController.coordinator?.messageStateHandler : this.task?.messageStateHandler
			const snapshot = selectedGoalId
				? await this.goalController.selectedPresentationSnapshot()
				: source
					? await source.capturePresentationSnapshot()
					: { messages: [], offset: -1, generation: 0 }
			const currentGoalId = this.goalController.selectedGoalId
			const currentSurfaceId = currentGoalId ?? this.task?.taskId
			const currentSource = currentGoalId
				? this.goalController.coordinator?.messageStateHandler
				: this.task?.messageStateHandler
			if (surfaceId === currentSurfaceId && source === currentSource) {
				return { ...snapshot, surfaceId, source }
			}
		}
	}

	private async getStatePublication(request: StatePublicationRequest): Promise<OutboundStatePublication> {
		const controlState = request === "control" ? await this.assembleStateToPostToWebview(false) : undefined
		const selectedGoalId = this.goalController.selectedGoalId
		const surfaceId = selectedGoalId ?? this.task?.taskId
		const source = selectedGoalId ? this.goalController.coordinator?.messageStateHandler : this.task?.messageStateHandler
		const generation = source?.getPresentationStateGeneration() ?? 0
		const requiresHydration =
			surfaceId !== this.lastPublishedPresentation?.surfaceId ||
			source !== this.lastPublishedPresentation?.source ||
			generation !== this.lastPublishedPresentation?.generation ||
			source?.hasPresentationPublicationGap() === true

		if (!requiresHydration) return this.createPresentationPublication(controlState)
		const presentation = await this.captureSelectedPresentation()
		const fullState = await this.assembleStateToPostToWebview(true, presentation)
		return {
			state: fullState,
			acknowledge: () => {
				this.lastPublishedPresentation = {
					surfaceId: presentation.surfaceId,
					source: presentation.source,
					generation: presentation.generation,
				}
				presentation.source?.acknowledgePresentationOperations(presentation.offset)
			},
		}
	}

	private createPresentationPublication(controlState?: ExtensionState): OutboundStatePublication {
		const selectedGoalId = this.goalController.selectedGoalId
		const task = selectedGoalId ? this.goalController.coordinator : this.task
		const surfaceId = selectedGoalId ?? task?.taskId
		const operations = task?.messageStateHandler.getPendingPresentationOperations() ?? []
		const maxConsecutiveMistakes = this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
		const state: Partial<ExtensionState> = controlState ?? {
			presentationSurfaceId: surfaceId,
			presentationOffset: task?.messageStateHandler.getPresentationOffset(),
			activeVoiceStreamId: task?.stateView.activeVoiceStreamId,
			isApiRequestActive: task?.stateView.isApiRequestActive ?? false,
			taskStatus: task?.stateView.status ?? TaskStatus.IDLE,
			uiActionState: projectUIActionState(
				task?.stateView,
				(id) => task?.messageStateHandler.getMessageById(id),
				maxConsecutiveMistakes,
			),
		}
		const presentation = operations.length > 0 && surfaceId ? { surfaceId, operations } : undefined
		const throughOffset = operations.at(-1)?.offset
		return {
			state,
			presentation,
			acknowledge: () => {
				if (throughOffset !== undefined) task?.messageStateHandler.acknowledgePresentationOperations(throughOffset)
			},
		}
	}

	private async assembleStateToPostToWebview(
		includeMessages: boolean,
		presentation?: SelectedPresentation,
	): Promise<ExtensionState> {
		const previousAvailableToolsFingerprint = this.availableToolsFingerprint

		const goal = await this.goalController.inspect()
		const state = await getUiState({
			stateManager: this.stateManager,
			task: this.task,
			workspaceManager: this.workspaceManager,
			backgroundCommandRunning: this.backgroundCommandRunning,
			backgroundCommandTaskId: this.backgroundCommandTaskId,
			goal,
			goalMessages: includeMessages ? presentation?.messages : undefined,
			presentationOffset: includeMessages ? presentation?.offset : undefined,
			presentationSurfaceId: includeMessages ? presentation?.surfaceId : undefined,
			includeMessages,
		})

		const nextAvailableToolsFingerprint = await fingerprintAvailableTools(state.availableTools)
		if (this.task && previousAvailableToolsFingerprint !== nextAvailableToolsFingerprint) {
			this.task.markToolsDirty("settings_refresh_detected_change")
		}
		this.availableToolsFingerprint = nextAvailableToolsFingerprint

		return state
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		return this.taskHistoryController.updateTaskHistory(item)
	}

	async updateGoalHistory(item: GoalHistoryItem): Promise<HistoryItem[]> {
		return this.taskHistoryController.updateGoalHistory(item)
	}

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		return this.stateController.updateTelemetrySetting(telemetrySetting)
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		if (this.goalController.selectedGoalId) throw new Error("Mode switching is disabled while a Goal is active.")
		return this.stateController.toggleActModeForYoloMode()
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		if (this.goalController.selectedGoalId) throw new Error("Mode switching is disabled while a Goal is active.")
		return this.stateController.togglePlanActMode(modeToSwitchTo, chatContent)
	}

	enableInteractiveGoals(): void {
		this.goalRoutingEnabled = true
	}

	get selectedGoalId(): string | undefined {
		return this.goalController.selectedGoalId
	}

	get hasActiveGoal(): boolean {
		return this.goalController.active
	}

	async selectGoal(goalId: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.select(goalId)
	}

	async resumeGoal(goalId: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.resume(goalId)
	}

	async pauseGoal(goalId: string, reason?: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.pause(goalId, reason)
	}

	async stopGoal(goalId: string, reason?: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.stop(goalId, reason)
	}

	async steerGoal(goalId: string, message: string): Promise<void> {
		this.assertGoalSurfaceSupported()
		return this.goalController.steer(goalId, message)
	}

	async sendGoalMessage(goalId: string, message: string): Promise<void> {
		this.assertGoalSurfaceSupported()
		if (isGoalResumeCommand(message)) {
			await this.goalController.resume(goalId)
			return
		}
		return this.goalController.sendMessage(goalId, message)
	}

	private assertGoalSurfaceSupported(initializationOptions?: TaskInitializationOptions): void {
		const effectiveOptions = this.resolveTaskInitializationOptions(initializationOptions)
		if (effectiveOptions?.toolSelectionPolicy) {
			throw new Error("Invocation tool-selection options cannot be used with Goals.")
		}
		if (!this.goalRoutingEnabled) {
			throw new Error("Goals require the interactive VS Code or CLI surface; ACP and unattended CLI are unsupported.")
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/goal/GoalController.ts (lines 31-303)
```
export class GoalController {
	private readonly store = new GoalStore()
	private readonly ready: Promise<void>
	private selectedLoop?: GoalLoop

	constructor(private readonly dependencies: GoalControllerDependencies) {
		this.ready = this.reconcilePersistedGoals()
	}

	get selectedGoalId(): string | undefined {
		return this.selectedLoop?.goalId
	}

	get active(): boolean {
		return this.selectedLoop?.isActive === true
	}

	get hasRunningCoordinator(): boolean {
		return this.selectedLoop?.hasRunningCoordinator === true
	}

	get coordinator(): Task | undefined {
		return this.selectedLoop?.coordinator
	}

	async waitForStartupReconciliation(): Promise<void> {
		await this.ready
	}

	async start(objectiveMarkdown: string): Promise<string> {
		return goalActivationMutex.withLock(() => this.startSerial(objectiveMarkdown))
	}

	private async startSerial(objectiveMarkdown: string): Promise<string> {
		await this.ready
		const objective = objectiveMarkdown.trim()
		if (!objective) throw new Error("/goal requires a non-empty objective")
		await this.assertNoActiveGoal()
		this.assertNoActiveStandaloneTask()
		await this.dependencies.clearStandaloneTask()

		const goalId = Date.now().toString()
		await this.store.create(goalId, ulid(), objective)
		let loop: GoalLoop
		try {
			loop = await this.createLoop(goalId, objective)
			await loop.publishHistory()
		} catch (error) {
			await this.store.delete(goalId)
			throw error
		}

		this.selectedLoop = loop
		await loop.start()
		return goalId
	}

	async select(goalId: string): Promise<GoalViewState> {
		return goalActivationMutex.withLock(() => this.selectSerial(goalId))
	}

	private async selectSerial(goalId: string): Promise<GoalViewState> {
		await this.ready
		if (this.selectedLoop?.hasRunningCoordinator) {
			await this.selectedLoop.cancelCurrentExecution("Interrupted after selecting another run")
		}
		await this.dependencies.clearStandaloneTask()
		const historyItem = this.goalHistoryItem(goalId)
		await this.store.read(goalId)
		this.selectedLoop = await this.createLoop(goalId, historyItem.initialDisplayText)
		await this.dependencies.postState()
		return this.selectedLoop.inspect()
	}

	async resume(goalId: string): Promise<GoalViewState> {
		return goalActivationMutex.withLock(() => this.resumeSerial(goalId))
	}

	private async resumeSerial(goalId: string): Promise<GoalViewState> {
		await this.ready
		if (this.selectedLoop?.goalId === goalId && this.selectedLoop.isActive) return this.selectedLoop.inspect()
		if (this.selectedLoop?.hasRunningCoordinator) {
			throw new Error(`Finish or cancel the current Goal conversation before resuming Goal ${goalId}`)
		}
		await this.assertNoActiveGoal()
		this.assertNoActiveStandaloneTask()
		await this.dependencies.clearStandaloneTask()
		const historyItem = this.goalHistoryItem(goalId)
		const record = await this.store.read(goalId)
		const loop = await this.createLoop(goalId, historyItem.initialDisplayText)
		this.selectedLoop = loop
		if (record.status === "paused" && record.statusReason === "Created") await loop.start()
		else await loop.resume()
		return loop.inspect()
	}

	async steer(goalId: string, message: string): Promise<void> {
		await this.ready
		this.requireSelectedLoop(goalId)
		await this.selectedLoop!.steer(message)
	}

	async sendMessage(goalId: string, message: string): Promise<void> {
		await this.ready
		this.requireSelectedLoop(goalId)
		await this.selectedLoop!.sendMessage(message)
	}

	async cancelCurrentExecution(reason?: string): Promise<void> {
		await this.ready
		if (!this.selectedLoop) return
		await this.selectedLoop.cancelCurrentExecution(reason)
	}

	async pause(goalId: string, reason?: string): Promise<GoalViewState> {
		return goalActivationMutex.withLock(() => this.pauseSerial(goalId, reason))
	}

	private async pauseSerial(goalId: string, reason?: string): Promise<GoalViewState> {
		await this.ready
		this.requireSelectedLoop(goalId)
		await this.selectedLoop!.pause(reason)
		return this.selectedLoop!.inspect()
	}

	async stop(goalId: string, reason?: string): Promise<GoalViewState> {
		return goalActivationMutex.withLock(() => this.stopSerial(goalId, reason))
	}

	private async stopSerial(goalId: string, reason?: string): Promise<GoalViewState> {
		await this.ready
		if (this.selectedLoop?.hasRunningCoordinator && this.selectedLoop.goalId !== goalId) {
			throw new Error(`Goal control for ${goalId} is stale; running Goal conversation is ${this.selectedLoop.goalId}`)
		}
		if (this.selectedLoop?.goalId !== goalId) {
			const historyItem = this.goalHistoryItem(goalId)
			this.selectedLoop = await this.createLoop(goalId, historyItem.initialDisplayText)
		}
		await this.selectedLoop.stop(reason)
		return this.selectedLoop.inspect()
	}

	async inspect(goalId = this.selectedGoalId): Promise<GoalViewState | undefined> {
		await this.ready
		if (!goalId) return undefined
		if (this.selectedLoop?.goalId === goalId) return this.selectedLoop.inspect()
		const historyItem = this.goalHistoryItem(goalId)
		return (await this.createLoop(goalId, historyItem.initialDisplayText)).inspect()
	}

	async selectedPresentationSnapshot(): Promise<PresentationSnapshot> {
		await this.ready
		if (!this.selectedLoop) return { messages: [], offset: -1, generation: 0 }
		const coordinator = this.selectedLoop.coordinator
		if (coordinator) return coordinator.messageStateHandler.capturePresentationSnapshot()
		const saved = await getSavedPresentationHistory(this.selectedLoop.goalId)
		return {
			messages: saved.messages,
			offset: saved.lastOffset,
			generation: 0,
		}
	}

	async pauseAndDeselect(reason: string): Promise<void> {
		return goalActivationMutex.withLock(() => this.pauseAndDeselectSerial(reason))
	}

	private async pauseAndDeselectSerial(reason: string): Promise<void> {
		await this.ready
		if (this.selectedLoop?.hasRunningCoordinator) await this.selectedLoop.cancelCurrentExecution(reason)
		this.selectedLoop = undefined
		await this.dependencies.postState()
	}

	async dispose(): Promise<void> {
		await this.pauseAndDeselect("Paused because the owning surface closed")
	}

	private async reconcilePersistedGoals(): Promise<void> {
		try {
			const report = await this.store.reconcileOnStartup()
			for (const failure of report.failures) {
				Logger.error(`[GoalController] Failed to reconcile persisted Goal ${failure.goalId}:`, failure.error)
			}
			for (const record of report.records) {
				await this.reconcilePersistedGoalHistory(record)
			}
		} catch (error) {
			Logger.error("[GoalController] Failed to scan persisted Goals during startup:", error)
		}
	}

	private async reconcilePersistedGoalHistory(record: import("@shared/goal").GoalRecord): Promise<void> {
		try {
			const historyItem = this.dependencies.stateManager
				.getGlobalStateKey("taskHistory")
				.find((item) => item.id === record.id)
			if (!historyItem) {
				Logger.warn(
					`[GoalController] Goal ${record.id} is missing its top-level history entry; preserving loaded history`,
				)
				return
			}
			if (!isGoalHistoryItem(historyItem)) {
				Logger.warn(
					`[GoalController] Run ${record.id} is a Task in history but a Goal on disk; preserving loaded history`,
				)
				return
			}
			await this.dependencies.updateGoalHistory(
				createGoalHistoryItem(record, historyItem.initialDisplayText, historyItem.workspaceRootPath),
			)
		} catch (error) {
			Logger.error(`[GoalController] Failed to refresh Goal history ${record.id}:`, error)
		}
	}

	private async createLoop(goalId: string, initialDisplayText: string): Promise<GoalLoop> {
		const record = await this.store.read(goalId)
		const workspaceManager = await this.dependencies.controller.ensureWorkspaceManager()
		if (!workspaceManager) throw new Error("A Goal requires an initialized workspace manager")
		const cwd = workspaceManager.getPrimaryRoot()?.path ?? (await getCwd(getDesktopDir()))
		return new GoalLoop({
			goalId: record.id,
			initialDisplayText,
			store: this.store,
			// Capture settings when execution starts, not when an inactive Goal is selected.
			// Children in this run share that snapshot; a later run captures a new one.
			createTaskFactory: () => new GoalTaskFactory({
				controller: this.dependencies.controller,
				stateManager: this.dependencies.stateManager,
				workspaceManager,
				cwd,
				workingConfiguration: this.dependencies.stateManager.captureEffectiveTaskConfiguration({ mode: "act" }),
				postCoordinatorState: this.dependencies.postState,
			}),
			stateManager: this.dependencies.stateManager,
			updateHistory: (item) => {
				if (!isGoalHistoryItem(item)) throw new Error(`Goal ${goalId} produced a Task history item`)
				return this.dependencies.updateGoalHistory(item)
			},
			postState: this.dependencies.postState,
			workspaceRootPath: workspaceManager.getPrimaryRoot()?.path,
		})
	}

	private async assertNoActiveGoal(): Promise<void> {
		if (this.selectedLoop?.hasRunningCoordinator) {
			throw new Error(`Goal ${this.selectedLoop.goalId} already has a running coordinator`)
		}
		const active = (await this.store.list()).find((record) => isActiveGoalStatus(record.status))
		if (active) throw new Error(`Goal ${active.id} is already active`)
	}

	private assertNoActiveStandaloneTask(): void {
		const task = this.dependencies.getStandaloneTask()
		if (!task) return
		if ([TaskStatus.IDLE, TaskStatus.COMPLETED, TaskStatus.CANCELLED].includes(task.taskState.status)) return
		throw new Error(`Task ${task.taskId} is active; leave or cancel it before starting a Goal`)
	}

	private requireSelectedLoop(goalId: string): void {
		if (this.selectedLoop?.goalId !== goalId) {
			throw new Error(`Goal control for ${goalId} is stale; selected Goal is ${this.selectedGoalId ?? "none"}`)
		}
	}

	private goalHistoryItem(goalId: string): GoalHistoryItem {
		const item = this.dependencies.stateManager.getGlobalStateKey("taskHistory").find((candidate) => candidate.id === goalId)
		if (!item || !isGoalHistoryItem(item)) throw new Error(`Run ${goalId} is not a Goal`)
		return item
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/locks/FolderLockUtils.ts (lines 30-38)
```
export async function getStandaloneLockManager(): Promise<SqliteLockManager | undefined> {
	try {
		const { getLockManager } = await import("../../standalone/lock-manager")
		return getLockManager()
	} catch (_importError) {
		Logger.debug("Lock manager not available")
		return undefined
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/locks/FolderLockUtils.ts (lines 48-71)
```
export async function tryAcquireFolderLockWithRetry(
	options: FolderLockOptions,
	config?: FolderLockRetryConfig,
): Promise<FolderLockWithRetryResult> {
	return await retryFolderLockAcquisition(async () => {
		try {
			const lockManager = await getStandaloneLockManager()

			if (!lockManager) {
				Logger.debug("Lock manager not available - skipping lock acquisition")
				return { acquired: false, skipped: true }
			}

			Logger.log(`Attempting to acquire folder lock for: ${options.lockTarget}`)

			const result = await acquireFolderLock(options)

			return { acquired: result.acquired, conflictingLock: result.conflictingLock, skipped: false }
		} catch (error) {
			Logger.error("Error in folder lock acquisition attempt:", error)
			return { acquired: false }
		}
	}, config)
}
```


## Source Files:

- `src/core/commands/repairMissingTaskHistory.ts`
- `src/core/controller/index.ts`
- `src/core/goal/GoalController.ts`
- `src/core/locks/FolderLockUtils.ts`

