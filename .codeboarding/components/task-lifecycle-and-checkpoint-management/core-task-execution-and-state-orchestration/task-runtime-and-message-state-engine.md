---
component_id: 10.1.1
component_name: Task Runtime & Message State Engine
---

# Task Runtime & Message State Engine

## Component Description

Manages task execution request loops, tool execution, API conversation compaction, and persisted message state for active tasks.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/task/index.ts (lines 143-1360)
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
	private readonly releaseTaskLock?: () => Promise<void>
	private persistenceRetirementPromise?: Promise<void>

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
			releaseTaskLock,
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
		this.releaseTaskLock = releaseTaskLock
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
			const failures: unknown[] = []
			try {
				await this.lifecycleManager.finalizeTaskRun()
			} catch (error) {
				failures.push(error)
			}
			try {
				await this.retirePersistence()
			} catch (error) {
				failures.push(error)
			}
			if (failures.length > 0) {
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

	/** Retires this writer before releasing exclusive ownership, once per task instance. */
	async retirePersistence(): Promise<void> {
		this.persistenceRetirementPromise ??= this.retirePersistenceAndReleaseLock()
		await this.persistenceRetirementPromise
	}

	private async retirePersistenceAndReleaseLock(): Promise<void> {
		await this.messageStateHandler.flushPendingWrites()
		await this.messageStateHandler.retirePersistence()
		await this.releaseTaskLock?.()
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

### /Users/highlands/pools/Development/dirac/src/core/task/index.ts (lines 160-162)
```
	get stateView(): ReadonlyTaskState {
		return this.taskState
	}
```

### /Users/highlands/pools/Development/dirac/src/core/task/message-state.ts (lines 76-1005)
```
export class MessageStateHandler extends EventEmitter<MessageStateHandlerEvents> {
	private workspaceRootPath?: string
	private apiConversationHistory: DiracStorageMessage[] = []
	private apiConversationProviderState: ApiConversationProviderState = {}
	private diracMessages: DiracMessage[] = []
	private taskIsFavorited: boolean
	private checkpointTracker: CheckpointTracker | undefined
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private taskId: string
	private ulid: string
	private taskState: TaskState
	private apiMetrics = getApiMetrics([])
	private metricContributionByMessageId = new Map<string, ReturnType<typeof getApiMetrics>>()
	private lastRelevantMessageId?: string
	private lastApiStatusMessageId?: string
	private lastModelInfo?: DiracStorageMessage["modelInfo"]

	// Mutex to prevent concurrent state modifications (RC-4)
	// Protects against data loss from race conditions when multiple
	// operations try to modify message state simultaneously
	// This follows the same pattern as Task.stateMutex for consistency
	private stateMutex = new Mutex()
	private persistenceMutex = new Mutex()

	private messageIndexById = new Map<string, number>()
	private cardMessageIndexById = new Map<string, number>()
	private pendingTextAppendsByMessageId = new Map<string, string[]>()
	private presentationOffset = -1
	private presentationStateGeneration = 0
	private apiHistoryOffset = -1
	private pendingPresentationOperations: PresentationOperation[] = []
	private pendingPresentationPersistenceBytes = 0
	private pendingPresentationPublications: PresentationOperation[] = []
	private pendingPresentationPublicationBytes = 0
	private presentationPublicationGapThroughOffset?: number
	private pendingApiConversationOperations: ApiConversationOperation[] = []
	private pendingApiConversationBytes = 0
	private uiFlushTimeout?: ReturnType<typeof setTimeout>
	private uiFlushDeadline?: number
	private apiHistoryFlushScheduled = false
	private persistenceRetired = false

	private recordPresentationOperation(operation: PresentationOperation): void {
		if (this.persistenceRetired) return
		const recordedOperation = structuredClone(operation)
		const operationBytes = Buffer.byteLength(JSON.stringify(recordedOperation), "utf8")
		this.pendingPresentationOperations.push(recordedOperation)
		this.pendingPresentationPersistenceBytes += operationBytes
		this.pendingPresentationPublications.push(recordedOperation)
		this.pendingPresentationPublicationBytes += operationBytes
		if (this.pendingPresentationPublicationBytes <= MAX_PENDING_PRESENTATION_PUBLICATION_BYTES) return
		this.pendingPresentationPublications = []
		this.pendingPresentationPublicationBytes = 0
		this.presentationPublicationGapThroughOffset = operation.offset
	}

	private recordApiConversationOperation(operation: ApiConversationOperation): void {
		if (this.persistenceRetired) return
		const recordedOperation = structuredClone(operation)
		this.pendingApiConversationOperations.push(recordedOperation)
		this.pendingApiConversationBytes += Buffer.byteLength(JSON.stringify(recordedOperation), "utf8")
	}

	private bufferPresentationAppend(messageId: string, text: string): void {
		const chunks = this.pendingTextAppendsByMessageId.get(messageId)
		if (chunks) chunks.push(text)
		else this.pendingTextAppendsByMessageId.set(messageId, [text])
	}

	private materializePresentationAppends(message: DiracMessage): boolean {
		const chunks = this.pendingTextAppendsByMessageId.get(message.id)
		if (!chunks) return false
		const appendedText = chunks.join("")
		if (message.content.type === DiracMessageType.MARKDOWN) {
			message.content.content += appendedText
		} else if (message.content.type === DiracMessageType.CARD) {
			message.content.card.body = `${message.content.card.body ?? ""}${appendedText}`
		} else {
			throw new Error(`Presentation append buffer refers to non-text message ${message.id}`)
		}
		this.pendingTextAppendsByMessageId.delete(message.id)
		return true
	}

	private materializeAllPresentationAppends(): void {
		for (const messageId of this.pendingTextAppendsByMessageId.keys()) {
			const index = this.requireMessageIndex(messageId)
			this.materializePresentationAppends(this.diracMessages[index])
		}
	}

	private async flushIfPersistenceBatchIsFull(): Promise<void> {
		if (
			this.pendingPresentationPersistenceBytes <= MAX_PENDING_PRESENTATION_PUBLICATION_BYTES &&
			this.pendingApiConversationBytes <= MAX_PENDING_PRESENTATION_PUBLICATION_BYTES
		)
			return
		await this.flushPendingWrites()
	}

	getPendingPresentationOperations(): PresentationOperation[] {
		return this.pendingPresentationPublications.slice()
	}

	hasPresentationPublicationGap(): boolean {
		return this.presentationPublicationGapThroughOffset !== undefined
	}

	acknowledgePresentationOperations(throughOffset: number): void {
		this.pendingPresentationPublications = this.pendingPresentationPublications.filter(
			(operation) => operation.offset > throughOffset,
		)
		this.pendingPresentationPublicationBytes = this.pendingPresentationPublications.reduce(
			(total, operation) => total + Buffer.byteLength(JSON.stringify(operation), "utf8"),
			0,
		)
		if (
			this.presentationPublicationGapThroughOffset !== undefined &&
			this.presentationPublicationGapThroughOffset <= throughOffset
		) {
			this.presentationPublicationGapThroughOffset = undefined
		}
	}

	hasPendingPresentationOperations(): boolean {
		return this.pendingPresentationPublications.length > 0
	}
	constructor(params: MessageStateHandlerParams) {
		super()
		this.taskId = params.taskId
		this.ulid = params.ulid
		this.taskState = params.taskState
		this.taskIsFavorited = params.taskIsFavorited ?? false
		this.workspaceRootPath = params.workspaceRootPath
		this.updateTaskHistory = params.updateTaskHistory
	}

	/**
	 * Emit a diracMessagesChanged event with the change details
	 */
	private emitDiracMessagesChanged(change: DiracMessageChange): void {
		this.emit("diracMessagesChanged", change)
	}

	/** Announce an armed FIFO interaction without mutating or persisting its card. */
	publishCardInteractionReady(cardId: string): void {
		const index = this.requireCardMessageIndex(cardId)
		this.emit("cardInteractionReady", this.diracMessages[index])
	}

	setCheckpointTracker(tracker: CheckpointTracker | undefined) {
		this.checkpointTracker = tracker
	}

	/**
	 * Execute function with exclusive lock on message state
	 * Use this for ANY state modification to prevent race conditions
	 * This follows the same pattern as Task.withStateLock for consistency
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	async capturePresentationSnapshot(): Promise<PresentationSnapshot> {
		return this.withStateLock(() => {
			this.materializeAllPresentationAppends()
			return {
				messages: structuredClone(this.diracMessages),
				offset: this.presentationOffset,
				generation: this.presentationStateGeneration,
			}
		})
	}

	/** Schedules a bounded UI snapshot flush without delaying live webview updates. */
	private scheduleUiFlush(): void {
		if (this.persistenceRetired) return
		const now = performance.now()
		this.uiFlushDeadline ??= now + UI_MESSAGES_FLUSH_MAX_DELAY_MS
		const delay = Math.min(UI_MESSAGES_FLUSH_DEBOUNCE_MS, Math.max(0, this.uiFlushDeadline - now))
		if (this.uiFlushTimeout) clearTimeout(this.uiFlushTimeout)
		this.uiFlushTimeout = setTimeout(() => {
			this.uiFlushTimeout = undefined
			this.uiFlushDeadline = undefined
			void this.flushPendingWrites().catch((error) => Logger.error("Failed to flush pending UI messages:", error))
		}, delay)
	}

	/** Keeps API-history persistence at its existing same-turn cadence. */
	private scheduleApiHistoryFlush(): void {
		if (this.persistenceRetired || this.apiHistoryFlushScheduled) return
		this.apiHistoryFlushScheduled = true
		queueMicrotask(() => {
			this.apiHistoryFlushScheduled = false
			void this.flushPendingWrites().catch((error) => Logger.error("Failed to flush pending API history:", error))
		})
	}

	private cancelScheduledUiFlush(): void {
		if (this.uiFlushTimeout) clearTimeout(this.uiFlushTimeout)
		this.uiFlushTimeout = undefined
		this.uiFlushDeadline = undefined
	}

	/** Prevents this task instance from writing after a same-ID replacement takes ownership. */
	async retirePersistence(): Promise<void> {
		this.persistenceRetired = true
		this.cancelScheduledUiFlush()
		this.apiHistoryFlushScheduled = false
		await this.persistenceMutex.withLock(() =>
			this.withStateLock(() => {
				this.pendingPresentationOperations = []
				this.pendingPresentationPersistenceBytes = 0
				this.pendingPresentationPublications = []
				this.pendingPresentationPublicationBytes = 0
				this.presentationPublicationGapThroughOffset = undefined
				this.pendingApiConversationOperations = []
				this.pendingApiConversationBytes = 0
			}),
		)
	}

	/** Captures pending records under the state lock, then appends them without blocking mutations. */
	private async persistPendingOperations(): Promise<void> {
		if (this.persistenceRetired) return
		const pending = await this.withStateLock(() => {
			const hasPendingApiConversation = this.pendingApiConversationOperations.length > 0
			const captured = {
				presentation: this.pendingPresentationOperations.splice(0),
				apiConversation: this.pendingApiConversationOperations.splice(0),
				apiConversationSnapshot: hasPendingApiConversation ? structuredClone(this.apiConversationHistory) : undefined,
				presentationBytes: this.pendingPresentationPersistenceBytes,
				apiConversationBytes: this.pendingApiConversationBytes,
			}
			this.pendingPresentationPersistenceBytes = 0
			this.pendingApiConversationBytes = 0
			return captured
		})

		let firstError: unknown
		try {
			await appendPresentationOperations(this.taskId, pending.presentation)
		} catch (error) {
			firstError = error
			await this.withStateLock(() => {
				this.pendingPresentationOperations.unshift(...pending.presentation)
				this.pendingPresentationPersistenceBytes += pending.presentationBytes
			})
		}
		try {
			await appendApiConversationOperations(this.taskId, pending.apiConversation, pending.apiConversationSnapshot)
		} catch (error) {
			firstError ??= error
			await this.withStateLock(() => {
				this.pendingApiConversationOperations.unshift(...pending.apiConversation)
				this.pendingApiConversationBytes += pending.apiConversationBytes
			})
		}
		if (firstError) throw firstError
		await this.createBaselinesWhenTailIsLarge()
	}

	private async createBaselinesWhenTailIsLarge(): Promise<void> {
		if (this.persistenceRetired) return
		const taskDirectory = await ensureTaskDirectoryExists(this.taskId)
		const presentationTailPath = `${taskDirectory}/${GlobalFileNames.uiMessageOperations}`
		const apiTailPath = `${taskDirectory}/${GlobalFileNames.apiConversationHistoryOperations}`
		const [presentationNeedsBaseline, apiNeedsBaseline] = await Promise.all([
			operationLogExceedsBaselineThreshold(presentationTailPath),
			operationLogExceedsBaselineThreshold(apiTailPath),
		])
		if (this.persistenceRetired || (!presentationNeedsBaseline && !apiNeedsBaseline)) return

		await this.withStateLock(async () => {
			if (this.persistenceRetired) return
			if (presentationNeedsBaseline && this.pendingPresentationOperations.length === 0) {
				this.materializeAllPresentationAppends()
				await createPresentationBaseline(this.taskId, this.diracMessages, this.presentationOffset)
			}
			if (apiNeedsBaseline && this.pendingApiConversationOperations.length === 0) {
				await createApiConversationBaseline(this.taskId, this.apiConversationHistory, this.apiHistoryOffset)
			}
		})
	}

	/**
	 * Flush any pending dirty writes to disk without holding the message-state lock during I/O.
	 * Safe to call at any time — no-op if nothing is dirty or this handler has been retired.
	 */
	async flushPendingWrites(): Promise<void> {
		this.cancelScheduledUiFlush()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(() => this.persistPendingOperations())
	}

	/**
	 * Flush task history to disk. Should be called at turn boundaries
	 * (end of API request cycle, after resume, after restore).
	 */
	async flushTaskHistory(): Promise<void> {
		await this.flushPendingWrites()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(() => this.updateTaskHistoryInternal())
	}

	getApiConversationHistory(): DiracStorageMessage[] {
		return this.apiConversationHistory
	}

	setApiConversationHistory(newHistory: DiracStorageMessage[], lastOffset = -1): void {
		this.apiConversationHistory = newHistory.map(removeUserInputMarkersFromMessage)
		this.apiHistoryOffset = lastOffset
		this.pendingApiConversationOperations = []
		this.pendingApiConversationBytes = 0
		this.lastModelInfo = findLastModelInfo(this.apiConversationHistory)
	}

	getApiConversationProviderState(): ApiConversationProviderState {
		return this.apiConversationProviderState
	}

	setApiConversationProviderState(state: ApiConversationProviderState): void {
		this.apiConversationProviderState = state
	}

	async overwriteApiConversationProviderState(state: ApiConversationProviderState): Promise<void> {
		await this.flushPendingWrites()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(async () => {
			if (this.persistenceRetired) return
			await this.withStateLock(async () => {
				this.apiConversationProviderState = state
				await saveApiConversationProviderState(this.taskId, state)
			})
		})
	}

	getDiracMessages(): DiracMessage[] {
		this.materializeAllPresentationAppends()
		return this.diracMessages
	}

	setDiracMessages(newMessages: DiracMessage[], lastOffset = -1) {
		const previousMessages = this.diracMessages
		this.diracMessages = newMessages
		this.presentationOffset = lastOffset
		this.pendingTextAppendsByMessageId.clear()
		this.pendingPresentationOperations = []
		this.pendingPresentationPersistenceBytes = 0
		this.pendingPresentationPublications = []
		this.pendingPresentationPublicationBytes = 0
		this.presentationPublicationGapThroughOffset = undefined
		this.presentationStateGeneration++
		this.rebuildMessageIndexes()
		this.rebuildHistoryProjection()
		this.emitDiracMessagesChanged({
			type: "set",
			messages: this.diracMessages,
			previousMessages,
		})
	}

	private rebuildMessageIndexes(): void {
		this.messageIndexById.clear()
		this.cardMessageIndexById.clear()
		this.lastApiStatusMessageId = undefined
		for (let index = 0; index < this.diracMessages.length; index++) {
			const message = this.diracMessages[index]
			this.messageIndexById.set(message.id, index)
			if (message.content.type === DiracMessageType.CARD) {
				this.cardMessageIndexById.set(message.content.card.id, index)
			}
			if (message.content.type === DiracMessageType.API_STATUS) this.lastApiStatusMessageId = message.id
		}
	}

	private updateLatestApiStatusAfterMutation(message: DiracMessage, wasApiStatus: boolean): void {
		if (message.content.type === DiracMessageType.API_STATUS) {
			const currentIndex = this.lastApiStatusMessageId ? (this.messageIndexById.get(this.lastApiStatusMessageId) ?? -1) : -1
			const messageIndex = this.messageIndexById.get(message.id) ?? -1
			if (messageIndex >= currentIndex) this.lastApiStatusMessageId = message.id
			return
		}
		if (wasApiStatus && message.id === this.lastApiStatusMessageId) this.findLastApiStatusMessageId()
	}

	private findLastApiStatusMessageId(): void {
		this.lastApiStatusMessageId = undefined
		for (let index = this.diracMessages.length - 1; index >= 0; index--) {
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.API_STATUS) continue
			this.lastApiStatusMessageId = message.id
			return
		}
	}

	private rebuildHistoryProjection(): void {
		this.apiMetrics = getApiMetrics(this.diracMessages)
		this.metricContributionByMessageId.clear()
		this.lastRelevantMessageId = undefined
		for (const message of this.diracMessages) {
			this.metricContributionByMessageId.set(message.id, getApiMetrics([message]))
			if (isTaskHistoryRelevantMessage(message)) this.lastRelevantMessageId = message.id
		}
	}

	private updateHistoryProjection(
		message: DiracMessage | undefined,
		replaced?: {
			id: string
			metrics: ReturnType<typeof getApiMetrics>
			wasRelevant: boolean
		},
		reusePreviousMetrics = false,
	): void {
		if (replaced) {
			addApiMetrics(this.apiMetrics, replaced.metrics, -1)
			this.metricContributionByMessageId.delete(replaced.id)
		}
		if (message) {
			const metrics = reusePreviousMetrics && replaced ? replaced.metrics : getApiMetrics([message])
			this.metricContributionByMessageId.set(message.id, metrics)
			addApiMetrics(this.apiMetrics, metrics, 1)
		}

		const messageIsRelevant = message ? isTaskHistoryRelevantMessage(message) : false
		if (messageIsRelevant) {
			const currentLastIndex = this.lastRelevantMessageId
				? (this.messageIndexById.get(this.lastRelevantMessageId) ?? -1)
				: -1
			const messageIndex = this.messageIndexById.get(message!.id) ?? -1
			if (messageIndex >= currentLastIndex) this.lastRelevantMessageId = message!.id
			return
		}
		if (replaced?.wasRelevant && replaced.id === this.lastRelevantMessageId) this.findLastRelevantMessageId()
	}

	private historyProjectionBeforeMutation(message: DiracMessage): {
		id: string
		metrics: ReturnType<typeof getApiMetrics>
		wasRelevant: boolean
	} {
		return {
			id: message.id,
			metrics: this.metricContributionByMessageId.get(message.id) ?? getApiMetrics([message]),
			wasRelevant: isTaskHistoryRelevantMessage(message),
		}
	}

	private findLastRelevantMessageId(): void {
		this.lastRelevantMessageId = undefined
		for (let index = this.diracMessages.length - 1; index >= 0; index--) {
			if (!isTaskHistoryRelevantMessage(this.diracMessages[index])) continue
			this.lastRelevantMessageId = this.diracMessages[index].id
			return
		}
	}

	/**
	 * Update task history with current state.
	 * This can be slow due to folder size calculation, so it should be called
	 * outside of the stateMutex lock when possible.
	 */
	private async updateTaskHistoryInternal(): Promise<void> {
		if (this.persistenceRetired) return
		try {
			const taskMessage = this.diracMessages[0]
			if (!taskMessage) return
			const lastRelevantMessage =
				(this.lastRelevantMessageId ? this.getMessageById(this.lastRelevantMessageId) : undefined) ?? taskMessage
			const apiMetrics = this.apiMetrics
			const taskDirectory = await ensureTaskDirectoryExists(this.taskId)
			const taskDirectorySize = await getFolderSize.loose(taskDirectory)

			const cwd = await getCwd(getDesktopDir())
			const shadowGitConfigWorkTree = await this.checkpointTracker?.getShadowGitConfigWorkTree()
			if (this.persistenceRetired) return

			await this.updateTaskHistory({
				id: this.taskId,
				ulid: this.ulid,
				ts: lastRelevantMessage.ts,
				task: taskMessage.content.type === "markdown" ? taskMessage.content.content : "",
				tokensIn: apiMetrics.totalTokensIn + this.taskState.utilityPermissionInputTokens,
				tokensOut: apiMetrics.totalTokensOut + this.taskState.utilityPermissionOutputTokens,
				cacheWrites:
					this.taskState.utilityPermissionCacheWriteTokens === 0
						? apiMetrics.totalCacheWrites
						: (apiMetrics.totalCacheWrites ?? 0) + this.taskState.utilityPermissionCacheWriteTokens,
				cacheReads:
					this.taskState.utilityPermissionCacheReadTokens === 0
						? apiMetrics.totalCacheReads
						: (apiMetrics.totalCacheReads ?? 0) + this.taskState.utilityPermissionCacheReadTokens,
				totalCost: apiMetrics.totalCost + this.taskState.utilityPermissionCost,
				size: taskDirectorySize,
				shadowGitConfigWorkTree,
				cwdOnTaskInitialization: cwd,
				conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
				isFavorited: this.taskIsFavorited,
				workspaceRootPath: this.workspaceRootPath,
				checkpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
				modelId: this.lastModelInfo?.modelId,
			})
		} catch (error) {
			Logger.error("Failed to update task history:", error)
			throw error
		}
	}

	/**
	 * Save dirac messages and update task history (public API with mutex protection)
	 * This is the main entry point for saving message state from external callers
	 */
	async saveDiracMessagesAndUpdateHistory(): Promise<void> {
		await this.flushPendingWrites()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(() => this.updateTaskHistoryInternal())
	}

	async addToApiConversationHistory(message: DiracStorageMessage) {
		await this.withStateLock(async () => {
			const storedMessage = removeUserInputMarkersFromMessage(message)
			this.apiConversationHistory.push(storedMessage)
			if (storedMessage.modelInfo) this.lastModelInfo = storedMessage.modelInfo
			this.recordApiConversationOperation({
				offset: ++this.apiHistoryOffset,
				type: "append_message",
				message: structuredClone(storedMessage),
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleApiHistoryFlush()
	}

	async appendToLastApiConversationUserMessage(contentBlock: DiracUserContent): Promise<DiracStorageMessage> {
		const sanitizedContentBlock = removeUserInputMarkersFromContent(contentBlock) as DiracUserContent
		const message = await this.withStateLock(() => {
			const lastMessage = this.apiConversationHistory.at(-1)
			if (!lastMessage || lastMessage.role !== "user") {
				throw new Error("Cannot append content without a final user API conversation message")
			}
			if (typeof lastMessage.content === "string") {
				lastMessage.content = [{ type: "text", text: lastMessage.content }, sanitizedContentBlock]
			} else {
				lastMessage.content.push(sanitizedContentBlock)
			}
			this.recordApiConversationOperation({
				offset: ++this.apiHistoryOffset,
				type: "append_user_content",
				content: structuredClone(sanitizedContentBlock),
			})
			return lastMessage
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleApiHistoryFlush()
		return message
	}

	async overwriteApiConversationHistory(newHistory: DiracStorageMessage[]): Promise<void> {
		await this.flushPendingWrites()
		await this.withStateLock(() => {
			this.apiConversationHistory = newHistory.map(removeUserInputMarkersFromMessage)
			this.lastModelInfo = findLastModelInfo(this.apiConversationHistory)
			this.recordApiConversationOperation({
				offset: ++this.apiHistoryOffset,
				type: "reset",
				messages: this.apiConversationHistory,
			})
		})
		await this.flushPendingWrites()
	}

	async recordDeliveredSteeringMessageIds(messageIds: readonly string[]): Promise<void> {
		await this.flushPendingWrites()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(async () => {
			if (this.persistenceRetired) return
			await this.withStateLock(async () => {
				const deliveredIds = new Set(this.apiConversationProviderState.deliveredSteeringMessageIds ?? [])
				for (const messageId of messageIds) deliveredIds.add(messageId)
				this.apiConversationProviderState = {
					...this.apiConversationProviderState,
					deliveredSteeringMessageIds: [...deliveredIds],
				}
				await saveApiConversationProviderState(this.taskId, this.apiConversationProviderState)
			})
		})
	}

	/**
	 * Add a new message to diracMessages array with proper index tracking
	 * CRITICAL: This entire operation must be atomic to prevent race conditions (RC-4)
	 * The conversationHistoryIndex must be set correctly based on the current state,
	 * and the message must be added and saved without any interleaving operations
	 */
	async addToDiracMessages(message: DiracMessage) {
		await this.withStateLock(async () => {
			if (this.messageIndexById.has(message.id)) throw new Error(`Message with id ${message.id} already exists`)
			if (message.content.type === DiracMessageType.CARD && this.cardMessageIndexById.has(message.content.card.id)) {
				throw new Error(`Card with id ${message.content.card.id} already exists`)
			}
			message.conversationHistoryIndex = this.apiConversationHistory.length - 1
			message.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange
			const index = this.diracMessages.length
			this.diracMessages.push(message)
			this.messageIndexById.set(message.id, index)
			if (message.content.type === DiracMessageType.CARD) {
				this.cardMessageIndexById.set(message.content.card.id, index)
			}
			if (message.content.type === DiracMessageType.API_STATUS) this.lastApiStatusMessageId = message.id
			this.updateHistoryProjection(message)
			this.emitDiracMessagesChanged({
				type: "add",
				messages: this.diracMessages,
				index,
				message,
			})
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "create",
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	/**
	 * Replace the entire diracMessages array with new messages
	 * Protected by mutex to prevent concurrent modifications (RC-4)
	 */
	async overwriteDiracMessages(newMessages: DiracMessage[]) {
		await this.flushPendingWrites()
		await this.withStateLock(() => {
			const previousMessages = this.diracMessages
			this.pendingTextAppendsByMessageId.clear()
			this.diracMessages = newMessages
			this.rebuildMessageIndexes()
			this.rebuildHistoryProjection()
			this.emitDiracMessagesChanged({
				type: "set",
				messages: this.diracMessages,
				previousMessages,
			})
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "reset",
				messages: newMessages,
			})
		})
		await this.flushPendingWrites()
	}

	/**
	 * Find the index of a message by its ID
	 */
	findMessageIndexById(id: string): number {
		return this.messageIndexById.get(id) ?? -1
	}

	getMessageById(id: string): DiracMessage | undefined {
		const index = this.messageIndexById.get(id)
		if (index === undefined) return undefined
		const message = this.diracMessages[index]
		this.materializePresentationAppends(message)
		return message
	}

	getLatestApiStatusMessage(): DiracMessage | undefined {
		return this.lastApiStatusMessageId ? this.getMessageById(this.lastApiStatusMessageId) : undefined
	}

	getPresentationOffset(): number {
		return this.presentationOffset
	}

	getPresentationStateGeneration(): number {
		return this.presentationStateGeneration
	}

	/**
	 * Find the index of a message containing a card with the specified ID
	 */
	findMessageIndexByCardId(cardId: string): number {
		return this.cardMessageIndexById.get(cardId) ?? -1
	}

	async patchCardById(cardId: string, patch: Partial<Omit<Card, "id">>): Promise<Readonly<Card>> {
		const updatedCard = await this.withStateLock(() => {
			const index = this.requireCardMessageIndex(cardId)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.CARD) throw new Error(`Message with card id ${cardId} is not a card`)
			this.materializePresentationAppends(message)
			const before = this.historyProjectionBeforeMutation(message)
			Object.assign(message.content.card, patch)
			this.updateHistoryProjection(message, before, patch.header === undefined && patch.body === undefined && patch.rawOutput === undefined)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_card",
				id: message.id,
				patch,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
			return message.content.card
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
		return updatedCard
	}

	async appendCardBodyById(cardId: string, text: string): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireCardMessageIndex(cardId)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.CARD) throw new Error(`Message with card id ${cardId} is not a card`)
			this.bufferPresentationAppend(message.id, text)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "append_card_body",
				id: message.id,
				text,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	async appendMarkdownById(id: string, text: string): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireMessageIndex(id)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.MARKDOWN) throw new Error(`Message with id ${id} is not markdown`)
			this.bufferPresentationAppend(id, text)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "append_markdown",
				id,
				text,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
				appendedText: text,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	async patchMarkdownById(
		id: string,
		patch: Partial<Omit<Extract<DiracMessage["content"], { type: DiracMessageType.MARKDOWN }>, "type" | "content">>,
	): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireMessageIndex(id)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.MARKDOWN) throw new Error(`Message with id ${id} is not markdown`)
			this.materializePresentationAppends(message)
			const before = this.historyProjectionBeforeMutation(message)
			Object.assign(message.content, patch)
			this.updateHistoryProjection(message, before, true)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_markdown",
				id,
				patch,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	async patchApiStatusById(
		id: string,
		patch: Partial<DiracApiReqInfo>,
		deletions: (keyof DiracApiReqInfo)[] = [],
	): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireMessageIndex(id)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.API_STATUS)
				throw new Error(`Message with id ${id} is not an API status`)
			const before = this.historyProjectionBeforeMutation(message)
			Object.assign(message.content.status, patch)
			for (const key of deletions) delete message.content.status[key]
			this.updateHistoryProjection(message, before)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_api_status",
				id,
				patch,
				...(deletions.length > 0 ? { deletions } : {}),
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	private requireMessageIndex(id: string): number {
		const index = this.messageIndexById.get(id)
		if (index === undefined) throw new Error(`Message with id ${id} not found`)
		return index
	}

	private requireCardMessageIndex(cardId: string): number {
		const index = this.cardMessageIndexById.get(cardId)
		if (index === undefined) throw new Error(`Card with id ${cardId} not found`)
		return index
	}
	/**
	 * Update a specific message in the diracMessages array
	 * The entire operation (validate, update, save) is atomic to prevent races (RC-4)
	 */
	async updateDiracMessage(index: number, updates: Partial<Omit<DiracMessage, "id">>): Promise<void> {
		await this.withStateLock(() => {
			if (index < 0 || index >= this.diracMessages.length) {
				throw new Error(`Invalid message index: ${index}`)
			}

			const message = this.diracMessages[index]
			this.materializePresentationAppends(message)
			const before = this.historyProjectionBeforeMutation(message)
			const wasApiStatus = message.content.type === DiracMessageType.API_STATUS
			Object.assign(message, updates)
			this.updateLatestApiStatusAfterMutation(message, wasApiStatus)
			this.updateHistoryProjection(message, before, updates.content === undefined)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_message",
				id: message.id,
				patch: updates,
			})

			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	async patchMessageById(id: string, patch: Partial<Omit<DiracMessage, "id">>): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireMessageIndex(id)
			const message = this.diracMessages[index]
			this.materializePresentationAppends(message)
			const before = this.historyProjectionBeforeMutation(message)
			const wasApiStatus = message.content.type === DiracMessageType.API_STATUS
			Object.assign(message, patch)
			this.updateLatestApiStatusAfterMutation(message, wasApiStatus)
			this.updateHistoryProjection(message, before, patch.content === undefined)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_message",
				id,
				patch,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	/**
	 * Delete a specific message from the diracMessages array
	 * The entire operation (validate, delete, save) is atomic to prevent races (RC-4)
	 */
	async deleteDiracMessage(index: number): Promise<void> {
		await this.withStateLock(() => {
			if (index < 0 || index >= this.diracMessages.length) {
				throw new Error(`Invalid message index: ${index}`)
			}

			const previousMessage = this.diracMessages[index]
			this.materializePresentationAppends(previousMessage)
			const before = this.historyProjectionBeforeMutation(previousMessage)
			this.diracMessages.splice(index, 1)
			this.pendingTextAppendsByMessageId.delete(previousMessage.id)
			this.rebuildMessageIndexes()
			this.updateHistoryProjection(undefined, before)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "delete",
				id: previousMessage.id,
			})

			this.emitDiracMessagesChanged({
				type: "delete",
				messages: this.diracMessages,
				index,
				previousMessage,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/message-state.ts (lines 413-416)
```
	getDiracMessages(): DiracMessage[] {
		this.materializeAllPresentationAppends()
		return this.diracMessages
	}
```

### /Users/highlands/pools/Development/dirac/src/core/task/ApiConversationManager.ts (lines 17-508)
```
export class ApiConversationManager {
	constructor(private dependencies: ApiConversationManagerDependencies) { }

	setApi(api: ApiConversationManagerDependencies["api"]): void {
		this.dependencies.api = api
	}

	private getOperationalApi(): ApiConversationManagerDependencies["api"] {
		return this.dependencies.getRequestRuntime()?.api ?? this.dependencies.api
	}

	public async scheduleProviderConversationCompaction(
		previousConversationHistoryDeletedRange: [number, number] | undefined,
		conversationHistoryDeletedRange: [number, number],
	): Promise<void> {
		const pendingCompaction = { previousConversationHistoryDeletedRange, conversationHistoryDeletedRange }
		this.dependencies.taskState.pendingApiConversationCompaction = pendingCompaction
		const providerState = this.dependencies.messageStateHandler.getApiConversationProviderState()
		await this.dependencies.messageStateHandler.overwriteApiConversationProviderState({
			...providerState,
			pendingCompaction,
		})
	}

	public calculatePreCompactDeletedRange(apiConversationHistory: DiracStorageMessage[]): [number, number] {
		const newDeletedRange = this.dependencies.contextManager.getNextTruncationRange(
			apiConversationHistory,
			this.dependencies.taskState.conversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation on error
		)

		return newDeletedRange || [0, 0]
	}

	public async handleContextWindowExceededError(): Promise<void> {
		const apiConversationHistory = this.dependencies.messageStateHandler.getApiConversationHistory()

		// Run PreCompact hook before truncation
		const hooksEnabled = getHooksEnabledSafe(this.dependencies.getWorkingConfiguration().settings.hooksEnabled)
		if (hooksEnabled) {
			try {
				// Calculate what the new deleted range will be
				const deletedRange = this.calculatePreCompactDeletedRange(apiConversationHistory)

				// Execute hook - throws HookCancellationError if cancelled
				await executePreCompactHookWithCleanup({
					taskId: this.dependencies.taskId,
					ulid: this.dependencies.ulid,
					modelContext: getTaskHookModelContext(
						this.getOperationalApi(),
						this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration(),
					),
					apiConversationHistory,
					conversationHistoryDeletedRange: this.dependencies.taskState.conversationHistoryDeletedRange,
					contextManager: this.dependencies.contextManager,
					diracMessages: this.dependencies.messageStateHandler.getDiracMessages(),
					messageStateHandler: this.dependencies.messageStateHandler,
					compactionStrategy: "standard-truncation-lastquarter",
					deletedRange,
					messenger: this.dependencies.taskMessenger,
					setActiveHookExecution: this.dependencies.setActiveHookExecution.bind(this.dependencies),
					clearActiveHookExecution: this.dependencies.clearActiveHookExecution.bind(this.dependencies),
					postStateToWebview: this.dependencies.postStateToWebview.bind(this.dependencies),
					taskState: this.dependencies.taskState,
					cancelTask: this.dependencies.cancelTask.bind(this.dependencies),
					hooksEnabled,
				})
			} catch (error) {
				// If hook was cancelled, re-throw to stop compaction
				if (error instanceof HookCancellationError) {
					throw error
				}

				// Graceful degradation: Log error but continue with truncation
				Logger.error("[PreCompact] Hook execution failed:", error)
			}
		}

		// Proceed with standard truncation
		const previousConversationHistoryDeletedRange = this.dependencies.taskState.conversationHistoryDeletedRange
		const newDeletedRange = this.dependencies.contextManager.getNextTruncationRange(
			apiConversationHistory,
			previousConversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation
		)

		this.dependencies.taskState.conversationHistoryDeletedRange = newDeletedRange
		if (newDeletedRange) {
			await this.scheduleProviderConversationCompaction(previousConversationHistoryDeletedRange, newDeletedRange)
		}

		await this.dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory()
		this.dependencies.onContextCompacted?.()
	}

	public async determineContextCompaction(previousApiReqIndex: number): Promise<boolean> {
		const useAutoCondense = this.dependencies.getRequestRuntime()?.workingConfiguration.settings.useAutoCondense ??
			this.dependencies.getWorkingConfiguration().settings.useAutoCondense
		if (!useAutoCondense) return false

		if (this.dependencies.taskState.skipNextAutoCondenseCheck) {
			this.dependencies.taskState.skipNextAutoCondenseCheck = false
			return false
		}

		const providerId = this.dependencies.getCurrentProviderInfo().providerId
		const configuredLimit = getAutoCondenseContextLimit(
			(this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration()).settings.autoCondenseContextLimits,
			providerId,
		)
		const shouldCompact = this.dependencies.contextManager.shouldCompactContextWindow(
			this.dependencies.messageStateHandler.getDiracMessages(),
			this.getOperationalApi(),
			previousApiReqIndex,
			configuredLimit,
		)
		if (!shouldCompact || !this.dependencies.taskState.conversationHistoryDeletedRange) {
			return shouldCompact
		}

		const apiHistory = this.dependencies.messageStateHandler.getApiConversationHistory()
		const activeMessageCount = apiHistory.length - this.dependencies.taskState.conversationHistoryDeletedRange[1] - 1

		// The next user message has not been appended yet, so an already-condensed
		// conversation has zero or two active messages at this point.
		return activeMessageCount > 2
	}
	private isCompatibleCheckpoint(
		checkpoint: ApiConversationCheckpoint | undefined,
		providerId: string,
		modelId: string,
		historyLength: number,
	): checkpoint is ApiConversationCheckpoint {
		return (
			checkpoint?.providerId === providerId &&
			checkpoint.modelId === modelId &&
			checkpoint.compactedThroughHistoryIndex >= 0 &&
			checkpoint.compactedThroughHistoryIndex < historyLength
		)
	}

	private hasCompatibleAssistantAfterBoundary(
		history: DiracStorageMessage[],
		boundary: number,
		providerId: string,
		modelId: string,
	): boolean {
		return history
			.slice(boundary + 1)
			.some(
				(message) =>
					message.role === "assistant" &&
					message.modelInfo?.providerId === providerId &&
					message.modelInfo.modelId === modelId &&
					message.id !== undefined,
			)
	}

	public async prepareProviderConversationDispatch(params: {
		systemPrompt: string
		tools: DiracTool[]
		truncatedMessages: DiracStorageMessage[]
		providerId: string
		modelId: string
	}): Promise<{ messages: DiracStorageMessage[]; options: ApiConversationRequestOptions }> {
		if (this.dependencies.taskState.abort) throw new Error("Task instance aborted")

		const fullHistory = this.dependencies.messageStateHandler.getApiConversationHistory()
		let providerState = this.dependencies.messageStateHandler.getApiConversationProviderState()
		let checkpoint = this.isCompatibleCheckpoint(
			providerState.checkpoint,
			params.providerId,
			params.modelId,
			fullHistory.length,
		)
			? providerState.checkpoint
			: undefined

		let dispatchMessages = params.truncatedMessages

		const pendingCompaction = this.dependencies.taskState.pendingApiConversationCompaction ?? providerState.pendingCompaction
		if (pendingCompaction) this.dependencies.taskState.pendingApiConversationCompaction = pendingCompaction
		if (pendingCompaction) {
			const currentDeletedRange = this.dependencies.taskState.conversationHistoryDeletedRange
			const targetDeletedRange = pendingCompaction.conversationHistoryDeletedRange
			if (
				!currentDeletedRange ||
				currentDeletedRange[0] !== targetDeletedRange[0] ||
				currentDeletedRange[1] !== targetDeletedRange[1]
			) {
				this.dependencies.taskState.conversationHistoryDeletedRange = targetDeletedRange
				dispatchMessages = this.dependencies.contextManager.getTruncatedMessages(
					fullHistory,
					targetDeletedRange,
				) as DiracStorageMessage[]
				await this.dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory()
			}
			const boundary = fullHistory.length - 1
			const api = this.getOperationalApi()
			if (api.compactConversation) {
				const messages = checkpoint
					? fullHistory.slice(checkpoint.compactedThroughHistoryIndex + 1)
					: (this.dependencies.contextManager.getTruncatedMessages(
						fullHistory,
						pendingCompaction.previousConversationHistoryDeletedRange,
					) as DiracStorageMessage[])
				try {
					const result = await api.compactConversation({
						systemPrompt: params.systemPrompt,
						messages: messages.map(removeProviderBoundaryMetadataFromMessage),
						tools: params.tools,
						checkpoint,
					})
					if (this.dependencies.taskState.abort) throw new Error("Task instance aborted")
					checkpoint = {
						providerId: params.providerId,
						modelId: params.modelId,
						compactedThroughHistoryIndex: boundary,
						input: result.input,
					}
					providerState = {
						...providerState,
						checkpoint,
						continuationReset: {
							providerId: params.providerId,
							modelId: params.modelId,
							compactedThroughHistoryIndex: boundary,
						},
						pendingCompaction: undefined,
					}
					await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
					this.dependencies.taskState.pendingApiConversationCompaction = undefined
				} catch (error) {
					if (this.dependencies.taskState.abort) throw error
					Logger.error(
						"Provider-native conversation compaction failed; using the plaintext condensed history without opaque state preservation:",
						error,
					)
					checkpoint = undefined
					providerState = {
						...providerState,
						checkpoint: undefined,
						continuationReset: {
							providerId: params.providerId,
							modelId: params.modelId,
							compactedThroughHistoryIndex: boundary,
						},
						pendingCompaction: undefined,
					}
					await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
					this.dependencies.taskState.pendingApiConversationCompaction = undefined
				}
			} else {
				Logger.warn(
					"Provider-native conversation compaction is unavailable; using the plaintext condensed history without opaque state preservation.",
				)
				checkpoint = undefined
				providerState = {
					...providerState,
					checkpoint: undefined,
					continuationReset: {
						providerId: params.providerId,
						modelId: params.modelId,
						compactedThroughHistoryIndex: boundary,
					},
					pendingCompaction: undefined,
				}
				await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
				this.dependencies.taskState.pendingApiConversationCompaction = undefined
			}
		}

		const continuationReset = providerState.continuationReset
		const resetIsCompatible =
			continuationReset?.providerId === params.providerId && continuationReset.modelId === params.modelId
		let breakProviderContinuation = resetIsCompatible
		if (
			resetIsCompatible &&
			this.hasCompatibleAssistantAfterBoundary(
				fullHistory,
				continuationReset.compactedThroughHistoryIndex,
				params.providerId,
				params.modelId,
			)
		) {
			providerState = { ...providerState, continuationReset: undefined }
			await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
			breakProviderContinuation = false
		}

		if (providerState.checkpoint && !checkpoint) {
			providerState = { ...providerState, checkpoint: undefined }
			await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
		}

		if (this.dependencies.taskState.abort) throw new Error("Task instance aborted")

		const enableNativeWebSearch =
			this.getOperationalApi().supportsNativeWebSearch?.() === true &&
			this.dependencies.taskState.activeSkillIds.includes(NATIVE_WEB_SEARCH_SKILL_NAME)

		return {
			messages: checkpoint ? fullHistory.slice(checkpoint.compactedThroughHistoryIndex + 1) : dispatchMessages,
			options: { checkpoint, breakProviderContinuation, enableNativeWebSearch },
		}
	}

	public async prepareApiRequest(params: {
		userContent: DiracContent[]
		shouldCompact?: boolean
		includeFileDetails: boolean
		useCompactPrompt: boolean
		previousApiReqIndex: number
		directResponseText?: string
		popover?: boolean
		isFirstRequest: boolean
		providerId: string
		modelId: string
		mode: string
		requestId: string
		afterUserContentPersisted?: () => Promise<void>
	}): Promise<{
		userContent: DiracContent[]
		lastApiReqIndex: number
		isDirectResponse?: boolean
		directResponseText?: string
		didConsumeUserContent: boolean
	}> {
		let nextUserContent = params.userContent

		// 1. Run User Prompt Submit Hook
		const hookResult = await this.dependencies.runUserPromptSubmitHook(
			nextUserContent,
			params.isFirstRequest ? "initial_task" : "feedback",
		)
		if (hookResult.cancel) {
			return {
				userContent: nextUserContent,
				lastApiReqIndex: params.previousApiReqIndex,
				isDirectResponse: true,
				directResponseText: hookResult.errorMessage,
				didConsumeUserContent: false,
			}
		}

		let parsedUserContent: DiracContent[]
		let environmentDetails: string
		let diracrulesError: boolean
		let isDirectResponse = false
		let directResponseText = params.directResponseText
		let directActions: SlashCommandDirectAction[] | undefined

		if (params.shouldCompact) {
			parsedUserContent = [...nextUserContent]
			environmentDetails = ""
			diracrulesError = false
			this.dependencies.taskState.lastAutoCondenseTriggerIndex = params.previousApiReqIndex
			this.dependencies.taskState.pendingCondenseSource = "automatic"
		} else {
			const [
				loadedUserContent,
				loadedEnvironmentDetails,
				loadedDiracrulesError,
				availableSkills,
				loadedIsDirectResponse,
				loadedDirectResponseText,
				loadedDirectActions,
			] = await this.dependencies.loadContext(nextUserContent, params.includeFileDetails, params.useCompactPrompt)
			parsedUserContent = loadedUserContent
			environmentDetails = loadedEnvironmentDetails
			diracrulesError = loadedDiracrulesError
			isDirectResponse = loadedIsDirectResponse
			directResponseText = loadedDirectResponseText ?? params.directResponseText
			directActions = loadedDirectActions
			this.dependencies.taskState.availableSkills = availableSkills
		}

		const skillIds = [
			...new Set(
				(directActions ?? []).flatMap((action) => (action.type === "activateSkill" ? [action.skillId] : [])),
			),
		]
		for (const skillId of skillIds) {
			await this.dependencies.activateSkill(skillId)
		}

		if (directActions?.some((action) => action.type === "condenseConversation")) {
			const continuation = await this.dependencies.runLocalConversationCompaction("user")
			if (!continuation) {
				return {
					userContent: parsedUserContent,
					lastApiReqIndex: params.previousApiReqIndex,
					isDirectResponse: true,
					didConsumeUserContent: true,
				}
			}
			parsedUserContent.unshift({ type: "text", text: continuation })
			const pinnedContext = this.dependencies.getPinnedContext?.()
			if (pinnedContext) parsedUserContent.splice(1, 0, { type: "text", text: pinnedContext })
		}

		if (isDirectResponse) {
			return {
				userContent: directResponseText ? [{ type: "text", text: directResponseText }] : parsedUserContent,
				lastApiReqIndex: -1,
				isDirectResponse: true,
				directResponseText,
				didConsumeUserContent: true,
			}
		}

		// error handling if the user uses the /newrule command & their .diracrules is a file, for file read operations didnt work properly
		if (diracrulesError === true) {
			const card = await this.dependencies.taskMessenger.createCard({
				header: "Rule Error",
				body: "Issue with processing the /newrule command. Double check that, if '.diracrules' already exists, it's a directory and not a file. Otherwise there was an issue referencing this file/directory.",
				status: CardStatus.ERROR,
			})
			await card.finalize(CardStatus.ERROR)
		}

		// Replace userContent with parsed content that includes file details and command instructions.
		const userContent = parsedUserContent

		// add environment details as its own text block, separate from tool results
		// do not add environment details to the message which we are compacting the context window
		if (environmentDetails) {
			userContent.push({ type: "text", text: environmentDetails })
		}

		if (params.shouldCompact) {
			const pinnedContext = this.dependencies.getPinnedContext?.()
			if (pinnedContext) userContent.push({ type: "text", text: pinnedContext })
			userContent.push({ type: "text", text: autoCondensePrompt() })
		}

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		const apiReqId = `api-req-${Date.now()}`
		await this.dependencies.taskMessenger.upsertApiStatus({
			id: apiReqId,
			request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
		})

		telemetryService.captureConversationTurnEvent(
			this.dependencies.ulid,
			params.providerId,
			params.modelId,
			"user",
			params.mode as Mode,
			undefined,
			this.dependencies.taskState.useNativeToolCalls,
		)

		// Capture task initialization timing telemetry for the first API request
		if (params.isFirstRequest) {
			const durationMs = Math.round(performance.now() - this.dependencies.taskInitializationStartTime)
			telemetryService.captureTaskInitialization(
				this.dependencies.ulid,
				this.dependencies.taskId,
				durationMs,
				(this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration()).settings.enableCheckpointsSetting,
			)
		}

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
		const lastApiReqIndex = this.dependencies.messageStateHandler.findMessageIndexById(apiReqId)
		if (lastApiReqIndex === -1) throw new Error(`API status ${apiReqId} not found`)
		await this.dependencies.messageStateHandler.patchApiStatusById(apiReqId, {
			request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
		})

		await this.dependencies.postStateToWebview()

		await this.dependencies.messageStateHandler.addToApiConversationHistory({
			role: "user",
			content: userContent,
			ts: Date.now(),
		})
		const modeNotice = this.dependencies.taskState.pendingModeNotice
		if (
			!params.shouldCompact &&
			modeNotice?.mode === params.mode &&
			modeNotice.includedInRequestId === params.requestId
		) {
			this.dependencies.taskState.pendingModeNotice = undefined
		}
		await params.afterUserContentPersisted?.()

		return { userContent, lastApiReqIndex, directResponseText, didConsumeUserContent: true }
	}
}
```


## Source Files:

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

