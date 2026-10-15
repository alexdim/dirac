---
component_id: 10
component_name: Task Lifecycle & Checkpoint Management
---

# Task Lifecycle & Checkpoint Management

## Component Description

Executes the core task request loop, tool invocation pipeline, conversation state management, and shadow-git workspace checkpointing.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/task/index.ts (lines 143-1342)
```
export class Task {
	// Core task variables
	readonly taskId: string
	// Sequence number for prompt-metadata debug artifacts — see promptArtifactsContext.
	// Each API request within a task gets its own file instead of overwriting the last.
	private promptArtifactSeq = 0
	private diracContext: DiracContext
	readonly ulid: string
	private taskIsFavorited?: boolean
	public cwd: string
	private taskInitializationStartTime: number

	taskState: TaskState
	private workingConfiguration: TaskWorkingConfiguration
	private activeRequestRuntime?: TaskRequestRuntime

	/** Read-only view of task state for consumers outside the task layer. */
	get stateView(): ReadonlyTaskState {
		return this.taskState
	}

	private readonly conversationPersistenceHooks?: TaskConversationPersistenceHooks

	// ONE mutex for ALL state modifications to prevent race conditions
	private stateMutex = new Mutex()
	private readonly mutationGate = new TaskMutationGate()

	/**
	 * Execute function with exclusive lock on all task state
	 * Use this for ANY state modification to prevent races
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	private get steeringContext(): TaskSteeringContext {
		return {
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			taskMessenger: this.taskMessenger,
			allowWhileWaitingForInteraction:
				this.executionProfile === "goal_coordinator" || this.executionProfile === "goal_followup",
			postStateToWebview: () => this.postStateToWebview(),
			withStateLock: (fn) => this.withStateLock(fn),
		}
	}

	private get promptArtifactsContext(): TaskPromptArtifactsContext {
		return {
			taskId: this.taskId,
			// Each call gets its own sequence number so a multi-call turn (e.g. the
			// noToolsUsed retry loop) leaves one debug artifact per API request
			// instead of the last request overwriting all earlier ones.
			requestSeq: ++this.promptArtifactSeq,
			cwd: this.cwd,
			writePromptMetadataEnabled: this.workingConfiguration.settings.writePromptMetadataEnabled,
			writePromptMetadataDirectory: this.workingConfiguration.settings.writePromptMetadataDirectory,
		}
	}

	private requestBuilderContext(requestRuntime: TaskRequestRuntime): TaskRequestBuilderContext {
		return {
			taskId: this.taskId,
			cwd: this.cwd,
			terminalExecutionMode: this.terminalExecutionMode,
			stateManager: this.stateManager,
			messageStateHandler: this.messageStateHandler,
			taskMessenger: this.taskMessenger,
			toolExecutor: this.toolExecutor,
			contextManager: this.contextManager,
			apiConversationManager: this.apiConversationManager,
			diracIgnoreController: this.diracIgnoreController,
			workspaceManager: this.workspaceManager,
			taskState: this.taskState,
			executionProfile: this.executionProfile,
			getPinnedContext: this.getPinnedContext,
			writePromptMetadataArtifacts: (params) =>
				writePromptMetadataArtifacts(
					{
						taskId: this.taskId,
						requestSeq: ++this.promptArtifactSeq,
						cwd: this.cwd,
						writePromptMetadataEnabled: requestRuntime.workingConfiguration.settings.writePromptMetadataEnabled,
						writePromptMetadataDirectory: requestRuntime.workingConfiguration.settings.writePromptMetadataDirectory,
					},
					params,
				),
		}
	}

	private requestOutcomeContext(requestRuntime: TaskRequestRuntime): TaskRequestOutcomeContext {
		return {
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			taskMessenger: this.taskMessenger,
			api: requestRuntime.api,
			taskId: this.taskId,
			mode: requestRuntime.workingConfiguration.settings.mode,
			executionProfile: this.executionProfile,
			checkpointManager: this.checkpointManager,
			postStateToWebview: () => this.postStateToWebview(),
			abortTask: () => this.abortTask(),
			handleContextWindowExceededError: () => this.handleContextWindowExceededError(),
			reinitExistingTaskFromId: () => this.reinitExistingTaskFromId(this.taskId),
			attemptApiRequest: (previousApiReqIndex, lastApiReqIndex, shouldCompact) =>
				this.attemptApiRequest(previousApiReqIndex, lastApiReqIndex, shouldCompact),
			recursivelyMakeDiracRequests: (userContent, includeFileDetails) =>
				this.recursivelyMakeDiracRequests(userContent, includeFileDetails),
			handleEmptyAssistantResponse: (params) => this.responseProcessor.handleEmptyAssistantResponse(params),
		}
	}

	private requestLoopContext(requestRuntime: TaskRequestRuntime): TaskRequestLoopContext {
		return {
			...this.requestBuilderContext(requestRuntime),
			...this.requestOutcomeContext(requestRuntime),
			requestRuntime,
			steeringContext: this.steeringContext,
			handleMistakeLimitReached: (userContent) => this.handleMistakeLimitReached(userContent),
			enqueuePreRequestSteeringMessages: () => this.enqueuePreRequestSteeringMessages(),
			resetStreamingState: () => this.resetStreamingState(),
			initializeCheckpoints: (isFirstRequest) => this.initializeCheckpoints(isFirstRequest),
			determineContextCompaction: (previousApiReqIndex) => this.determineContextCompaction(previousApiReqIndex),
			localConversationCompaction: this.localConversationCompaction,
			responseProcessor: this.responseProcessor,
			streamHandler: this.streamHandler,
			modelContextTracker: this.modelContextTracker,
			diffViewProvider: this.diffViewProvider,
			ulid: this.ulid,
			conversationPersistenceHooks: this.conversationPersistenceHooks,
		}
	}

	public canAcceptSteeringMessage(): boolean {
		return canAcceptSteeringMessage(this.steeringContext)
	}

	public async enqueueSteeringMessage(text: string): Promise<string> {
		return enqueueSteeringMessage(this.steeringContext, text)
	}

	private async claimSteeringMessages(): Promise<SteeringClaim | undefined> {
		return claimSteeringMessages(this.steeringContext)
	}

	private async commitSteeringClaim(claimId: string): Promise<void> {
		return commitSteeringClaim(this.steeringContext, claimId)
	}

	private async settleConsumedSteeringClaim(claim: SteeringClaim): Promise<void> {
		return settleConsumedSteeringClaim(this.steeringContext, claim)
	}

	private async rollbackSteeringClaim(claimId: string): Promise<void> {
		return rollbackSteeringClaim(this.steeringContext, claimId)
	}

	private async appendQueuedSteeringToUserContent(userContent: DiracContent[]): Promise<SteeringClaim | undefined> {
		return appendQueuedSteeringToUserContent(this.steeringContext, userContent)
	}

	private async appendQueuedSteeringToNextApiRequest(outboundHistory: DiracStorageMessage[]): Promise<void> {
		return appendQueuedSteeringToNextApiRequest(this.steeringContext, outboundHistory)
	}

	private async commitAttemptCompletion(
		response: string,
	): Promise<import("./tools/interfaces/IToolEnvironment").CompletionCommitResult> {
		return commitAttemptCompletion(this.steeringContext, response)
	}

	public async setActiveHookExecution(hookExecution: NonNullable<typeof this.taskState.activeHookExecution>): Promise<void> {
		return this.hookManager.setActiveHookExecution(hookExecution)
	}

	public async clearActiveHookExecution(): Promise<void> {
		return this.hookManager.clearActiveHookExecution()
	}

	/** Observe automatic and recovery context compaction for the owning ACP session. */
	public setContextCompactionObserver(observer: () => void): void {
		this.contextCompactionObserver = observer
	}

	private notifyContextCompacted(): void {
		try {
			this.contextCompactionObserver?.()
		} catch (error) {
			Logger.error("Context compaction observer failed", error)
		}
	}

	public async getActiveHookExecution(): Promise<typeof this.taskState.activeHookExecution> {
		return this.hookManager.getActiveHookExecution()
	}

	// Core dependencies
	private host: ITaskHost

	// Service handlers
	api: ApiHandler
	terminalManager: ITerminalManager
	private urlContentFetcher: UrlContentFetcher
	browserSession: BrowserSession
	contextManager: ContextManager
	private diffViewProvider: DiffViewProvider
	public checkpointManager?: ICheckpointManager
	private initialCheckpointCommitPromise?: Promise<string | undefined>
	private diracIgnoreController: DiracIgnoreController
	private commandPermissionController: CommandPermissionController
	private toolExecutor: ToolExecutor
	/**
	 * Whether the task is using native tool calls.
	 * This is used to determine how we would format response.
	 * Example: We don't add noToolsUsed response when native tool call is used
	 * because of the expected format from the tool calls is different.
	 */

	private streamHandler: StreamResponseHandler

	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"

	// Metadata tracking
	private fileContextTracker: FileContextTracker
	private modelContextTracker: ModelContextTracker
	private environmentContextTracker: EnvironmentContextTracker
	private environmentManager: EnvironmentManager
	private contextLoader: ContextLoader
	private taskMessenger: TaskMessenger
	private hookManager: HookManager
	private lifecycleManager: LifecycleManager
	private apiConversationManager: ApiConversationManager
	private localConversationCompaction: LocalConversationCompaction
	private assistantStreamManager: AssistantStreamManager
	private contextCompactionObserver?: () => void
	private switchToActMode: () => Promise<boolean>
	private enqueuePreRequestSteeringMessages: () => Promise<void>

	private responseProcessor: ResponseProcessor

	// Callbacks
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private postStateToWebview: () => Promise<void>
	private postPresentationToWebview: () => Promise<void>
	private reinitExistingTaskFromId: (taskId: string) => Promise<void>
	private cancelTask: () => Promise<void>

	// Cache service
	private stateManager: StateManager

	// Message and conversation state
	messageStateHandler: MessageStateHandler

	// Workspace manager
	workspaceManager?: WorkspaceRootManager

	// Task Locking (Sqlite)
	readonly executionProfile: TaskExecutionProfile
	private readonly getPinnedContext: () => Promise<string | undefined>

	// Command executor for running shell commands (extracted from executeCommandTool)
	private commandExecutor!: CommandExecutor

	constructor(params: TaskParams) {
		const {
			controller,
			updateTaskHistory,
			postStateToWebview,
			postPresentationToWebview,
			reinitExistingTaskFromId,
			cancelTask,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			terminalOutputLineLimit,
			defaultTerminalProfile,
			vscodeTerminalExecutionMode,
			cwd,
			stateManager,
			workingConfiguration,
			workspaceManager,
			task,
			images,
			files,
			historyItem,
			taskId,
			conversationUlid,
			taskLockAcquired,
			updateBackgroundCommandState,
		} = params

		this.taskInitializationStartTime = performance.now()
		this.taskState = new TaskState()
		this.taskState.pinnedContext = params.pinnedContext
		this.taskState.initialTask = task ?? historyItem?.task
		this.executionProfile = params.executionProfile ?? "standalone"
		this.getPinnedContext = params.getPinnedContext ?? (() => Promise.resolve(params.pinnedContext))
		if (this.executionProfile !== "standalone" && workingConfiguration.settings.mode !== "act") {
			throw new Error(`${this.executionProfile} Tasks require an Act-mode working configuration`)
		}
		this.contextCompactionObserver = params.onContextCompacted
		this.host = controller
		this.updateTaskHistory = updateTaskHistory
		this.postStateToWebview = postStateToWebview
		this.postPresentationToWebview = postPresentationToWebview ?? postStateToWebview
		this.reinitExistingTaskFromId = reinitExistingTaskFromId
		this.cancelTask = cancelTask
		this.stateManager = stateManager
		this.workingConfiguration = workingConfiguration
		this.workspaceManager = workspaceManager
		this.cwd = cwd
		this.taskId = taskId
		this.taskState.taskLockAcquired = taskLockAcquired
		this.terminalExecutionMode = vscodeTerminalExecutionMode || "vscodeTerminal"
		this.switchToActMode = params.switchToActMode ?? (() => this.host.toggleActModeForYoloMode())
		this.enqueuePreRequestSteeringMessages = params.enqueuePreRequestSteeringMessages ?? (async () => undefined)
		this.conversationPersistenceHooks = params.conversationPersistenceHooks

		this.taskState.pendingModeNotice = { mode: workingConfiguration.settings.mode }

		// Initialize ULID and task state from history or new task params
		if (historyItem) {
			this.ulid = historyItem.ulid ?? ulid()
			this.taskIsFavorited = historyItem.isFavorited
			this.taskState.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange
			if (historyItem.checkpointManagerErrorMessage) {
				this.taskState.checkpointManagerErrorMessage = historyItem.checkpointManagerErrorMessage
			}
		} else if (task || images || files) {
			this.ulid = conversationUlid ?? ulid()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		this.messageStateHandler = new MessageStateHandler({
			taskId: this.taskId,
			ulid: this.ulid,
			taskState: this.taskState,
			taskIsFavorited: this.taskIsFavorited,
			updateTaskHistory: this.updateTaskHistory,
			workspaceRootPath: this.workspaceManager?.getPrimaryRoot()?.path,
		})

		this.taskMessenger = new TaskMessenger({
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			postStateToWebview: this.postStateToWebview,
			postPresentationToWebview: this.postPresentationToWebview,
			getWorkingConfiguration: () => this.activeRequestRuntime?.workingConfiguration ?? this.workingConfiguration,
			getRequestRuntime: () => this.activeRequestRuntime,
			taskId: this.taskId,
			getCurrentProviderInfo: this.getCurrentProviderInfo.bind(this),
		})

		this.assistantStreamManager = new AssistantStreamManager(this.taskMessenger)

		this.hookManager = new HookManager({
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			getWorkingConfiguration: () => this.activeRequestRuntime?.workingConfiguration ?? this.workingConfiguration,
			getRequestRuntime: () => this.activeRequestRuntime,
			taskId: this.taskId,
			taskMessenger: this.taskMessenger,
			postStateToWebview: this.postStateToWebview,
			cancelTask: this.cancelTask,
			withStateLock: this.withStateLock.bind(this),
			shouldRunBackgroundCheck: () => this.commandExecutor.hasActiveBackgroundCommand(),
		})

		this.diracIgnoreController = new DiracIgnoreController(cwd)
		this.diracIgnoreController.yoloMode = !!workingConfiguration.settings.yoloModeToggled

		this.commandPermissionController = new CommandPermissionController()

		// Determine terminal execution mode and create appropriate terminal manager
		// When backgroundExec mode is selected, use StandaloneTerminalManager for hidden execution
		// Otherwise, use the HostProvider's terminal manager (VSCode terminal in VSCode, standalone in CLI)
		if (this.terminalExecutionMode === "backgroundExec") {
			// Import StandaloneTerminalManager for background execution
			this.terminalManager = new StandaloneTerminalManager()
			Logger.info(`[Task ${taskId}] Using StandaloneTerminalManager for backgroundExec mode`)
		} else {
			// Use the host-provided terminal manager (VSCode terminal in VSCode environment)
			this.terminalManager = HostProvider.get().createTerminalManager()
			Logger.info(`[Task ${taskId}] Using HostProvider terminal manager for vscodeTerminal mode`)
		}
		this.terminalManager.setShellIntegrationTimeout(shellIntegrationTimeout)
		this.terminalManager.setTerminalReuseEnabled(terminalReuseEnabled ?? true)
		this.terminalManager.setTerminalOutputLineLimit(terminalOutputLineLimit)
		this.terminalManager.setDefaultTerminalProfile(defaultTerminalProfile)

		this.urlContentFetcher = new UrlContentFetcher(
			() => (this.activeRequestRuntime?.workingConfiguration ?? this.workingConfiguration).settings.browserSettings,
		)
		this.browserSession = new BrowserSession(
			() => (this.activeRequestRuntime?.workingConfiguration ?? this.workingConfiguration).settings.browserSettings,
		)
		this.contextManager = new ContextManager()
		this.streamHandler = new StreamResponseHandler()

		// Prefer the host's DiffViewProvider if available, as it handles both background
		// and interactive edits. Fall back to FileEditProvider for headless environments.
		const hostDiffViewProvider = HostProvider.get().createDiffViewProvider()
		this.diffViewProvider = hostDiffViewProvider || new FileEditProvider()

		// Tool context owns restoration of conversation-scoped anchor state. Reconstructing
		// a Task for the same ULID must not destroy anchors already emitted to the model.
		this.diracContext = new DiracContext(this.taskId, this.stateManager, this.ulid)

		// Initialize context trackers
		this.fileContextTracker = new FileContextTracker(stateManager, this.taskId)
		this.modelContextTracker = new ModelContextTracker(this.taskId)
		this.environmentContextTracker = new EnvironmentContextTracker(this.taskId)

		// Check for multiroot workspace and warn about checkpoints
		const isMultiRootWorkspace = this.workspaceManager && this.workspaceManager.getRoots().length > 1
		const checkpointsEnabled = workingConfiguration.settings.enableCheckpointsSetting

		if (isMultiRootWorkspace && checkpointsEnabled) {
			// Set checkpoint manager error message to display warning in TaskHeader
			this.taskState.checkpointManagerErrorMessage = "Checkpoints are not currently supported in multi-root workspaces."
		}

		// Initialize checkpoint manager based on workspace configuration
		if (!isMultiRootWorkspace) {
			try {
				this.checkpointManager = buildCheckpointManager({
					taskId: this.taskId,
					messageStateHandler: this.messageStateHandler,
					fileContextTracker: this.fileContextTracker,
					diffViewProvider: this.diffViewProvider,
					taskState: this.taskState,
					workspaceManager: this.workspaceManager,
					updateTaskHistory: this.updateTaskHistory,
					taskMessenger: this.taskMessenger,
					cancelTask: this.cancelTask,
					postStateToWebview: this.postStateToWebview,
					initialConversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
					initialCheckpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
					enableCheckpoints: workingConfiguration.settings.enableCheckpointsSetting,
					multiRootEnabled: workingConfiguration.executionOptions.multiRootEnabled,
					resetTransientState: this.resetTransientState.bind(this),
				})

				// If multi-root, kick off non-blocking initialization
				// Unreachable for now, leaving in for future multi-root checkpoint support
				if (
					shouldUseMultiRoot({
						workspaceManager: this.workspaceManager,
						enableCheckpoints: workingConfiguration.settings.enableCheckpointsSetting,
						multiRootEnabled: workingConfiguration.executionOptions.multiRootEnabled,
					})
				) {
					this.checkpointManager.initialize?.().catch((error: Error) => {
						Logger.error("Failed to initialize multi-root checkpoint manager:", error)
						this.taskState.checkpointManagerErrorMessage = error?.message || String(error)
					})
				}
			} catch (error) {
				Logger.error("Failed to initialize checkpoint manager:", error)
				if (workingConfiguration.settings.enableCheckpointsSetting) {
					const errorMessage = getErrorMessage(error, "Unknown error")
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `Failed to initialize checkpoint manager: ${errorMessage}`,
					})
				}
			}
		}

		// Prepare effective API configuration
		const apiConfiguration = workingConfiguration.apiConfiguration as ApiConfiguration
		const effectiveApiConfiguration: ApiConfiguration = {
			...apiConfiguration,
			ulid: this.ulid,
			onRetryAttempt: async (attempt: number, maxRetries: number, delay: number, error: any) => {
				await this.taskMessenger.upsertApiStatus({
					retryStatus: {
						attempt,
						maxAttempts: maxRetries,
						delaySec: Math.round(delay / 1000),
						errorSnippet: error?.message ? `${String(error.message).substring(0, 50)}...` : undefined,
					},
				})
			},
		}
		const mode = workingConfiguration.settings.mode
		const currentProvider = mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider

		// Now that ulid is initialized, we can build the API handler
		this.api = this.createApiHandlerForRuntime(effectiveApiConfiguration, mode)

		// Update taskMessenger and hookManager with the initialized api
		this.taskMessenger.setApi(this.api)
		this.hookManager.setApi(this.api)
		this.hookManager.setUlid(this.ulid)

		// Set ulid on browserSession for telemetry tracking
		this.browserSession.setUlid(this.ulid)

		// initialize telemetry
		// Extract domain of the provider endpoint if using OpenAI Compatible provider
		let openAiCompatibleDomain: string | undefined
		if (currentProvider === "openai" && apiConfiguration.openAiBaseUrl) {
			openAiCompatibleDomain = extractProviderDomainFromUrl(apiConfiguration.openAiBaseUrl)
		}

		if (historyItem) {
			// Open task from history
			telemetryService.captureTaskRestarted(this.ulid, currentProvider, openAiCompatibleDomain)
		} else {
			// New task started
			telemetryService.captureTaskCreated(this.ulid, currentProvider, openAiCompatibleDomain)
		}

		// Initialize command executor with config and callbacks
		const commandExecutorConfig: FullCommandExecutorConfig = {
			cwd: this.cwd,
			terminalExecutionMode: this.terminalExecutionMode,
			terminalManager: this.terminalManager,
			taskId: this.taskId,
			ulid: this.ulid,
		}

		const commandExecutorCallbacks: CommandExecutorCallbacks = {
			taskMessenger: this.taskMessenger,
			updateBackgroundCommandState: (isRunning: boolean) =>
				(updateBackgroundCommandState ?? this.host.updateBackgroundCommandState.bind(this.host))(
					isRunning,
					this.taskId,
				),
			updateDiracMessage: async (index: number, updates: Partial<import("@shared/ExtensionMessage").DiracMessage>) => {
				await this.messageStateHandler.updateDiracMessage(index, updates)
				await this.postStateToWebview()
			},
			getDiracMessages: () => this.messageStateHandler.getDiracMessages(),
			addToUserMessageContent: (content: { type: string; text: string }) => {
				// Cast to DiracTextContentBlock which is compatible with DiracContent
				this.taskState.userMessageContent.push({ type: "text", text: content.text } as DiracTextContentBlock)
			},
			getEnvironmentVariables: (cwd: string) => HostProvider.get().getEnvironmentVariables(cwd),
		}

		this.commandExecutor = new CommandExecutor(commandExecutorConfig, commandExecutorCallbacks)

		this.toolExecutor = new ToolExecutor(
			this.taskState,
			this.messageStateHandler,
			this.api,
			this.urlContentFetcher,
			this.browserSession,
			(browserSession) => {
				this.browserSession = browserSession
				this.lifecycleManager.setBrowserSession(browserSession)
			},
			this.diffViewProvider,
			this.fileContextTracker,
			this.diracIgnoreController,
			this.commandPermissionController,
			this.contextManager,
			this.taskMessenger,
			this.stateManager,
			cwd,
			this.taskId,
			this.ulid,
			this.terminalExecutionMode,
			this.workspaceManager,
			workingConfiguration.executionOptions.multiRootEnabled,
			() => this.workingConfiguration,
			(requestConfiguration, toolName, mutation) =>
				this.withMutationAuthorization(requestConfiguration, toolName, mutation),
			(transition) => this.mutationGate.transitionFromMutation(transition),
			(completion) => this.mutationGate.retainMutationUntil(completion),
			this.commitEnabledToolToggles.bind(this),
			this.saveCheckpointCallback.bind(this),
			this.commitAttemptCompletion.bind(this),
			this.executeCommandTool.bind(this),
			this.cancelBackgroundCommand.bind(this),
			() => this.checkpointManager?.doesLatestTaskCompletionHaveNewChanges() ?? Promise.resolve(false),
			this.switchToActModeCallback.bind(this),
			this.cancelTask,
			this.postStateToWebview.bind(this),
			this.setActiveHookExecution.bind(this),
			this.clearActiveHookExecution.bind(this),
			this.getActiveHookExecution.bind(this),
			this.runUserPromptSubmitHook.bind(this),
			this.diracContext,
			this.resetTransientState.bind(this),
			this.notifyContextCompacted.bind(this),
			this.executionProfile,
			params.toolEnvironmentFactory ?? new SurfaceToolEnvironmentFactory(),
			params.toolSelectionPolicy,
		)
		this.environmentManager = new EnvironmentManager({
			cwd: this.cwd,
			terminalManager: this.terminalManager,
			taskState: this.taskState,
			fileContextTracker: this.fileContextTracker,
			api: this.api,
			messageStateHandler: this.messageStateHandler,
			getWorkingConfiguration: () => this.workingConfiguration,
			workspaceManager: this.workspaceManager,
			getRequestRuntime: () => this.activeRequestRuntime,
			diracIgnoreController: this.diracIgnoreController,
		})

		this.contextLoader = new ContextLoader({
			ulid: this.ulid,
			stateManager: this.stateManager,
			getRequestRuntime: () => {
				if (!this.activeRequestRuntime) throw new Error("Context loading requires an active request runtime")
				return this.activeRequestRuntime
			},
			cwd: this.cwd,
			urlContentFetcher: this.urlContentFetcher,
			fileContextTracker: this.fileContextTracker,
			workspaceManager: this.workspaceManager,
			diracIgnoreController: this.diracIgnoreController,
			taskState: this.taskState,
			getCurrentProviderInfo: this.getCurrentProviderInfo.bind(this),
			extensionPath: HostProvider.get().extensionFsPath,
			sourceDir: getExtensionSourceDir(),
			getEnvironmentDetails: this.getEnvironmentDetails.bind(this),
			isTextCondensationAvailable: (template) =>
				isUtilityTextCondensationAvailable(
					{
						utilityModelEnabled: this.workingConfiguration.settings.utilityModelEnabled,
						utilityModelUseCondense: this.workingConfiguration.settings.utilityModelUseCondense,
						utilityModelUseNewTask: this.workingConfiguration.settings.utilityModelUseNewTask,
						utilityModelSelection: this.workingConfiguration.settings.utilityModelSelection,
					},
					template,
					createDefaultTextCondensationTemplateRegistry(),
				),
			commandPermissionController: this.commandPermissionController,
			postStateToWebview: () => this.postStateToWebview(),
		})

		this.lifecycleManager = new LifecycleManager({
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			getWorkingConfiguration: () => this.activeRequestRuntime?.workingConfiguration ?? this.workingConfiguration,
			getRequestRuntime: () => this.activeRequestRuntime,
			api: this.api,
			taskId: this.taskId,
			ulid: this.ulid,
			taskMessenger: this.taskMessenger,
			postStateToWebview: this.postStateToWebview,
			cancelTask: this.cancelTask,
			checkpointManager: this.checkpointManager,
			diracIgnoreController: this.diracIgnoreController,
			terminalManager: this.terminalManager,
			urlContentFetcher: this.urlContentFetcher,
			browserSession: this.browserSession,
			diffViewProvider: this.diffViewProvider,
			fileContextTracker: this.fileContextTracker,
			contextManager: this.contextManager,
			commandExecutor: this.commandExecutor,
			commandPermissionController: this.commandPermissionController,
			cwd: this.cwd,
			hookManager: this.hookManager,
			initiateTaskLoop: this.initiateTaskLoop.bind(this),
			restoreQueuedSteeringFromTranscript: this.restoreQueuedSteeringFromTranscript.bind(this),
			recordEnvironment: this.environmentContextTracker.recordEnvironment.bind(this.environmentContextTracker),
			time: () => this.environmentContextTracker.recordEnvironment(),
		})

		this.localConversationCompaction = new LocalConversationCompaction({
			taskId: this.taskId,
			ulid: this.ulid,
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			contextManager: this.contextManager,
			getWorkingConfiguration: () => this.activeRequestRuntime?.workingConfiguration ?? this.workingConfiguration,
			taskMessenger: this.taskMessenger,
			getApi: () => this.activeRequestRuntime?.api ?? this.api,
			postStateToWebview: this.postStateToWebview,
			cancelTask: this.cancelTask,
			setActiveHookExecution: this.hookManager.setActiveHookExecution.bind(this.hookManager),
			clearActiveHookExecution: this.hookManager.clearActiveHookExecution.bind(this.hookManager),
			onContextCompacted: this.notifyContextCompacted.bind(this),
		})

		this.apiConversationManager = new ApiConversationManager({
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			api: this.api,
			contextManager: this.contextManager,
			getWorkingConfiguration: () => this.workingConfiguration,
			getRequestRuntime: () => this.activeRequestRuntime,
			taskId: this.taskId,
			ulid: this.ulid,
			cwd: this.cwd,
			taskMessenger: this.taskMessenger,
			postStateToWebview: this.postStateToWebview,
			diffViewProvider: this.diffViewProvider,
			toolExecutor: this.toolExecutor,
			streamHandler: this.streamHandler,
			withStateLock: this.withStateLock.bind(this),
			loadContext: this.loadContext.bind(this),
			activateSkill: (skillId) => activateTaskSkill(this.taskId, this.taskState, skillId),
			getCurrentProviderInfo: this.getCurrentProviderInfo.bind(this),
			getEnvironmentDetails: this.getEnvironmentDetails.bind(this),
			getPinnedContext: () => this.taskState.pinnedContext,
			writePromptMetadataArtifacts: (params) => writePromptMetadataArtifacts(this.promptArtifactsContext, params),
			handleHookCancellation: this.hookManager.handleHookCancellation.bind(this.hookManager),
			setActiveHookExecution: this.hookManager.setActiveHookExecution.bind(this.hookManager),
			clearActiveHookExecution: this.hookManager.clearActiveHookExecution.bind(this.hookManager),
			taskInitializationStartTime: this.taskInitializationStartTime,
			cancelTask: this.cancelTask,
			runUserPromptSubmitHook: this.runUserPromptSubmitHook.bind(this),
			onContextCompacted: this.notifyContextCompacted.bind(this),
			runLocalConversationCompaction: (source) => this.localConversationCompaction.run({ source }),
		})

		this.responseProcessor = new ResponseProcessor({
			taskState: this.taskState,
			messageStateHandler: this.messageStateHandler,
			api: this.api,
			taskId: this.taskId,
			ulid: this.ulid,
			taskMessenger: this.taskMessenger,
			postStateToWebview: this.postStateToWebview,
			diffViewProvider: this.diffViewProvider,
			streamHandler: this.streamHandler,
			withStateLock: this.withStateLock.bind(this),
			getCurrentProviderInfo: this.getCurrentProviderInfo.bind(this),
			getApiRequestIdSafe: this.getApiRequestIdSafe.bind(this),
			toolExecutor: this.toolExecutor,
			assistantStreamManager: this.assistantStreamManager,
		})
	}

	/** Read-only task-owned configuration. The value is detached and deeply frozen. */
	public getWorkingConfiguration(): TaskWorkingConfiguration {
		return this.workingConfiguration
	}

	/**
	 * Atomically validate and install one explicit update derived from the current
	 * task configuration. No StateManager defaults are recaptured. When supplied,
	 * `beforeCommit` runs only after the candidate configuration and API handler
	 * have been built successfully, while the task-local transition lock is held.
	 */
	public async applyWorkingConfigurationUpdate(
		patch: TaskWorkingConfigurationPatch | ((current: TaskWorkingConfiguration) => TaskWorkingConfigurationPatch),
		beforeCommit?: (candidate: TaskWorkingConfiguration) => void | Promise<void>,
	): Promise<TaskWorkingConfiguration> {
		return this.mutationGate.withTransition(() =>
			this.withStateLock(async () => {
				const previous = this.workingConfiguration
				const resolvedPatch = typeof patch === "function" ? patch(previous) : patch
				const candidate = buildTaskWorkingConfigurationUpdate(previous, resolvedPatch)
				validateApiConfiguration(candidate.apiConfiguration as ApiConfiguration, candidate.settings.mode)
				const candidateApi = this.createApiHandlerForRuntime(
					candidate.apiConfiguration as ApiConfiguration,
					candidate.settings.mode,
				)

				await beforeCommit?.(candidate)

				if (previous.settings.enableCheckpointsSetting !== candidate.settings.enableCheckpointsSetting) {
					this.checkpointManager?.setEnabled(candidate.settings.enableCheckpointsSetting)
				}

				this.workingConfiguration = candidate
				this.installApiHandler(candidateApi)
				this.applyCommittedModeEffects(previous.settings.mode, candidate.settings.mode)
				this.diracIgnoreController.yoloMode = !!candidate.settings.yoloModeToggled
				if (resolvedPatch.settings && Object.hasOwn(resolvedPatch.settings, "toolToggles")) {
					this.toolExecutor.markToolsDirty("tool_toggles_changed")
				}
				return candidate
			}),
		)
	}

	private async commitEnabledToolToggles(toolIds: readonly string[], finalize?: () => Promise<void>): Promise<void> {
		const enabledToolIds = [...new Set(toolIds)]
		if (enabledToolIds.length === 0) {
			await finalize?.()
			return
		}
		await this.applyWorkingConfigurationUpdate(
			(current) => {
				const toolToggles = { ...current.settings.toolToggles }
				for (const toolId of enabledToolIds) toolToggles[toolId] = true
				return { settings: { toolToggles } }
			},
			async (candidate) => {
				this.stateManager.setGlobalState("toolToggles", structuredClone(candidate.settings.toolToggles))
				await finalize?.()
			},
		)
	}

	private withMutationAuthorization<T>(
		requestConfiguration: TaskWorkingConfiguration,
		toolName: DiracToolSpec["id"] | undefined,
		mutation: () => Promise<T>,
	): Promise<T> {
		return this.mutationGate.withMutation(
			() => assertTaskMutationAuthorized(requestConfiguration, this.workingConfiguration, toolName),
			mutation,
		)
	}

	/** Construct a model runtime without installing it on the task. */
	public createApiHandlerForRuntime(configuration: ApiConfiguration, mode: Mode): ApiHandler {
		return buildApiHandler(
			{
				...configuration,
				ulid: this.ulid,
				onRetryAttempt: async (attempt: number, maxRetries: number, delay: number, error: any) => {
					await this.taskMessenger.upsertApiStatus({
						retryStatus: {
							attempt,
							maxAttempts: maxRetries,
							delaySec: Math.round(delay / 1000),
							errorSnippet: error?.message ? `${String(error.message).substring(0, 50)}...` : undefined,
						},
					})
				},
			},
			mode,
		)
	}

	/** Internal propagation of a handler that already matches the committed snapshot. */
	private installApiHandler(api: ApiHandler): void {
		this.api = api
		this.taskMessenger.setApi(api)
		this.hookManager.setApi(api)
		this.toolExecutor.setApi(api)
		this.environmentManager.setApi(api)
		this.lifecycleManager.setApi(api)
		this.apiConversationManager.setApi(api)
		this.responseProcessor.setApi(api)
	}

	private applyCommittedModeEffects(previousMode: Mode, nextMode: Mode): void {
		if (previousMode === nextMode) return
		this.taskState.pendingModeNotice = { mode: nextMode }
		if (previousMode === "plan" && nextMode === "act" && this.taskState.isAwaitingPlanResponse) {
			this.taskState.didRespondToPlanAskBySwitchingMode = true
		}
	}

	async getEnvironmentDetails(includeFileDetails = false): Promise<string> {
		return this.environmentManager.getEnvironmentDetails(includeFileDetails)
	}

	private async persistApiStopReason(stopReason?: string): Promise<void> {
		const runtime = this.activeRequestRuntime ?? createTaskRequestRuntime(this.workingConfiguration, this.api)
		return persistApiStopReason(this.requestOutcomeContext(runtime), stopReason)
	}

	private async handleMistakeLimitReached(
		userContent: DiracContent[],
	): Promise<{ didEndLoop: boolean; userContent: DiracContent[] }> {
		return handleMistakeLimitReached(
			{
				taskState: this.taskState,
				settings: this.workingConfiguration.settings,
				taskMessenger: this.taskMessenger,
				postStateToWebview: () => this.postStateToWebview(),
			},
			userContent,
		)
	}

	async loadContext(
		userContent: DiracContent[],
		includeFileDetails = false,
		useCompactPrompt = false,
	): Promise<[DiracContent[], string, boolean, SkillMetadata[], boolean, string?, SlashCommandDirectAction[]?]> {
		return this.contextLoader.loadContext(userContent, includeFileDetails, useCompactPrompt)
	}

	// Communicate with webview

	public async resetTransientState(): Promise<void> {
		// Compaction clears visibility caches, but anchors remain part of the same
		// conversation protocol and must survive the transient-context reset.
		await this.diracContext.resetTaskContext()
		this.taskState.consecutiveMistakeCount = 0
		this.taskState.didAttemptCompletion = false
		this.taskState.detachVoiceStream()
		await this.postStateToWebview()
	}

	private async waitForFollowUp(): Promise<DiracContent[] | undefined> {
		return waitForFollowUp({ taskState: this.taskState })
	}

	/** Persist a project-scoped tool permission rule for an ACP “always” decision. */
	public async addPermissionRule(rule: import("@core/permissions/types").ToolPermissionRule): Promise<void> {
		await this.commandPermissionController.addRule(rule)
	}

	/** List project-scoped ACP permission rules. */
	public async listPermissionRules(): Promise<import("@core/permissions/types").ToolPermissionRule[]> {
		return await this.commandPermissionController.listRules()
	}

	/** Delete one project-scoped ACP permission rule. */
	public async deletePermissionRule(rule: import("@core/permissions/types").ToolPermissionRule): Promise<void> {
		await this.commandPermissionController.deleteRule(rule)
	}

	public async submitCardResponse(
		cardId: string,
		response: DiracAskResponse | string,
		text?: string,
		images?: string[],
		files?: string[],
		value?: string,
	) {
		await this.withStateLock(async () => {
			return submitCardResponse({ taskState: this.taskState }, { cardId, response, text, images, files, value })
		})
	}

	private async saveCheckpointCallback(isAttemptCompletionMessage?: boolean, completionMessageId?: string): Promise<void> {
		if (isAttemptCompletionMessage) {
			this.taskState.didAttemptCompletion = true
		}
		return this.checkpointManager?.saveCheckpoint(isAttemptCompletionMessage, completionMessageId) ?? Promise.resolve()
	}

	private async switchToActModeCallback(): Promise<boolean> {
		return await this.switchToActMode()
	}

	private async runUserPromptSubmitHook(
		userContent: DiracContent[],
		context: "initial_task" | "resume" | "feedback",
	): Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }> {
		return this.hookManager.runUserPromptSubmitHook(userContent, context)
	}

	public async startTask(task?: string, images?: string[], files?: string[]): Promise<TaskRunOutcome> {
		return this.runTaskLifecycle(async () => {
			await this.toolExecutor.refreshToolsForTask()
			return this.lifecycleManager.startTask(task, images, files)
		})
	}

	public restoreQueuedSteeringFromTranscript(): void {
		restoreQueuedSteeringFromTranscript(this.steeringContext)
	}

	public async resumeTaskFromHistory(onRestored?: () => void, options: ResumeTaskOptions = {}): Promise<TaskRunOutcome> {
		return this.runTaskLifecycle(async () => {
			await this.toolExecutor.refreshToolsForTask()
			return this.lifecycleManager.resumeTaskFromHistory(onRestored, options)
		})
	}

	public markToolsDirty(reason: ToolSnapshotDirtyReason): void {
		this.toolExecutor.markToolsDirty(reason)
	}

	private async initiateTaskLoop(userContent: DiracContent[]): Promise<TaskRunOutcome> {
		let outcome: TaskRunOutcome | undefined
		try {
			let nextUserContent = userContent
			let includeFileDetails = true
			while (!this.taskState.abort) {
				const didEndLoop = await this.recursivelyMakeDiracRequests(nextUserContent, includeFileDetails)
				includeFileDetails = false // we only need file details the first time

				if (!didEndLoop) continue

				// Automatic-condense state survives in-request retries, but not a terminal turn boundary.
				this.taskState.pendingCondenseSource = undefined
				if (this.executionProfile === "standalone" && this.taskState.didAttemptCompletion) {
					const followUp = await this.waitForFollowUp()
					if (followUp) {
						await this.taskMessenger.upsertText(
							this.taskState.askResponseText || "",
							false,
							this.taskState.askResponseImages,
							this.taskState.askResponseFiles,
							"user",
						)
						nextUserContent = [...this.taskState.userMessageContent, ...followUp]
						this.taskState.didAttemptCompletion = false
						this.taskState.clearCompletionResponse()
						continue
					}
				}
				break
			}
			outcome = this.taskRunOutcomeFromState()
		} catch (error) {
			outcome = this.taskState.abort
				? this.taskRunOutcomeFromState()
				: { kind: "failed", error: serializeTaskError(error), failedAt: Date.now() }
		}

		try {
			// Flush task history at the end of the task loop (turn boundary).
			await this.messageStateHandler.flushTaskHistory()
		} catch (error) {
			outcome = { kind: "failed", error: serializeTaskError(error), failedAt: Date.now() }
		}

		return outcome
	}

	private async runTaskLifecycle(run: () => Promise<TaskRunOutcome | undefined>): Promise<TaskRunOutcome> {
		let outcome: TaskRunOutcome
		try {
			outcome = (await run()) ?? this.taskRunOutcomeFromState()
		} catch (error) {
			outcome = { kind: "failed", error: serializeTaskError(error), failedAt: Date.now() }
		}
		return this.settleTaskRun(outcome)
	}

	private taskRunOutcomeFromState(): TaskRunOutcome {
		const intent = this.taskState.cancellationIntent
		if (intent?.kind === "interrupted") {
			return {
				kind: "interrupted",
				reason: intent.reason ?? "Interrupted by Task owner",
				interruptedAt: Date.now(),
			}
		}
		if (intent?.kind === "cancelled" || this.taskState.abort) {
			return { kind: "cancelled", reason: intent?.reason, cancelledAt: Date.now() }
		}
		if (this.taskState.completionResponse !== undefined) {
			return { kind: "completed", response: this.taskState.completionResponse, completedAt: Date.now() }
		}
		if (this.taskState.terminalError) {
			return { kind: "failed", error: this.taskState.terminalError, failedAt: Date.now() }
		}
		return {
			kind: "failed",
			error: serializeTaskError(new Error("Task run ended without a terminal response")),
			failedAt: Date.now(),
		}
	}

	private async settleTaskRun(candidate: TaskRunOutcome): Promise<TaskRunOutcome> {
		let outcome = candidate
		if (this.executionProfile !== "standalone") {
			try {
				await this.lifecycleManager.finalizeTaskRun()
			} catch (error) {
				const failures: unknown[] = [error]
				if (candidate.kind === "failed") {
					failures.unshift(new Error(`${candidate.error.name}: ${candidate.error.message}`))
				}
				outcome = {
					kind: "failed",
					error: serializeTaskError(new AggregateError(failures, "Task termination failed")),
					failedAt: Date.now(),
				}
			}
		}

		return this.withStateLock(() => {
			// settleTaskRun is idempotent: an already-settled outcome wins over the candidate.
			if (this.taskState.runOutcome) return this.taskState.runOutcome
			return this.taskState.settleRunOutcome(outcome)
		})
	}

	private async shouldRunTaskCancelHook(): Promise<boolean> {
		return this.hookManager.shouldRunTaskCancelHook()
	}

	async abortTask(intent: TaskCancellationIntent = { kind: "cancelled" }): Promise<void> {
		await this.withStateLock(() => this.taskState.captureCancellationIntent(intent))
		if (this.taskState.status !== TaskStatus.CANCELLED) {
			this.taskState.status = TaskStatus.CANCELLING
		}

		return this.lifecycleManager.abortTask()
	}

	async retirePersistence(): Promise<void> {
		await this.messageStateHandler.retirePersistence()
	}

	// Tools
	async executeCommandTool(
		command: string,
		timeoutSeconds: number | undefined,
		options?: CommandExecutionOptions,
	): Promise<CommandExecutionResult> {
		return this.commandExecutor.execute(command, timeoutSeconds, options)
	}

	/**
	 * Cancel a background command that is running in the background
	 * @returns true if a command was cancelled, false if no command was running
	 */
	public async cancelBackgroundCommand(): Promise<boolean> {
		return this.commandExecutor.cancelBackgroundCommand()
	}

	public async cancelHookExecution(): Promise<boolean> {
		return this.hookManager.cancelHookExecution()
	}

	private getCurrentProviderInfo(requestRuntime = this.activeRequestRuntime): ApiProviderInfo {
		const configuration = requestRuntime?.workingConfiguration ?? this.workingConfiguration
		const api = requestRuntime?.api ?? this.api
		const model = api.getModel()
		const mode = configuration.settings.mode
		const apiConfig = configuration.apiConfiguration
		const providerId = (mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		return {
			model,
			providerId,
			customPrompt: configuration.settings.customPrompt,
			mode,
			supportsNativeWebSearch: api.supportsNativeWebSearch?.() === true,
		}
	}

	private async writePromptMetadataArtifacts(params: {
		systemPrompt: string
		providerInfo: ApiProviderInfo
		tools?: any[]
		fullHistory?: any[]
		deletedRange?: [number, number]
	}): Promise<void> {
		return writePromptMetadataArtifacts(this.promptArtifactsContext, params)
	}

	private getApiRequestIdSafe(): string | undefined {
		const apiLike = this.api as Partial<{
			getLastRequestId: () => string | undefined
			lastGenerationId?: string
		}>
		return apiLike.getLastRequestId?.() ?? apiLike.lastGenerationId
	}

	private async handleContextWindowExceededError(): Promise<void> {
		return this.apiConversationManager.handleContextWindowExceededError()
	}

	private async handleApiRequestError(params: {
		error: unknown
		previousApiReqIndex: number
		lastApiReqIndex: number
		shouldCompact?: boolean
		model: { id: string; info: { contextWindow?: number } }
		providerId: string
		metricsManager: StreamingMetricsManager
	}): Promise<boolean> {
		const runtime = this.activeRequestRuntime ?? createTaskRequestRuntime(this.workingConfiguration, this.api)
		return handleApiRequestError(this.requestOutcomeContext(runtime), params)
	}

	private async resetStreamingState(): Promise<void> {
		this.responseProcessor.resetStreamState()
		this.taskState.assistantMessageContent = []
		this.taskState.resetStreamRead()
		this.taskState.userMessageContent = []
		this.taskState.userMessageContentReady = false
		this.taskState.didRejectTool = false
		this.taskState.didAlreadyUseTool = false
		await this.diffViewProvider.reset()
		this.streamHandler.reset()
		this.taskState.toolUseIdMap.clear()
		this.taskState.detachVoiceStream()
	}

	async *attemptApiRequest(previousApiReqIndex: number, lastApiReqIndex: number, shouldCompact?: boolean): ApiStream {
		const runtime = this.activeRequestRuntime ?? createTaskRequestRuntime(this.workingConfiguration, this.api)
		yield* attemptApiRequest(this.requestLoopContext(runtime), previousApiReqIndex, lastApiReqIndex, shouldCompact)
	}

	async presentAssistantMessage() {
		return this.responseProcessor.presentAssistantMessage()
	}

	async recursivelyMakeDiracRequests(userContent: DiracContent[], includeFileDetails = false): Promise<boolean> {
		const runtime = createTaskRequestRuntime(this.workingConfiguration, this.api)
		this.activeRequestRuntime = runtime
		try {
			return await recursivelyMakeDiracRequests(this.requestLoopContext(runtime), userContent, includeFileDetails)
		} finally {
			if (this.activeRequestRuntime === runtime) this.activeRequestRuntime = undefined
		}
	}

	private async initializeCheckpoints(isFirstRequest: boolean): Promise<void> {
		return this.lifecycleManager.initializeCheckpoints(isFirstRequest)
	}

	private async determineContextCompaction(previousApiReqIndex: number): Promise<boolean> {
		return this.apiConversationManager.determineContextCompaction(previousApiReqIndex)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/TaskRequestLoop.ts (lines 47-447)
```
export async function recursivelyMakeDiracRequests(
	ctx: TaskRequestLoopContext,
	userContent: DiracContent[],
	includeFileDetails = false,
): Promise<boolean> {
	ctx.taskState.status = TaskStatus.PREPARING

	if (ctx.taskState.abort) {
		throw new Error("Task instance aborted")
	}
	await ctx.enqueuePreRequestSteeringMessages()

	const { settings, apiConfiguration } = ctx.requestRuntime.workingConfiguration
	const mode = settings.mode
	const model = ctx.requestRuntime.api.getModel()
	const providerId = (mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider) as string
	const customPrompt = settings.customPrompt
	if (providerId && model.id) {
		try {
			await ctx.modelContextTracker.recordModelUsage(providerId, model.id, mode)
		} catch (error) {
			Logger.error("Failed to record model usage:", error)
		}
	}

	const modelInfo: DiracMessageModelInfo = {
		modelId: model.id,
		providerId: providerId,
		mode: mode,
	}

	const mistakeResult = await ctx.handleMistakeLimitReached(userContent)
	if (mistakeResult.didEndLoop) {
		return true
	}
	userContent = mistakeResult.userContent

	const previousApiStatus = ctx.messageStateHandler.getLatestApiStatusMessage()
	const previousApiReqIndex = previousApiStatus ? ctx.messageStateHandler.findMessageIndexById(previousApiStatus.id) : -1
	const isFirstRequest = previousApiStatus === undefined

	await ctx.initializeCheckpoints(isFirstRequest)

	const useCompactPrompt =
		customPrompt === "compact" && isLocalModel({ model, providerId, customPrompt, mode, supportsNativeWebSearch: false })
	let shouldCompact = await ctx.determineContextCompaction(previousApiReqIndex)
	if (shouldCompact && ctx.localConversationCompaction.isAvailable()) {
		const continuation = await ctx.localConversationCompaction.run({
			source: "automatic",
			triggerApiRequestIndex: previousApiReqIndex,
			pendingUserContent: userContent,
		})
		if (!continuation) return true

		const compactedContext: DiracContent[] = [{ type: "text", text: continuation }]
		if (ctx.taskState.pinnedContext) {
			compactedContext.push({ type: "text", text: ctx.taskState.pinnedContext })
		}
		userContent = [...compactedContext, ...userContent]
		shouldCompact = false
	}
	const steeringClaim = await appendQueuedSteeringToUserContent(ctx.steeringContext, userContent)

	ctx.taskState.status = TaskStatus.BUILDING_REQUEST

	let apiRequestData: Awaited<ReturnType<ApiConversationManager["prepareApiRequest"]>>
	let steeringClaimConsumed = false
	const conversationPersistence = new TaskConversationPersistence(ctx.conversationPersistenceHooks)
	try {
		apiRequestData = await ctx.apiConversationManager.prepareApiRequest({
			userContent,
			shouldCompact,
			includeFileDetails,
			useCompactPrompt,
			previousApiReqIndex,
			isFirstRequest,
			providerId,
			modelId: model.id,
			mode: modelInfo.mode,
			requestId: ctx.requestRuntime.requestId,
			afterUserContentPersisted: async () => {
				await conversationPersistence.persist(() => ctx.messageStateHandler.flushPendingWrites())
				steeringClaimConsumed = true
				if (!steeringClaim) return
				await settleConsumedSteeringClaim(ctx.steeringContext, steeringClaim)
			},
		})
		await conversationPersistence.rollback()
		if (steeringClaim && !steeringClaimConsumed) {
			if (apiRequestData.didConsumeUserContent) {
				steeringClaimConsumed = true
				await settleConsumedSteeringClaim(ctx.steeringContext, steeringClaim)
			} else {
				await rollbackSteeringClaim(ctx.steeringContext, steeringClaim.id)
			}
		}
	} catch (error) {
		let rollbackError: unknown
		try {
			await conversationPersistence.rollback()
		} catch (failure) {
			rollbackError = failure
		}
		if (steeringClaim && !steeringClaimConsumed) await rollbackSteeringClaim(ctx.steeringContext, steeringClaim.id)
		if (rollbackError) throw new AggregateError([error, rollbackError], "Task conversation persistence rollback failed")
		throw error
	}
	userContent = apiRequestData.userContent
	const lastApiReqIndex = apiRequestData.lastApiReqIndex

	if (apiRequestData.isDirectResponse) {
		if (apiRequestData.directResponseText) {
			await ctx.taskMessenger.upsertText(apiRequestData.directResponseText)
		}
		return true
	}

	try {
		const metricsManager = new StreamingMetricsManager(ctx.messageStateHandler, lastApiReqIndex, ctx.requestRuntime.api)
		let didFinalizeApiReqMsg = false
		let usageChunkSideEffectsQueue = Promise.resolve()

		const queueUsageChunkSideEffects = (
			usageInputTokens: number,
			usageOutputTokens: number,
			chunkOptions?: { cacheWriteTokens?: number; cacheReadTokens?: number; totalCost?: number; stopReason?: string },
		) => {
			usageChunkSideEffectsQueue = usageChunkSideEffectsQueue.then(async () => {
				if (didFinalizeApiReqMsg || ctx.taskState.abort) {
					return
				}

				await metricsManager.updateApiReqMsgFromMetrics()
				await ctx.postStateToWebview()
				await telemetryService.captureTokenUsage(
					ctx.ulid,
					usageInputTokens,
					usageOutputTokens,
					providerId,
					model.id,
					chunkOptions,
				)
			})
		}

		const finalizeApiReqMsg = async (cancelReason?: DiracApiReqCancelReason, streamingFailedMessage?: string) => {
			didFinalizeApiReqMsg = true
			await usageChunkSideEffectsQueue
			await metricsManager.updateApiReqMsgFromMetrics(cancelReason, streamingFailedMessage)

			const metrics = metricsManager.getMetrics()
			ctx.taskState.totalInputTokens += metrics.inputTokens
			ctx.taskState.totalOutputTokens += metrics.outputTokens
			ctx.taskState.totalReasoningTokens += metrics.reasoningTokens
			ctx.taskState.totalCacheWriteTokens += metrics.cacheWriteTokens
			ctx.taskState.totalCacheReadTokens += metrics.cacheReadTokens
			const cost = metricsManager.getTotalCost()
			if (cost !== undefined) ctx.taskState.totalCost += cost

			if (ctx.messageStateHandler.getLatestApiStatusMessage()) {
				ctx.taskState.endApiRequest()
			}
		}

		const abortStream = async (cancelReason: DiracApiReqCancelReason, streamingFailedMessage?: string) => {
			Session.get().finalizeRequest()

			if (ctx.diffViewProvider.isEditing) {
				await ctx.diffViewProvider.revertChanges()
			}

			ctx.taskState.endApiRequest()
			await finalizeApiReqMsg(cancelReason, streamingFailedMessage)
			await ctx.messageStateHandler.saveDiracMessagesAndUpdateHistory()

			const metrics = metricsManager.getMetrics()
			await ctx.messageStateHandler.addToApiConversationHistory({
				role: "assistant",
				content: [
					{
						type: "text",
						text:
							assistantMessage +
							`\n\n[${
								cancelReason === "streaming_failed"
									? "Response interrupted by API Error"
									: "Response interrupted by user"
							}]`,
					},
				],
				modelInfo,
				metrics: {
					tokens: {
						prompt: metrics.inputTokens,
						completion: metrics.outputTokens,
						cached: (metrics.cacheWriteTokens ?? 0) + (metrics.cacheReadTokens ?? 0),
					},
					cost: metrics.totalCost,
				},
				ts: Date.now(),
			})

			telemetryService.captureConversationTurnEvent(
				ctx.ulid,
				providerId,
				modelInfo.modelId,
				"assistant",
				modelInfo.mode,
				undefined,
				ctx.taskState.useNativeToolCalls,
			)

			ctx.taskState.markStreamAbortFinished()
		}

		await ctx.resetStreamingState()

		const { toolUseHandler, reasonsHandler } = ctx.streamHandler.getHandlers()
		const stream = attemptApiRequest(ctx, previousApiReqIndex, lastApiReqIndex, shouldCompact)

		let assistantMessageId = ""
		let assistantMessage = ""
		let assistantTextOnly = ""
		let assistantTextSignature: string | undefined

		let didReceiveUsageChunk = false
		let stopReason: string | undefined
		let didFinalizeReasoningForUi = false

		const finalizePendingReasoningMessage = async (thinking: string): Promise<boolean> => {
			const activeVoiceStreamId = ctx.taskState.activeVoiceStreamId
			if (!activeVoiceStreamId) {
				return false
			}

			const message = ctx.messageStateHandler.getMessageById(activeVoiceStreamId)
			if (message?.content.type !== DiracMessageType.MARKDOWN || !message.content.isReasoning) return false

			const previousThinking = message.content.content
			if (thinking.startsWith(previousThinking)) {
				const suffix = thinking.slice(previousThinking.length)
				if (suffix) {
					await ctx.messageStateHandler.appendMarkdownById(activeVoiceStreamId, suffix)
				} else {
					// No suffix means the reasoning already streamed in full. getMessageById above
					// materialized it server-side but emitted no presentation operation, so the
					// client's buffered chunks would never be merged into the message — and once
					// activeVoiceStreamId clears below, the row stops reading the live buffer and
					// renders an empty body. Patch unconditionally, as TaskMessenger.close() does.
					await ctx.messageStateHandler.patchMessageById(activeVoiceStreamId, {
						content: { ...message.content },
					})
				}
			} else if (thinking !== previousThinking) {
				const index = ctx.messageStateHandler.findMessageIndexById(activeVoiceStreamId)
				await ctx.messageStateHandler.updateDiracMessage(index, {
					content: { type: DiracMessageType.MARKDOWN, content: thinking, isReasoning: true },
				})
			}
			await ctx.postStateToWebview()
			ctx.taskState.detachVoiceStream()
			return true
		}

		Session.get().startApiCall()
		ctx.taskState.beginApiRequest()
		let streamCoordinator: StreamChunkCoordinator | undefined

		try {
			streamCoordinator = new StreamChunkCoordinator(stream, {
				onUsageChunk: (chunk) => {
					ctx.streamHandler.setRequestId(chunk.id)
					didReceiveUsageChunk = true
					metricsManager.updateFromChunk(chunk)
					stopReason = chunk.stopReason ?? stopReason
					queueUsageChunkSideEffects(chunk.inputTokens, chunk.outputTokens, {
						cacheWriteTokens: chunk.cacheWriteTokens,
						cacheReadTokens: chunk.cacheReadTokens,
						totalCost: chunk.totalCost,
						stopReason: chunk.stopReason,
					})
				},
			})

			const streamResult = await ctx.responseProcessor.consumeStream(streamCoordinator, {
				abortStream,
				finalizePendingReasoningMessage,
				apiAbort: () => ctx.requestRuntime.api.abort?.(),
			})

			assistantMessage = streamResult.assistantMessage
			assistantTextOnly = streamResult.assistantTextOnly
			assistantTextSignature = streamResult.assistantTextSignature
			assistantMessageId = streamResult.assistantMessageId
			didFinalizeReasoningForUi = streamResult.didFinalizeReasoningForUi
			const shouldInterruptStream = streamResult.shouldInterruptStream

			if (shouldInterruptStream) {
				await streamCoordinator.stop()
			} else {
				await streamCoordinator.waitForCompletion()
			}
			await usageChunkSideEffectsQueue

			if (!ctx.taskState.abort && !didFinalizeReasoningForUi) {
				const finalReasoning = reasonsHandler.getCurrentReasoning()
				if (finalReasoning?.thinking) {
					await finalizePendingReasoningMessage(finalReasoning.thinking)
					didFinalizeReasoningForUi = true
				}
			}
		} catch (error) {
			await streamCoordinator?.stop()
			if (ctx.taskState.abort || ctx.taskState.abandoned) {
				return true
			}

			const diracError = ErrorService.get().toDiracError(error, ctx.requestRuntime.api.getModel().id)
			const errorMessage = diracError.serialize()
			if (ctx.executionProfile !== "standalone") {
				await abortStream("streaming_failed", errorMessage)
				throw diracError
			}
			await ctx.abortTask()
			await abortStream("streaming_failed", errorMessage)
			await ctx.reinitExistingTaskFromId()
			return true
		} finally {
			Session.get().endApiCall()
		}

		if (!didReceiveUsageChunk) {
			const apiStreamUsage = await ctx.requestRuntime.api.getApiStreamUsage?.()
			if (apiStreamUsage) {
				metricsManager.updateFromChunk(apiStreamUsage)
				queueUsageChunkSideEffects(apiStreamUsage.inputTokens, apiStreamUsage.outputTokens, {
					cacheWriteTokens: apiStreamUsage.cacheWriteTokens,
					cacheReadTokens: apiStreamUsage.cacheReadTokens,
					totalCost: apiStreamUsage.totalCost,
					stopReason: apiStreamUsage.stopReason,
				})
			}
		}

		const autoRetryApiStatus = ctx.messageStateHandler.getLatestApiStatusMessage()
		if (autoRetryApiStatus?.content.type === DiracMessageType.API_STATUS) {
			await ctx.messageStateHandler.patchApiStatusById(autoRetryApiStatus.id, {}, ["retryStatus"])
		}

		await finalizeApiReqMsg()
		await persistApiStopReason(ctx, stopReason)
		await ctx.messageStateHandler.saveDiracMessagesAndUpdateHistory()
		await ctx.postStateToWebview()

		if (ctx.taskState.abort) {
			throw new Error("Dirac instance aborted")
		}

		const assistantHasContent = await ctx.responseProcessor.routeAssistantResponse({
			assistantMessage,
			assistantTextOnly,
			assistantTextSignature,
			assistantMessageId,
			providerId,
			modelId: model.id,
			mode: modelInfo.mode,
			taskMetrics: metricsManager.getMetrics(),
			modelInfo,
			toolUseHandler,
		})

		return await processStreamResult(ctx, {
			assistantHasContent,
			stopReason,
			userContent,
			metricsManager,
			modelInfo,
			providerId,
			model,
		})
	} catch (error) {
		if (ctx.taskState.abort) {
			// User-initiated abort — not a fatal error, no card needed
			return true
		}
		const diracError = ErrorService.get().toDiracError(error)
		Logger.error("[Task] Fatal error in task loop:", diracError.serialize())
		if (ctx.executionProfile !== "standalone") throw diracError
		try {
			const card = await ctx.taskMessenger.createCard({
				status: CardStatus.ERROR,
				header: "Task Error",
				body: `The task encountered an unexpected error and had to stop.\n\n${diracError.toDisplayMessage()}`,
			})
			await card.finalize(CardStatus.ERROR)
		} catch (sayError) {
			Logger.error("[Task] Failed to emit error message:", sayError)
		}
		return true
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/ToolExecutor.ts (lines 51-555)
```
export class ToolExecutor {
	private coordinator: ToolExecutorCoordinator
	private snapshotManager: ToolSnapshotManager
	private hookRunner: ToolHookRunner
	private resultPusher: ToolResultPusher
	private errorHandler: ToolErrorHandler
	private activeRequestRuntime?: TaskRequestRuntime
	private buildingRequestRuntime?: TaskRequestRuntime

	private static readonly PLAN_MODE_RESTRICTED_TOOLS: DiracDefaultTool[] = [
		DiracDefaultTool.FILE_NEW,
		DiracDefaultTool.EDIT_FILE,
		DiracDefaultTool.EDIT_AST,
	]

	constructor(
		private taskState: TaskState,
		private messageStateHandler: MessageStateHandler,
		private api: ApiHandler,
		private urlContentFetcher: UrlContentFetcher,
		private browserSession: BrowserSession,
		private installBrowserSession: (browserSession: BrowserSession) => void,
		private diffViewProvider: DiffViewProvider,
		private fileContextTracker: FileContextTracker,
		private diracIgnoreController: DiracIgnoreController,
		private commandPermissionController: CommandPermissionController,
		private contextManager: ContextManager,
		private taskMessenger: import("./TaskMessenger").TaskMessenger,
		private stateManager: StateManager,
		private cwd: string,
		private taskId: string,
		private ulid: string,
		private terminalExecutionMode: "vscodeTerminal" | "backgroundExec",
		private workspaceManager: WorkspaceRootManager | undefined,
		private isMultiRootEnabled: boolean,
		private getCurrentWorkingConfiguration: () => TaskWorkingConfiguration,
		private withTaskMutationAuthorization: <T>(
			requestConfiguration: TaskWorkingConfiguration,
			toolName: DiracToolSpec["id"] | undefined,
			mutation: () => Promise<T>,
		) => Promise<T>,
		private transitionFromMutation: <T>(transition: () => Promise<T>) => Promise<T>,
		private retainMutationUntil: (completion: Promise<void>) => void,
		private commitEnabledToolToggles: (toolIds: readonly string[], finalize?: () => Promise<void>) => Promise<void>,
		private saveCheckpoint: (isAttemptCompletionMessage?: boolean, completionMessageId?: string) => Promise<void>,
		private commitAttemptCompletion: (response: string) => Promise<
			import("./tools/interfaces/IToolEnvironment").CompletionCommitResult
		>,
		private executeCommandTool: (
			command: string,
			timeoutSeconds: number | undefined,
			options?: CommandExecutionOptions,
		) => Promise<import("@integrations/terminal").CommandExecutionResult>,
		private cancelRunningCommandTool: () => Promise<boolean>,
		private doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>,
		private switchToActMode: () => Promise<boolean>,
		private cancelTask: () => Promise<void>,
		private postStateToWebview: () => Promise<void>,
		private setActiveHookExecution: (hookExecution: NonNullable<typeof taskState.activeHookExecution>) => Promise<void>,
		private clearActiveHookExecution: () => Promise<void>,
		private getActiveHookExecution: () => Promise<typeof taskState.activeHookExecution>,
		private runUserPromptSubmitHook: (
			userContent: DiracContent[],
			context: "initial_task" | "resume" | "feedback",
		) => Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }>,
		private diracContext: IDiracContext,
		private resetTransientState: () => Promise<void>,
		private notifyContextCompacted: () => void,
		private executionProfile: TaskExecutionProfile,
		private environmentFactory: ToolEnvironmentFactory,
		private toolSelectionPolicy: import("./tools/runtime/ToolSelectionPolicy").ToolSelectionPolicy | undefined,
	) {
		this.coordinator = new ToolExecutorCoordinator(environmentFactory)
		this.snapshotManager = new ToolSnapshotManager({
			createTaskConfig: (coordinator) => this.asToolConfig(coordinator),
			getTaskId: () => this.taskId,
			getWorkspaceRoot: () => this.workspaceManager?.getPrimaryRoot()?.path,
			getToggles: () => this.requestRuntime().workingConfiguration.settings.toolToggles || {},
			getSelectionPolicy: () => this.toolSelectionPolicy,
			getActiveSkills: () => {
				const activeIds = new Set(this.taskState.activeSkillIds)
				return this.taskState.availableSkills.filter((skill) => activeIds.has(skill.name))
			},
			isToolAvailable: (tool) => isDiscoveredToolAvailableToTaskProfile(this.executionProfile, tool),
			environmentFactory: this.environmentFactory,
		})
		this.hookRunner = new ToolHookRunner(
			taskState,
			messageStateHandler,
			taskMessenger,
			taskId,
			setActiveHookExecution,
			clearActiveHookExecution,
		)
		this.resultPusher = new ToolResultPusher(taskState)
		this.errorHandler = new ToolErrorHandler(taskState, taskMessenger)
	}

	public setApi(api: ApiHandler): void {
		this.api = api
	}

	private requestAutoApprover(): AutoApprove {
		return new AutoApprove(
			this.commandPermissionController,
			() => this.getCurrentWorkingConfiguration().settings,
			this.getCurrentWorkingConfiguration().executionOptions.multiRootEnabled,
		)
	}

	private shouldAutoApproveTool(toolName: DiracDefaultTool): boolean | [boolean, boolean] {
		return this.requestAutoApprover().shouldAutoApproveTool(toolName)
	}

	private assertMutationAuthorized(toolName?: DiracToolSpec["id"]): void {
		assertTaskMutationAuthorized(this.requestRuntime().workingConfiguration, this.getCurrentWorkingConfiguration(), toolName)
	}

	private withMutationAuthorization<T>(toolName: DiracToolSpec["id"] | undefined, mutation: () => Promise<T>): Promise<T> {
		return this.withTaskMutationAuthorization(this.requestRuntime().workingConfiguration, toolName, mutation)
	}

	private async shouldAutoApproveToolWithPath(
		blockname: DiracToolSpec["id"],
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		if (!Object.values(DiracDefaultTool).includes(blockname as DiracDefaultTool)) return false
		const approved = await this.requestAutoApprover().shouldAutoApproveToolWithPath(
			blockname as DiracDefaultTool,
			autoApproveActionpath,
		)
		this.assertMutationAuthorized(blockname)
		return approved
	}

	private async resolveToolPathPermission(
		blockname: DiracToolSpec["id"],
		autoApproveActionpath: string | undefined,
	): Promise<ToolPermissionDisposition> {
		if (!Object.values(DiracDefaultTool).includes(blockname as DiracDefaultTool)) return "manual_only"
		const disposition = await this.requestAutoApprover().resolveToolPathPermission(
			blockname as DiracDefaultTool,
			autoApproveActionpath,
		)
		this.assertMutationAuthorized(blockname)
		return disposition
	}

	private requestRuntime(): TaskRequestRuntime {
		const runtime = this.buildingRequestRuntime ?? this.activeRequestRuntime
		if (!runtime) throw new Error("Tool execution has no request-bound runtime")
		if (runtime.toolSnapshot && runtime.toolSnapshot.requestId !== runtime.requestId) {
			throw new Error("Active tool snapshot does not belong to the request-bound runtime")
		}
		return runtime
	}

	private requestProviderId(runtime = this.requestRuntime()): string {
		const { mode } = runtime.workingConfiguration.settings
		const configuration = runtime.workingConfiguration.apiConfiguration
		return ((mode === "plan" ? configuration.planModeApiProvider : configuration.actModeApiProvider) ??
			configuration.apiProvider ??
			"unknown") as string
	}

	private createUtilityRunner(
		selection: ModelProviderSelection,
		options: Parameters<typeof createUtilityModelRunner>[2] = {},
		apiConfiguration = this.requestRuntime().workingConfiguration.apiConfiguration,
	) {
		const observer = options.onUsage
		return createUtilityModelRunner(apiConfiguration as ApiConfiguration, selection, {
			...options,
			ulid: this.ulid,
			onUsage: (event) => {
				recordUtilityModelUsage(this.taskState, this.ulid, event)
				observer?.(event)
			},
		})
	}


	private createPermissionDecisionBinding(
		configuration = this.requestRuntime().workingConfiguration,
	): PermissionDecisionServiceBinding | undefined {
		const settings = configuration.settings
		if (!settings.utilityModelUsePermissionHandling) return undefined
		if (typeof settings.utilityModelPermissionPolicy !== "string" || settings.utilityModelPermissionPolicy.trim() === "") {
			return undefined
		}

		const selection = getConfiguredUtilityModelSelection(settings.utilityModelSelection)
		if (!selection) return undefined

		return {
			service: new UtilityPermissionDecisionService(
				this.createUtilityRunner(selection, {}, configuration.apiConfiguration),
				settings.utilityModelPermissionPolicy,
				(error) => Logger.warn("Utility permission decision failed; escalating to the user", error),
			),
			configurationRevision: configuration.revision,
		}
	}

	private createSubagentRuntime(options: {
		modelId?: string
		utilityModelSelection?: ModelProviderSelection
	}): SubagentRuntime {
		const requestRuntime = this.requestRuntime()
		const configuration = requestRuntime.workingConfiguration.apiConfiguration as ApiConfiguration
		let handler: ApiHandler
		let providerId: string
		if (options.utilityModelSelection) {
			handler = buildApiHandlerForSelection(configuration, options.utilityModelSelection, { ulid: this.ulid })
			providerId = options.utilityModelSelection.provider
		} else {
			const mode = requestRuntime.workingConfiguration.settings.mode
			const candidate = { ...configuration, ulid: this.ulid } as ApiConfiguration
			providerId = ((mode === "plan" ? candidate.planModeApiProvider : candidate.actModeApiProvider) ??
				candidate.apiProvider ??
				"unknown") as string
			const modelId = options.modelId?.trim()
			if (modelId && providerId !== "unknown") {
				; (candidate as Record<string, unknown>)[getProviderModelIdKey(providerId as ApiProvider, mode)] = modelId
			}
			handler = buildApiHandler(candidate, mode)
		}

		return Object.freeze({
			providerId,
			model: deepFreezeConfiguration(structuredClone(handler.getModel())),
			supportsNativeWebSearch: handler.supportsNativeWebSearch?.() === true,
			createMessage: handler.createMessage.bind(handler),
			abort: () => handler.abort?.(),
		})
	}

	private asToolConfig(coordinator = this.coordinator): TaskConfig {
		const runtime = this.requestRuntime()
		const settings = runtime.workingConfiguration.settings
		const currentSettings = () => this.getCurrentWorkingConfiguration().settings
		const currentPermissionDecisionBinding = () =>
			this.createPermissionDecisionBinding(this.getCurrentWorkingConfiguration())
		const autoApprover = this.requestAutoApprover()
		const config: TaskConfig = {
			executionProfile: this.executionProfile,
			taskId: this.taskId,
			ulid: this.ulid,
			mode: settings.mode,
			strictPlanModeEnabled: settings.strictPlanModeEnabled,
			get yoloModeToggled() {
				return currentSettings().yoloModeToggled
			},
			lowVerbosityEnabled: settings.lowVerbosityEnabled,
			doubleCheckCompletionEnabled: settings.doubleCheckCompletionEnabled,
			vscodeTerminalExecutionMode: this.terminalExecutionMode,
			enableParallelToolCalling: settings.enableParallelToolCalling,
			isSubagentExecution: false,
			backgroundEditEnabled: !!settings.backgroundEditEnabled,
			providerId: this.requestProviderId(),
			customPrompt: settings.customPrompt,
			hooksEnabled: settings.hooksEnabled,
			subagentsEnabled: settings.subagentsEnabled,
			useAutoCondense: settings.useAutoCondense,
			utilityModelEnabled: settings.utilityModelEnabled,
			utilityModelUseCondense: settings.utilityModelUseCondense,
			utilityModelUseNewTask: settings.utilityModelUseNewTask,
			utilityModelSelection: settings.utilityModelSelection
				? (structuredClone(settings.utilityModelSelection) as ModelProviderSelection)
				: undefined,
			globalSkillsToggles: settings.globalSkillsToggles,
			localSkillsToggles: runtime.workingConfiguration.workspaceConfiguration.localSkillsToggles,
			context: this.diracContext,
			cwd: this.cwd,
			workspaceManager: this.workspaceManager,
			isMultiRootEnabled: this.isMultiRootEnabled,
			taskState: this.taskState,
			messageState: this.messageStateHandler,
			model: deepFreezeConfiguration(structuredClone(runtime.api.getModel())),
			supportsNativeWebSearch: runtime.api.supportsNativeWebSearch?.() === true,
			get autoApprovalSettings() {
				return currentSettings().autoApprovalSettings as TaskConfig["autoApprovalSettings"]
			},
			autoApprover,
			browserSettings: settings.browserSettings,
			get permissionDecisionBinding() {
				return currentPermissionDecisionBinding()
			},
			services: {
				browserSession: this.browserSession,
				urlContentFetcher: this.urlContentFetcher,
				diffViewProvider: this.diffViewProvider,
				fileContextTracker: this.fileContextTracker,
				diracIgnoreController: this.diracIgnoreController,
				commandPermissionController: this.commandPermissionController,
				contextManager: this.contextManager,
			},
			callbacks: {
				assertMutationAuthorized: (toolName) => this.assertMutationAuthorized(toolName),
				withMutationAuthorization: (toolName, mutation) => this.withMutationAuthorization(toolName, mutation),
				transitionFromMutation: (transition) => this.transitionFromMutation(transition),
				retainMutationUntil: (completion) => this.retainMutationUntil(completion),
				commitEnabledToolToggles: (toolIds, finalize) => this.commitEnabledToolToggles(toolIds, finalize),
				saveCheckpoint: async (isAttemptCompletionMessage?: boolean, completionMessageId?: string) => {
					await this.saveCheckpoint(isAttemptCompletionMessage, completionMessageId)
				},
				commitAttemptCompletion: (response) => this.commitAttemptCompletion(response),
				postStateToWebview: this.postStateToWebview.bind(this),
				cancelTask: this.cancelTask,
				executeCommandTool: this.executeCommandTool,
				cancelRunningCommandTool: this.cancelRunningCommandTool,
				doesLatestTaskCompletionHaveNewChanges: this.doesLatestTaskCompletionHaveNewChanges,
				getDiracMessages: () => this.messageStateHandler.getDiracMessages(),
				updateDiracMessage: async (index: number, updates: Partial<DiracMessage>) => {
					await this.messageStateHandler.updateDiracMessage(index, updates)
					await config.callbacks.postStateToWebview()
				},
				shouldAutoApproveTool: this.shouldAutoApproveTool.bind(this),
				shouldAutoApproveToolWithPath: this.shouldAutoApproveToolWithPath.bind(this),
				resolveToolPathPermission: this.resolveToolPathPermission.bind(this),
				applyLatestBrowserSettings: this.applyLatestBrowserSettings.bind(this),
				switchToActMode: this.switchToActMode,
				setActiveHookExecution: this.setActiveHookExecution,
				clearActiveHookExecution: this.clearActiveHookExecution,
				getActiveHookExecution: this.getActiveHookExecution,
				runUserPromptSubmitHook: this.runUserPromptSubmitHook,
				resetTransientState: this.resetTransientState,
				notifyContextCompacted: this.notifyContextCompacted,
				createUtilityModelRunner: (selection, options) => this.createUtilityRunner(selection, options),
				createSubagentRuntime: (options) => this.createSubagentRuntime(options),
			},
			coordinator,
			taskMessenger: this.taskMessenger,
		}
		config.activeToolSnapshot = runtime.toolSnapshot
		validateTaskConfig(config)
		return config
	}

	public async refreshToolsForTask(): Promise<void> {
		this.markToolsDirty("task_start")
	}
	public markToolsDirty(reason: ToolSnapshotDirtyReason): void {
		this.snapshotManager.markDirty(reason)
	}
	public async getSnapshotForRequest(
		context: SystemPromptContext,
		requestRuntime: TaskRequestRuntime,
	): Promise<ToolRequestSnapshot> {
		this.buildingRequestRuntime = requestRuntime
		try {
			return await this.snapshotManager.getSnapshotForRequest(context, {
				requestId: requestRuntime.requestId,
				configurationRevision: requestRuntime.workingConfiguration.revision,
			})
		} finally {
			this.buildingRequestRuntime = undefined
		}
	}
	public getActiveSnapshot(): ToolRequestSnapshot | undefined {
		return this.snapshotManager.getActiveSnapshot()
	}
	public activateSnapshot(snapshot: ToolRequestSnapshot, requestRuntime: TaskRequestRuntime): void {
		if (snapshot.requestId !== requestRuntime.requestId)
			throw new Error("Cannot activate a tool snapshot for another request")
		if (
			snapshot.configurationRevision !== undefined &&
			snapshot.configurationRevision !== requestRuntime.workingConfiguration.revision
		) {
			throw new Error("Cannot activate a tool snapshot for another configuration revision")
		}
		this.activeRequestRuntime = requestRuntime
		this.snapshotManager.activateSnapshot(snapshot)
		this.coordinator = snapshot.coordinator
	}
	public async executeTool(block: ToolUse, isComplete = true): Promise<void> {
		await this.execute(block, isComplete)
	}

	public async applyLatestBrowserSettings() {
		await this.browserSession.dispose()
		const runtime = this.requestRuntime()
		const useWebp = !modelDoesntSupportWebp(runtime.api.getModel())
		this.browserSession = new BrowserSession(runtime.workingConfiguration.settings.browserSettings, useWebp)
		this.browserSession.setUlid(this.ulid)
		this.installBrowserSession(this.browserSession)
		return this.browserSession
	}

	private isPlanModeToolRestricted(toolName: DiracDefaultTool): boolean {
		return ToolExecutor.PLAN_MODE_RESTRICTED_TOOLS.includes(toolName)
	}

	private createToolRejectionMessage(block: ToolUse, reason: string): void {
		this.taskState.userMessageContent.push({
			type: "text",
			text: `${reason} ${ToolDisplayUtils.getToolDescription(block, this.coordinator)}`,
		})
	}

	private async execute(block: ToolUse, isComplete = true): Promise<boolean> {
		try {
			canonicalizeResponseToolCall(block, isComplete)
			if (!this.coordinator.has(block.name)) return false
			const config = this.asToolConfig()
			if (this.taskState.didRejectTool) {
				const reason = !isComplete
					? "Tool was interrupted and not executed due to user rejecting a previous tool."
					: "Skipping tool due to user rejecting a previous tool."
				this.createToolRejectionMessage(block, reason)
				return true
			}
			if (await this.isPlanModeRestricted(block, isComplete)) return true
			if (block.name !== "browser_action") await this.browserSession.closeBrowser()
			if (!isComplete) {
				await this.coordinator.bufferPartialToolUse(block, config)
				return true
			}
			await this.handleCompleteBlock(block, config)
			return true
		} catch (error) {
			await this.errorHandler.handleError(
				`executing ${block.name}`,
				error as Error,
				block,
				this.resultPusher.pushToolResult.bind(this.resultPusher),
			)
			return true
		}
	}

	// Checks plan mode restrictions and creates error card if tool is restricted.
	private async isPlanModeRestricted(block: ToolUse, isComplete = true): Promise<boolean> {
		if (!block.name || !this.isPlanModeToolRestricted(block.name as DiracDefaultTool)) return false
		try {
			this.assertMutationAuthorized(block.name as DiracDefaultTool)
			return false
		} catch {
			// Present the established Plan-mode rejection below.
		}
		const errorMessage = `Tool '${block.name}' is not available in PLAN MODE. This tool is restricted to ACT MODE for file modifications. Only use tools available for PLAN MODE when in that mode.`
		await this.taskMessenger.createCard({ header: "Plan Mode Restriction", body: errorMessage, status: CardStatus.ERROR })
		if (isComplete) await this.resultPusher.pushToolResult(formatResponse.toolError(errorMessage), block)
		return true
	}

	private async handleCompleteBlock(block: ToolUse, config: any): Promise<void> {
		if (this.taskState.abort) return
		const requestRuntime = this.requestRuntime()
		const providerId = this.requestProviderId(requestRuntime)
		const hooksEnabled = getHooksEnabledSafe(requestRuntime.workingConfiguration.settings.hooksEnabled)
		let shouldCancelAfterHook = false
		let executionSuccess = true
		let toolResult: any = null
		let toolWasExecuted = false
		const executionStartTime = Date.now()
		try {
			if (this.taskState.abort) return
			toolResult = await this.coordinator.execute(config, block)
			toolWasExecuted = true
			const count = ++this.taskState.totalToolCallCount
			toolResult = ToolResultPusher.appendLoopWarning(toolResult, count)
			await this.resultPusher.pushToolResult(toolResult, block)
			if (this.taskState.abort) return
			if (hooksEnabled && !isCompletionResponseCall(block)) {
				if (
					await this.hookRunner.runPostToolUseHook(
						block,
						toolResult,
						executionSuccess,
						executionStartTime,
						hooksEnabled,
						requestRuntime.api,
						providerId,
					)
				) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}
		} catch (error) {
			executionSuccess = false
			toolResult = formatResponse.toolError(`Tool execution failed: ${error}`)
			if (this.taskState.abort) throw error
			if (toolWasExecuted && hooksEnabled && !isCompletionResponseCall(block)) {
				if (
					await this.hookRunner.runPostToolUseHook(
						block,
						toolResult,
						executionSuccess,
						executionStartTime,
						hooksEnabled,
						requestRuntime.api,
						providerId,
					)
				) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}
			throw error
		}
		if (shouldCancelAfterHook) return
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/LifecycleManager.ts (lines 48-729)
```
export class LifecycleManager {
	private abortPromise?: Promise<void>
	private ownedResourceCleanupPromise?: Promise<void>

	constructor(private dependencies: LifecycleManagerDependencies) {}

	setApi(api: LifecycleManagerDependencies["api"]): void {
		this.dependencies.api = api
	}

	setBrowserSession(browserSession: BrowserSession): void {
		this.dependencies.browserSession = browserSession
	}

	private getOperationalApi(): LifecycleManagerDependencies["api"] {
		return this.dependencies.getRequestRuntime()?.api ?? this.dependencies.api
	}

	public async initializeCheckpoints(isFirstRequest: boolean): Promise<void> {
		if (
			!isFirstRequest ||
			!this.dependencies.getWorkingConfiguration().settings.enableCheckpointsSetting ||
			!this.dependencies.checkpointManager ||
			!this.dependencies.checkpointManager.isEnabled() ||
			this.dependencies.taskState.checkpointManagerErrorMessage
		) {
			return
		}

		try {
			await ensureCheckpointInitialized({ checkpointManager: this.dependencies.checkpointManager })
		} catch (error) {
			const errorMessage = getErrorMessage(error, "Unknown error")
			Logger.error("Failed to initialize checkpoint manager:", errorMessage)
			this.dependencies.taskState.checkpointManagerErrorMessage = errorMessage // will be displayed right away since we saveDiracMessages next which posts state to webview
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Checkpoint initialization timed out: ${errorMessage}`,
			})
		}

		// Now, if checkpoints are enabled AND tracker was successfully initialized,
		// then say "checkpoint_created" and perform the commit.
		if (!this.dependencies.taskState.checkpointManagerErrorMessage) {
			await this.dependencies.taskMessenger.createCheckpoint()
			const messages = this.dependencies.messageStateHandler.getDiracMessages()
			const lastCheckpointMessageIndex = findLastIndex(messages, (m) => m.content.type === DiracMessageType.CHECKPOINT)
			if (lastCheckpointMessageIndex !== -1) {
				const commitPromise = this.dependencies.checkpointManager!.commit()
				// Store the initial commit promise in Task for unsafe tools to wait on
				// We'll need to expose this or handle it differently.
				// In Task, it was: this.initialCheckpointCommitPromise = commitPromise
				// I'll add a way to set it in Task or just keep it here if it's only used for tools.
				// Wait, ToolExecutor needs it. I'll add it to TaskState or pass it back.
				// Let's add it to TaskState for simplicity as it's a transient state.
				this.dependencies.taskState.initialCheckpointCommitPromise = commitPromise

				commitPromise
					?.then(async (commitHash) => {
						if (commitHash) {
							await this.dependencies.messageStateHandler.updateDiracMessage(lastCheckpointMessageIndex, {
								lastCheckpointHash: commitHash,
							})
						}
					})
					.catch((error) => {
						Logger.error(
							`[TaskCheckpointManager] Failed to create checkpoint commit for task ${this.dependencies.taskId}:`,
							error,
						)
					})
			}
		}
	}

	public async startTask(task?: string, images?: string[], files?: string[]): Promise<TaskRunOutcome | undefined> {
		try {
			await this.dependencies.diracIgnoreController.initialize()
			await this.dependencies.commandPermissionController.initialize(this.dependencies.cwd)
		} catch (error) {
			Logger.error("Failed to initialize DiracIgnoreController:", error)
		}
		this.dependencies.messageStateHandler.setDiracMessages([])
		this.dependencies.messageStateHandler.setApiConversationHistory([])
		this.dependencies.messageStateHandler.setApiConversationProviderState({})

		await this.dependencies.postStateToWebview()

		await this.dependencies.taskMessenger.upsertText(task || "", false, images, files, "user")

		this.dependencies.taskState.isInitialized = true

		const imageBlocks: DiracImageContentBlock[] = formatResponse.imageBlocks(images)

		const userContent: DiracUserContent[] = [
			{
				type: "text",
				isUserInput: true,
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		]

		if (files && files.length > 0) {
			const fileContentString = await processFilesIntoText(files)
			if (fileContentString) {
				userContent.push({
					type: "text",
					text: fileContentString,
				})
			}
		}

		const hooksEnabled = getHooksEnabledSafe(this.dependencies.getWorkingConfiguration().settings.hooksEnabled)
		if (hooksEnabled) {
			const taskStartResult = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: this.dependencies.taskId,
							ulid: this.dependencies.ulid,
							initialTask: task || "",
						},
					},
				},
				isCancellable: true,
				messenger: this.dependencies.taskMessenger,
				setActiveHookExecution: this.dependencies.hookManager.setActiveHookExecution.bind(this.dependencies.hookManager),
				clearActiveHookExecution: this.dependencies.hookManager.clearActiveHookExecution.bind(
					this.dependencies.hookManager,
				),
				messageStateHandler: this.dependencies.messageStateHandler,
				taskId: this.dependencies.taskId,
				hooksEnabled,
				model: getTaskHookModelContext(
					this.getOperationalApi(),
					this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration(),
				),
			})

			if (taskStartResult.cancel === true) {
				await this.dependencies.hookManager.handleHookCancellation("TaskStart", taskStartResult.wasCancelled || false)
				await this.dependencies.cancelTask()
				return
			}

			if (taskStartResult.contextModification) {
				const contextText = taskStartResult.contextModification.trim()
				if (contextText) {
					userContent.push({
						type: "text",
						text: `<hook_context source="TaskStart">\n${contextText}\n</hook_context>`,
					})
				}
			}
		}

		if (this.dependencies.taskState.abort) {
			return
		}

		const userPromptHookResult = await this.dependencies.hookManager.runUserPromptSubmitHook(userContent, "initial_task")

		if (this.dependencies.taskState.abort) {
			return
		}

		if (userPromptHookResult.cancel === true) {
			await this.dependencies.hookManager.handleHookCancellation(
				"UserPromptSubmit",
				userPromptHookResult.wasCancelled ?? false,
			)
			await this.dependencies.cancelTask()
			return
		}

		if (userPromptHookResult.contextModification) {
			userContent.push({
				type: "text",
				text: `<hook_context source="UserPromptSubmit">\n${userPromptHookResult.contextModification}\n</hook_context>`,
			})
		}

		try {
			await this.dependencies.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata:", error)
		}

		return await this.dependencies.initiateTaskLoop(userContent)
	}

	public async resumeTaskFromHistory(
		onRestored?: () => void,
		options: ResumeTaskOptions = {},
	): Promise<TaskRunOutcome | undefined> {
		try {
			await this.dependencies.diracIgnoreController.initialize()
			await this.dependencies.commandPermissionController.initialize(this.dependencies.cwd)
		} catch (error) {
			Logger.error("Failed to initialize DiracIgnoreController:", error)
		}
		if (this.dependencies.taskState.abort) return

		const savedPresentation = await getSavedPresentationHistory(this.dependencies.taskId)
		const savedDiracMessages = savedPresentation.messages
		this.dependencies.messageStateHandler.setDiracMessages(savedDiracMessages, savedPresentation.lastOffset)
		if (this.dependencies.taskState.abort) return

		const lastRelevantMessageIndex = findLastIndex(
			savedDiracMessages,
			(m) => !(m.content.type === DiracMessageType.CARD && isResumePromptCard(m.content.card)),
		)
		if (lastRelevantMessageIndex !== -1) {
			savedDiracMessages.splice(lastRelevantMessageIndex + 1)
		}

		const lastApiReqStartedIndex = findLastIndex(savedDiracMessages, (m) => m.content.type === "api_status")
		if (lastApiReqStartedIndex !== -1) {
			const lastApiReqStarted = savedDiracMessages[lastApiReqStartedIndex]
			if (lastApiReqStarted.content.type === "api_status") {
				const { cost, cancelReason } = lastApiReqStarted.content.status
				if (cost === undefined && cancelReason === undefined) {
					savedDiracMessages.splice(lastApiReqStartedIndex, 1)
				}
			}
		}

		await this.dependencies.messageStateHandler.overwriteDiracMessages(savedDiracMessages)
		if (this.dependencies.taskState.abort) return
		const persistedPresentation = await getSavedPresentationHistory(this.dependencies.taskId)
		if (this.dependencies.taskState.abort) return
		this.dependencies.messageStateHandler.setDiracMessages(persistedPresentation.messages, persistedPresentation.lastOffset)

		const savedApiConversation = await getSavedApiConversationState(this.dependencies.taskId)
		const savedApiConversationHistory = savedApiConversation.messages.map(removeUserInputMarkersFromMessage)
		if (this.dependencies.taskState.abort) return
		this.dependencies.messageStateHandler.setApiConversationHistory(
			savedApiConversationHistory as any,
			savedApiConversation.lastOffset,
		)
		this.dependencies.messageStateHandler.setApiConversationProviderState(
			await getSavedApiConversationProviderState(this.dependencies.taskId),
		)
		if (this.dependencies.taskState.abort) return
		this.dependencies.restoreQueuedSteeringFromTranscript()

		await ensureTaskDirectoryExists(this.dependencies.taskId)
		if (this.dependencies.taskState.abort) return

		// Restore task-scoped tools from the task directory
		const { refreshTaskTools } = await import("@core/task/tools/registry/refreshToolRegistry")
		this.dependencies.taskState.taskScopedToolIds = await refreshTaskTools(this.dependencies.taskId)
		if (this.dependencies.taskState.abort) return
		const taskMetadata = await getTaskMetadata(this.dependencies.taskId)
		if (this.dependencies.taskState.abort) return
		this.dependencies.taskState.activeSkillIds = taskMetadata.active_skill_ids ?? []

		// Trailing user-authored messages are follow-ups submitted after the run
		// ended; they must not flip a completed restore to CANCELLED.
		const lastDiracMessage = this.dependencies.messageStateHandler
			.getDiracMessages()
			.slice()
			.reverse()
			.find(
				(m) =>
					!(m.content.type === DiracMessageType.CARD && isResumePromptCard(m.content.card)) &&
					!(m.content.type === DiracMessageType.MARKDOWN && m.content.role === "user"),
			)

		this.dependencies.taskState.isInitialized = true
		this.dependencies.taskState.abort = false

		const completedTask =
			lastDiracMessage?.content.type === DiracMessageType.CARD &&
			isSuccessfulTaskCompletionCard(lastDiracMessage.content.card)
		// Reset askResponse state before waiting. Completed tasks remain available for
		// follow-up messages just like cancelled tasks; only their displayed status differs.
		clearAskResponse(this.dependencies.taskState)

		this.dependencies.taskState.status = completedTask ? TaskStatus.COMPLETED : TaskStatus.CANCELLED
		await this.dependencies.postStateToWebview()
		onRestored?.()

		if (options.systemContext === undefined && options.initialUserInput === undefined) {
			await pWaitFor(() => this.dependencies.taskState.askResponse !== undefined || this.dependencies.taskState.abort, {
				interval: 100,
			})
		}

		if (this.dependencies.taskState.abort) return

		const response = options.initialUserInput ? DiracAskResponse.MESSAGE : this.dependencies.taskState.askResponse
		const text = options.initialUserInput?.text ?? this.dependencies.taskState.askResponseText
		const images = options.initialUserInput?.images ?? this.dependencies.taskState.askResponseImages
		const files = options.initialUserInput?.files ?? this.dependencies.taskState.askResponseFiles

		const newUserContent: DiracContent[] = []

		if (options.systemContext !== undefined) {
			newUserContent.push({
				type: "text",
				text: `<system_context source="task_resume">\n${options.systemContext}\n</system_context>`,
			})
		}
		const hooksEnabled = getHooksEnabledSafe(this.dependencies.getWorkingConfiguration().settings.hooksEnabled)
		if (hooksEnabled) {
			const diracMessages = this.dependencies.messageStateHandler.getDiracMessages()
			const taskResumeResult = await executeHook({
				hookName: "TaskResume",
				hookInput: {
					taskResume: {
						taskMetadata: {
							taskId: this.dependencies.taskId,
							ulid: this.dependencies.ulid,
						},
						previousState: {
							lastMessageTs: lastDiracMessage?.ts?.toString() || "",
							messageCount: diracMessages.length.toString(),
							conversationHistoryDeleted: (
								this.dependencies.taskState.conversationHistoryDeletedRange !== undefined
							).toString(),
						},
					},
				},
				isCancellable: true,
				messenger: this.dependencies.taskMessenger,
				setActiveHookExecution: this.dependencies.hookManager.setActiveHookExecution.bind(this.dependencies.hookManager),
				clearActiveHookExecution: this.dependencies.hookManager.clearActiveHookExecution.bind(
					this.dependencies.hookManager,
				),
				messageStateHandler: this.dependencies.messageStateHandler,
				taskId: this.dependencies.taskId,
				hooksEnabled,
				model: getTaskHookModelContext(
					this.getOperationalApi(),
					this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration(),
				),
			})

			if (taskResumeResult.cancel === true) {
				await this.dependencies.hookManager.handleHookCancellation("TaskResume", taskResumeResult.wasCancelled || false)
				await this.dependencies.cancelTask()
				return
			}

			if (taskResumeResult.contextModification) {
				newUserContent.push({
					type: "text",
					text: `<hook_context source="TaskResume" type="general">\n${taskResumeResult.contextModification}\n</hook_context>`,
				})
			}
		}

		if (this.dependencies.taskState.abort) {
			return
		}

		let responseText: string | undefined
		let responseImages: string[] | undefined
		let responseFiles: string[] | undefined
		if (response === DiracAskResponse.MESSAGE || text || (images?.length ?? 0) > 0 || (files?.length ?? 0) > 0) {
			await this.dependencies.taskMessenger.upsertText(text || "", false, images, files, "user")
			responseText = text
			responseImages = images
			responseFiles = files
		}

		const existingApiConversationHistory = this.dependencies.messageStateHandler.getApiConversationHistory()
		let modifiedOldUserContent: DiracContent[]
		let modifiedApiConversationHistory: any[]
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]
			if (lastMessage.role === "assistant") {
				modifiedApiConversationHistory = [...existingApiConversationHistory]
				modifiedOldUserContent = []
			} else if (lastMessage.role === "user") {
				const existingUserContent: DiracContent[] = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
				modifiedOldUserContent = [...existingUserContent]
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			modifiedApiConversationHistory = []
			modifiedOldUserContent = []
		}

		const providerState = this.dependencies.messageStateHandler.getApiConversationProviderState()
		if (
			providerState.checkpoint &&
			providerState.checkpoint.compactedThroughHistoryIndex >= modifiedApiConversationHistory.length
		) {
			await this.dependencies.messageStateHandler.overwriteApiConversationProviderState({
				...providerState,
				checkpoint: undefined,
			})
		}

		newUserContent.push(...modifiedOldUserContent)

		const agoText = (() => {
			const timestamp = lastDiracMessage?.ts ?? Date.now()
			const now = Date.now()
			const diff = now - timestamp
			const minutes = Math.floor(diff / 60000)
			const hours = Math.floor(minutes / 60)
			const days = Math.floor(hours / 24)
			if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`
			if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`
			if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
			return "just now"
		})()

		const wasRecent = lastDiracMessage?.ts && Date.now() - lastDiracMessage.ts < 30_000
		const pendingContextWarning = await this.dependencies.fileContextTracker.retrieveAndClearPendingFileContextWarning()
		const hasPendingFileContextWarnings = pendingContextWarning && pendingContextWarning.length > 0
		const mode = this.dependencies.getWorkingConfiguration().settings.mode
		const [taskResumptionMessage, userResponseMessage] = formatResponse.taskResumption(
			mode === "plan" ? "plan" : "act",
			agoText,
			this.dependencies.cwd,
			wasRecent,
			responseText,
			hasPendingFileContextWarnings,
		)

		if (taskResumptionMessage !== "") {
			newUserContent.push({
				type: "text",
				text: taskResumptionMessage,
			})
		}
		if (userResponseMessage !== "") {
			newUserContent.push({
				type: "text",
				isUserInput: true,
				text: userResponseMessage,
			})
		}

		if (responseImages && responseImages.length > 0) {
			newUserContent.push(...formatResponse.imageBlocks(responseImages))
		}

		if (responseFiles && responseFiles.length > 0) {
			const fileContentString = await processFilesIntoText(responseFiles)
			if (fileContentString) {
				newUserContent.push({
					type: "text",
					text: fileContentString,
				})
			}
		}

		if (pendingContextWarning && pendingContextWarning.length > 0) {
			const fileContextWarning = formatResponse.fileContextWarning(pendingContextWarning)
			newUserContent.push({
				type: "text",
				text: fileContextWarning,
			})
		}

		if (options.systemContext === undefined || options.initialUserInput !== undefined) {
			const userFeedbackContent = await buildUserFeedbackContent(responseText, responseImages, responseFiles)
			const userPromptHookResult = await this.dependencies.hookManager.runUserPromptSubmitHook(
				userFeedbackContent,
				"resume",
			)

			if (this.dependencies.taskState.abort) return
			if (userPromptHookResult.cancel === true) {
				await this.dependencies.cancelTask()
				return
			}
			if (userPromptHookResult.contextModification) {
				newUserContent.push({
					type: "text",
					text: `<hook_context source="UserPromptSubmit">\n${userPromptHookResult.contextModification}\n</hook_context>`,
				})
			}
		}

		try {
			await this.dependencies.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata on resume:", error)
		}

		await this.dependencies.messageStateHandler.overwriteApiConversationHistory(modifiedApiConversationHistory)
		return await this.dependencies.initiateTaskLoop(newUserContent)
	}

	public async abortTask() {
		this.abortPromise ??= this.performAbortTask()
		try {
			await this.abortPromise
		} finally {
			await this.dependencies.messageStateHandler.flushPendingWrites()
		}
	}

	/** Await cancellation teardown, or release normal terminal ownership when no abort is active. */
	public async finalizeTaskRun(): Promise<void> {
		if (this.abortPromise) {
			await this.abortPromise
		} else {
			await this.releaseOwnedTaskResources()
		}
		await this.dependencies.messageStateHandler.flushPendingWrites()
	}

	private async performAbortTask() {
		this.dependencies.taskState.abort = true
		const abortFailures: unknown[] = []
		const cleanupFailures: unknown[] = []

		try {
			this.getOperationalApi().abort?.()
			const shouldRunTaskCancelHook = await this.dependencies.hookManager.shouldRunTaskCancelHook()

			const activeHook = await this.dependencies.hookManager.getActiveHookExecution()
			if (activeHook) {
				try {
					await this.dependencies.hookManager.cancelHookExecution()
					await this.dependencies.hookManager.clearActiveHookExecution()
				} catch (error) {
					Logger.error("Failed to cancel hook during task abort", error)
					await this.dependencies.hookManager.clearActiveHookExecution()
				}
			}

			if (this.dependencies.commandExecutor.hasActiveBackgroundCommand()) {
				try {
					await this.dependencies.commandExecutor.cancelBackgroundCommand()
				} catch (error) {
					Logger.error("Failed to cancel background command during task abort", error)
				}
			}

			const hooksEnabled = getHooksEnabledSafe(this.dependencies.getWorkingConfiguration().settings.hooksEnabled)
			if (hooksEnabled && shouldRunTaskCancelHook) {
				try {
					await executeHook({
						hookName: "TaskCancel",
						hookInput: {
							taskCancel: {
								taskMetadata: {
									taskId: this.dependencies.taskId,
									ulid: this.dependencies.ulid,
									completionStatus: this.dependencies.taskState.abandoned ? "abandoned" : "cancelled",
								},
							},
						},
						isCancellable: false,
						messenger: this.dependencies.taskMessenger,
						messageStateHandler: this.dependencies.messageStateHandler,
						taskId: this.dependencies.taskId,
						hooksEnabled,
						model: getTaskHookModelContext(
							this.getOperationalApi(),
							this.dependencies.getRequestRuntime()?.workingConfiguration ??
								this.dependencies.getWorkingConfiguration(),
						),
					})
				} catch (error) {
					Logger.error("[TaskCancel Hook] Failed (non-fatal):", error)
				}
			}

			// Update any stale auto-retry cards whose delay was still in progress.
			// Without this, the "Retrying in" body persists because the task loop
			// never reached the post-delay abort check.
			for (const msg of this.dependencies.messageStateHandler.getDiracMessages()) {
				if (
					msg.content.type === DiracMessageType.CARD &&
					msg.content.card.header === "API Error (Retrying)" &&
					(msg.content.card.status === CardStatus.PENDING || msg.content.card.status === CardStatus.ERROR)
				) {
					const attempt = msg.content.card.body?.match(/attempt (\d+\/\d+)/)?.[1] ?? "?/?"
					await this.dependencies.messageStateHandler.patchCardById(msg.content.card.id, {
						header: "API Error (Cancelled)",
						body: "API Error (attempt " + attempt + "). Cancelled.",
						status: CardStatus.CANCELLED,
						endTime: Date.now(),
					})
				}
			}
			try {
				await this.dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory()
				await this.dependencies.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post state after setting abort flag", error)
			}
		} catch (error) {
			abortFailures.push(error)
		} finally {
			try {
				await this.releaseOwnedTaskResources()
			} catch (error) {
				cleanupFailures.push(error)
			}

			this.dependencies.taskState.endApiRequest()
			this.dependencies.taskState.endFirstChunkWait()
			this.dependencies.taskState.markStreamAbortFinished()
			this.dependencies.taskState.status = TaskStatus.CANCELLED

			try {
				await this.dependencies.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post final state after abort", error)
			}
		}

		const failures = [...abortFailures, ...cleanupFailures]
		if (failures.length === 1) {
			throw failures[0]
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, "Task abort failed")
		}
	}

	private releaseOwnedTaskResources(): Promise<void> {
		this.ownedResourceCleanupPromise ??= this.performOwnedResourceCleanup()
		return this.ownedResourceCleanupPromise
	}

	private async performOwnedResourceCleanup(): Promise<void> {
		const failures: unknown[] = []
		try {
			const { ToolRegistry } = await import("@core/task/tools/registry/ToolRegistry")
			await ToolRegistry.withExclusiveAccess((registry) => {
				registry.removeTaskTools(this.dependencies.taskId)
			})
			this.dependencies.taskState.taskScopedToolIds = []
		} catch (error) {
			failures.push(error)
		}

		failures.push(...(await this.disposeTaskResources()))

		if (this.dependencies.taskState.taskLockAcquired) {
			try {
				await releaseTaskLock(this.dependencies.taskId)
				this.dependencies.taskState.taskLockAcquired = false
				Logger.info(`[Task ${this.dependencies.taskId}] Task lock released`)
			} catch (error) {
				failures.push(error)
			}
		}

		if (failures.length === 1) throw failures[0]
		if (failures.length > 1) throw new AggregateError(failures, "Task resource cleanup failed")
	}

	private async disposeTaskResources(): Promise<unknown[]> {
		const failures: unknown[] = []
		const attempt = async (dispose: () => void | Promise<void>) => {
			try {
				await dispose()
			} catch (error) {
				failures.push(error)
			}
		}

		await attempt(() => this.dependencies.terminalManager.disposeAll())
		await attempt(() => this.dependencies.urlContentFetcher.closeBrowser())
		await attempt(() => this.dependencies.browserSession.dispose())
		await attempt(() => this.dependencies.commandPermissionController.dispose())
		await attempt(() => this.dependencies.diracIgnoreController.dispose())
		await attempt(() => this.dependencies.fileContextTracker.dispose())
		await attempt(() => this.dependencies.diffViewProvider.revertChanges())
		await attempt(() => AnchorStateManager.reset(this.dependencies.ulid))

		return failures
	}
}
```


## Source Files:

- `src/core/api/conversation.ts`
- `src/core/controller/checkpoints/checkpointDiff.ts`
- `src/core/controller/checkpoints/checkpointRestore.ts`
- `src/core/controller/checkpoints/getCwdHash.ts`
- `src/core/controller/checkpoints/subscribeToCheckpoints.ts`
- `src/core/task/ApiConversationManager.ts`
- `src/core/task/LifecycleManager.ts`
- `src/core/task/TaskMessenger.ts`
- `src/core/task/TaskRequestLoop.ts`
- `src/core/task/ToolExecutor.ts`
- `src/core/task/index.ts`
- `src/core/task/message-state.ts`
- `src/core/task/multifile-diff.ts`
- `src/core/task/response/AssistantMessagePresenter.ts`
- `src/core/task/tools/adapters/traits/OrchestrationTraitBuilder.ts`
- `src/core/task/tools/types/TaskConfig.ts`
- `src/integrations/checkpoints/CheckpointDiffPresenter.ts`
- `src/integrations/checkpoints/CheckpointExclusions.ts`
- `src/integrations/checkpoints/CheckpointGitOperations.ts`
- `src/integrations/checkpoints/CheckpointLockUtils.ts`
- `src/integrations/checkpoints/CheckpointMigration.ts`
- `src/integrations/checkpoints/CheckpointRestoreHandler.ts`
- `src/integrations/checkpoints/CheckpointStorageManager.ts`
- `src/integrations/checkpoints/CheckpointTracker.ts`
- `src/integrations/checkpoints/CheckpointUtils.ts`
- `src/integrations/checkpoints/DiffContentProvider.ts`
- `src/integrations/checkpoints/MultiRootCheckpointManager.ts`
- `src/integrations/checkpoints/factory.ts`
- `src/integrations/checkpoints/index.ts`
- `src/integrations/checkpoints/initializer.ts`
- `src/integrations/checkpoints/types.ts`
- `src/services/telemetry/ToolTelemetry.ts`
- `src/shared/ExtensionMessage.ts`

