---
component_id: 1.1
component_name: Task Execution & Tool Runtime
---

# Task Execution & Tool Runtime

## Component Description

Executes agent tasks, tool modules, subagents, goals, lifecycle hooks, command permissions, and conversation condensation.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/task/TaskState.ts (lines 22-270)
```
export class TaskState {
	status: TaskStatus = TaskStatus.IDLE

	// Task-level timing
	taskStartTimeMs = Date.now()
	#taskFirstTokenTimeMs?: number

	// Streaming flags — writable only through the named transitions below.
	#isApiRequestActive = false
	#activeVoiceStreamId?: string
	#isWaitingForFirstChunk = false
	#didCompleteReadingStream = false

	get isApiRequestActive(): boolean {
		return this.#isApiRequestActive
	}
	get activeVoiceStreamId(): string | undefined {
		return this.#activeVoiceStreamId
	}
	get isWaitingForFirstChunk(): boolean {
		return this.#isWaitingForFirstChunk
	}
	get didCompleteReadingStream(): boolean {
		return this.#didCompleteReadingStream
	}

	/** First-wins: recorded once for the whole task, measured from taskStartTimeMs. */
	get taskFirstTokenTimeMs(): number | undefined {
		return this.#taskFirstTokenTimeMs
	}
	recordFirstTokenAt(timeMs: number): void {
		this.#taskFirstTokenTimeMs ??= timeMs
	}

	/** Marks the outbound request as live. */
	beginApiRequest(): void {
		this.#isApiRequestActive = true
	}
	/** Settles the request; the voice stream attachment always releases with it. */
	endApiRequest(): void {
		this.#isApiRequestActive = false
		this.#activeVoiceStreamId = undefined
	}
	beginFirstChunkWait(): void {
		this.#isWaitingForFirstChunk = true
	}
	endFirstChunkWait(): void {
		this.#isWaitingForFirstChunk = false
	}
	completeStreamRead(): void {
		this.#didCompleteReadingStream = true
	}
	resetStreamRead(): void {
		this.#didCompleteReadingStream = false
	}
	attachVoiceStream(id: string): void {
		this.#activeVoiceStreamId = id
	}
	/** Detaches the stream; an expectedId guards against clearing a newer attachment. */
	detachVoiceStream(expectedId?: string): void {
		if (expectedId !== undefined && this.#activeVoiceStreamId !== expectedId) return
		this.#activeVoiceStreamId = undefined
	}

	// Content processing
	assistantMessageContent: AssistantMessageContent[] = []
	useNativeToolCalls = false
	userMessageContent: DiracUserContent[] = []
	userMessageContentReady = false
	// Map of tool names to their tool_use_id for creating proper ToolResultBlockParam
	toolUseIdMap: Map<string, string> = new Map()

	// Ask/Response handling
	askResponse?: DiracAskResponse
	/** Card owning the pending response, including responses received before its waiter finishes setup. */
	askResponseCardId?: string
	askResponseAction?: string
	askResponseValue?: string

	askResponseUserEdits?: Record<string, string>
	askResponseText?: string
	askResponseImages?: string[]
	askResponseFiles?: string[]
	lastMessageTs?: number
	waitingCardIds: string[] = []
	get lastWaitingCardId(): string | undefined {
		return this.waitingCardIds[0]
	}

	// Plan interaction and mode-entry state
	isAwaitingPlanResponse = false
	didRespondToPlanAskBySwitchingMode = false
	/** Remains pending until the exact request that includes the notice is persisted. */
	pendingModeNotice?: { mode: "plan" | "act"; includedInRequestId?: string }

	// Context and history
	conversationHistoryDeletedRange?: [number, number]
	/** Session-owned snapshots injected into every compacted request. */
	pinnedContext?: string
	/** Canonical task text supplied when this Task lifecycle was created. */
	initialTask?: string

	// Tool execution flags
	didRejectTool = false
	didAlreadyUseTool = false
	didEditFile = false

	// Error tracking
	consecutiveMistakeCount = 0
	doubleCheckCompletionPending = false
	didAttemptCompletion = false
	/** Completion side effects are committed; steering is sealed until the task loop publishes completion. */
	completionCommitted = false
	checkpointManagerErrorMessage?: string
	/** Last rejected completion candidate and all verifier reports that it must address. */
	completionVerificationFailure?: CompletionVerificationFailure

	// Retry tracking — separate counters for independent failure modes
	apiErrorRetryAttempts = 0
	emptyResponseRetryAttempts = 0

	// Task Initialization
	isInitialized = false

	// Task Abort / Cancellation — terminal fields are single-assignment via the methods below.
	/** Owner intent captured before teardown begins. The first terminal intent wins. */
	#cancellationIntent?: TaskCancellationIntent
	/** Response accepted by the Task completion commit. Reset when a follow-up turn starts. */
	#completionResponse?: string
	/** Fatal error preserved for the Task owner. */
	#terminalError?: SerializedTaskError
	/** Task-owned, single-assignment terminal result. */
	#runOutcome?: TaskRunOutcome

	get cancellationIntent(): TaskCancellationIntent | undefined {
		return this.#cancellationIntent
	}
	get completionResponse(): string | undefined {
		return this.#completionResponse
	}
	get terminalError(): SerializedTaskError | undefined {
		return this.#terminalError
	}
	get runOutcome(): TaskRunOutcome | undefined {
		return this.#runOutcome
	}

	/** First intent wins; ignored once the run outcome is settled. */
	captureCancellationIntent(intent: TaskCancellationIntent): void {
		if (this.#runOutcome) return
		this.#cancellationIntent ??= intent
	}

	/** Terminal transition: throws if the run already settled; failure/cancel details ride along. */
	settleRunOutcome(outcome: TaskRunOutcome): TaskRunOutcome {
		if (this.#runOutcome) throw new Error("TaskState.runOutcome is already settled")
		this.#runOutcome = outcome
		if (outcome.kind === "failed") this.#terminalError = outcome.error
		if (outcome.kind === "cancelled") this.#cancellationIntent ??= { kind: "cancelled", reason: outcome.reason }
		if (outcome.kind === "interrupted") this.#cancellationIntent ??= { kind: "interrupted", reason: outcome.reason }
		return outcome
	}

	commitCompletionResponse(response: string): void {
		this.#completionResponse = response
	}
	clearCompletionResponse(): void {
		this.#completionResponse = undefined
	}
	#abortController = new AbortController()

	get abort(): boolean {
		return this.#abortController.signal.aborted
	}

	set abort(value: boolean) {
		if (value) {
			this.#abortController.abort()
			return
		}
		if (this.#abortController.signal.aborted) this.#abortController = new AbortController()
	}

	get abortSignal(): AbortSignal {
		return this.#abortController.signal
	}
	/** Requested by a tool after its current task has unwound. */
	pendingTaskReplacement?: TaskReplacementRequest
	/** One-way latch: set once the abort teardown has run; never reset within a task lifecycle. */
	#didFinishAbortingStream = false
	get didFinishAbortingStream(): boolean {
		return this.#didFinishAbortingStream
	}
	markStreamAbortFinished(): void {
		this.#didFinishAbortingStream = true
	}
	abandoned = false

	// Hook execution tracking for cancellation
	activeHookExecution?: HookExecution

	// Conversation compaction
	skipNextAutoCondenseCheck = false
	pendingApiConversationCompaction?: PendingApiConversationCompaction
	pendingCondenseSource?: "automatic"
	pendingCondenseFeedback?: string
	totalToolCallCount = 0

	lastAutoCondenseTriggerIndex?: number
	initialCheckpointCommitPromise?: Promise<string | undefined>
	availableSkills: SkillMetadata[] = []
	discoveredSkillsCache?: SkillMetadata[]
	// Trusted skills active for this task. Their authorized tool dependencies are request-scoped.
	activeSkillIds: string[] = []

	// Task-scoped user tool ids (persisted across task resume)
	taskScopedToolIds: string[] = []

	// Cumulative metrics for the entire task
	totalInputTokens = 0
	totalOutputTokens = 0
	totalReasoningTokens = 0
	totalCacheWriteTokens = 0
	totalCacheReadTokens = 0
	totalCost = 0

	// Utility permission usage is tracked separately from primary context-window metrics.
	utilityPermissionInputTokens = 0
	utilityPermissionOutputTokens = 0
	utilityPermissionCacheWriteTokens = 0
	utilityPermissionCacheReadTokens = 0
	utilityPermissionCost = 0
	utilityModelReasoningTokens = 0
	utilityModelUsageObserved = false
	utilityModelReasoningAvailable = true
	utilityModelCacheWriteAvailable = true
	utilityModelCacheReadAvailable = true
	utilityModelCostAvailable = true

	// Persistent task-owned mid-turn guidance. Never reset with stream-local state.
	steeringMessages: SteeringMessage[] = []

	// Pending user content from a chat-message tool skip.
	// Set when the user sends text or attachments while a tool is awaiting card input.
	// Consumed by initiateTaskLoop to forward the message to the LLM.
	pendingUserMessage?: string
	pendingUserImages?: string[]
	pendingUserFiles?: string[]
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/ContextLoader.ts (lines 14-151)
```
export class ContextLoader {
	private fileContextLoader: FileContextLoader
	private mentionContextLoader: MentionContextLoader

	constructor(private dependencies: ContextLoaderDependencies) {
		this.fileContextLoader = new FileContextLoader(dependencies)
		this.mentionContextLoader = new MentionContextLoader(dependencies, this.fileContextLoader)
	}

	// Load and enrich context for all user content blocks, returning processed content, env details, skills, and direct response info
	async loadContext(
		userContent: DiracContent[],
		includeFileDetails = false,
		useCompactPrompt = false,
	): Promise<[DiracContent[], string, boolean, SkillMetadata[], boolean, string?, SlashCommandDirectAction[]?]> {
		const cwd = this.dependencies.cwd
		const runtime = this.dependencies.getRequestRuntime()
		const { settings, workspaceConfiguration } = runtime.workingConfiguration
		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(
			this.dependencies.stateManager,
			cwd,
			{
				globalWorkflowToggles: settings.globalWorkflowToggles,
				localWorkflowToggles: workspaceConfiguration.workflowToggles,
			},
		)

		// Discover and filter skills by toggles
		const availableSkills = await this.resolveAvailableSkills(cwd)
		this.dependencies.taskState.availableSkills = availableSkills

		type ParsedTextMetadata = {
			needsDiracrulesFileCheck: boolean
			isDirectResponse: boolean
			directResponseText?: string
			directAction?: SlashCommandDirectAction
		}
		const parsedTextMetadata: Array<ParsedTextMetadata | undefined> = []
		const conversationCondensationAvailable =
			this.dependencies.isTextCondensationAvailable?.(CONVERSATION_CONTINUATION_TEMPLATE_ID) ?? false
		const taskHandoffCondensationAvailable =
			this.dependencies.isTextCondensationAvailable?.(TASK_HANDOFF_TEMPLATE_ID) ?? false

		// Parse a single text block through mention/slash enrichment and retain metadata by input order.
		const parseTextBlock = async (text: string, blockIndex: number): Promise<string> => {
			const result = await this.mentionContextLoader.enrichContext(
				text,
				cwd,
				localWorkflowToggles,
				globalWorkflowToggles,
				this.dependencies.ulid,
				this.dependencies.getCurrentProviderInfo(),
				includeFileDetails,
				availableSkills,
				conversationCondensationAvailable,
				taskHandoffCondensationAvailable,
			)
			parsedTextMetadata[blockIndex] = {
				needsDiracrulesFileCheck: result.needsDiracrulesFileCheck,
				isDirectResponse: result.isDirectResponse ?? false,
				directResponseText: result.directResponseText,
				directAction: result.directAction,
			}
			return result.enrichedText
		}

		// Process all content and environment details in parallel.
		const [processedUserContent, environmentDetails] = await Promise.all([
			Promise.all(
				userContent.map((block, blockIndex) =>
					this.processContentBlock(block, (text) => parseTextBlock(text, blockIndex)),
				),
			),
			this.dependencies.getEnvironmentDetails(includeFileDetails),
		])
		const parsedResults = parsedTextMetadata.filter((result): result is ParsedTextMetadata => result !== undefined)
		const needsDiracrulesFileCheck = parsedResults.some((result) => result.needsDiracrulesFileCheck)
		const lastDirectResponse = [...parsedResults].reverse().find((result) => result.isDirectResponse)
		const directActions = parsedResults.flatMap((result) => (result.directAction ? [result.directAction] : []))

		const diracrulesError = needsDiracrulesFileCheck
			? await ensureLocalDiracDirExists(this.dependencies.cwd, GlobalFileNames.diracRules)
			: false

		return [
			processedUserContent,
			environmentDetails,
			diracrulesError,
			availableSkills,
			lastDirectResponse !== undefined,
			lastDirectResponse?.directResponseText,
			directActions.length > 0 ? directActions : undefined,
		]
	}

	// Discover skills and filter by global/local toggles
	private async resolveAvailableSkills(cwd: string): Promise<SkillMetadata[]> {
		const resolvedSkills = await getOrDiscoverSkills(cwd, this.dependencies.taskState)
		const providerSkills = filterSkillsByProviderCapabilities(resolvedSkills, {
			native_web_search: this.dependencies.getCurrentProviderInfo().supportsNativeWebSearch === true,
		})
		const { settings, workspaceConfiguration } = this.dependencies.getRequestRuntime().workingConfiguration
		const globalToggles = settings.globalSkillsToggles ?? {}
		const localToggles = workspaceConfiguration.localSkillsToggles ?? {}
		return providerSkills.filter((skill) => {
			if (settings.yoloModeToggled && skill.interactiveOnly) return false
			if (skill.source === "builtin") return true
			const toggles = skill.source === "global" ? globalToggles : localToggles
			return toggles[skill.path] !== false
		})
	}

	// Only explicitly marked user input may enter mention/slash enrichment. Every other
	// block is machine-generated or attached context and must remain inert.
	private async processContentBlock(
		block: DiracContent,
		parseTextBlock: (text: string) => Promise<string>,
	): Promise<DiracContent> {
		if (block.type === "text") return this.processTextContent(block, parseTextBlock)
		return block
	}

	// Process only explicitly marked user text containing a supported user-content tag.
	// Remove the transient marker before returning content for persistence/provider dispatch.
	private async processTextContent(
		block: DiracTextContentBlock,
		parseTextBlock: (text: string) => Promise<string>,
	): Promise<DiracTextContentBlock> {
		const { isUserInput, ...contentBlock } = block
		if (!isUserInput || !this.hasUserContentTag(block.text)) return contentBlock
		const processedText = await parseTextBlock(block.text)
		return { ...contentBlock, text: processedText }
	}

	private hasUserContentTag(text: string): boolean {
		return USER_CONTENT_TAGS.some((tag: string) => text.includes(tag))
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/TaskRequestBuilder.ts (lines 68-293)
```
export async function buildApiRequestParams(
	ctx: TaskRequestBuilderContext,
	requestRuntime: TaskRequestRuntime,
	params: { previousApiReqIndex: number; shouldCompact?: boolean },
): Promise<{
	systemPrompt: string
	toolSnapshot: Awaited<ReturnType<ToolExecutor["getSnapshotForRequest"]>>
	contextManagementMetadata: Awaited<ReturnType<ContextManager["getNewContextMessagesAndMetadata"]>>
	providerInfo: ApiProviderInfo
}> {
	const { settings, workspaceConfiguration, executionOptions } = requestRuntime.workingConfiguration
	if (ctx.executionProfile === "standalone") ctx.taskState.pinnedContext = await ctx.getPinnedContext()
	const apiConfiguration = requestRuntime.workingConfiguration.apiConfiguration
	const mode = settings.mode
	const providerInfo: ApiProviderInfo = {
		model: requestRuntime.api.getModel(),
		providerId: (mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider) as string,
		customPrompt: settings.customPrompt,
		mode,
		supportsNativeWebSearch: requestRuntime.api.supportsNativeWebSearch?.() === true,
	}
	const host = await HostProvider.env.getHostVersion({})
	const ide = host?.platform || "Unknown"
	const isCliEnvironment = host.diracType === DiracClient.Cli
	const browserSettings = settings.browserSettings
	const disableBrowserTool = browserSettings?.disableToolUse ?? false
	const modelSupportsBrowserUse = providerInfo.model.info.supportsImages ?? false

	const supportsBrowserUse = modelSupportsBrowserUse && !disableBrowserTool
	const preferredLanguageRaw = settings.preferredLanguage
	const preferredLanguage = getLanguageKey(preferredLanguageRaw as LanguageDisplay)
	const preferredLanguageInstructions =
		preferredLanguage && preferredLanguage !== DEFAULT_LANGUAGE_SETTINGS
			? `# Preferred Language\n\nSpeak in ${preferredLanguage}.`
			: ""

	const { globalToggles, localToggles } = await refreshDiracRulesToggles(ctx.stateManager, ctx.cwd, {
		globalToggles: settings.globalDiracRulesToggles,
		localToggles: workspaceConfiguration.localDiracRulesToggles,
	})
	const { windsurfLocalToggles, cursorLocalToggles, agentsLocalToggles } = await refreshExternalRulesToggles(
		ctx.stateManager,
		ctx.cwd,
		{
			localWindsurfRulesToggles: workspaceConfiguration.localWindsurfRulesToggles,
			localCursorRulesToggles: workspaceConfiguration.localCursorRulesToggles,
			localAgentsRulesToggles: workspaceConfiguration.localAgentsRulesToggles,
		},
	)

	const evaluationContext = await new RuleContextBuilder().buildEvaluationContext({
		cwd: ctx.cwd,
		messageStateHandler: ctx.messageStateHandler,
		workspaceManager: ctx.workspaceManager,
	})

	const globalDiracRulesFilePath = await ensureRulesDirectoryExists()
	const globalRules = await getGlobalDiracRules(globalDiracRulesFilePath, globalToggles, { evaluationContext })
	const globalDiracRulesFileInstructions = globalRules.instructions
	const localRules = await getLocalDiracRules(ctx.cwd, localToggles, { evaluationContext })
	const localDiracRulesFileInstructions = localRules.instructions
	const [localCursorRulesFileInstructions, localCursorRulesDirInstructions] = await getLocalCursorRules(
		ctx.cwd,
		cursorLocalToggles,
	)
	const localWindsurfRulesFileInstructions = await getLocalWindsurfRules(ctx.cwd, windsurfLocalToggles)
	const localAgentsRulesFileInstructions = await getLocalAgentsRules(ctx.cwd, agentsLocalToggles)
	ctx.diracIgnoreController.yoloMode = !!settings.yoloModeToggled
	const isYolo = !!settings.yoloModeToggled
	const diracIgnoreContent = ctx.diracIgnoreController.diracIgnoreContent
	let diracIgnoreInstructions: string | undefined
	if (diracIgnoreContent && !isYolo) {
		diracIgnoreInstructions = formatResponse.diracIgnoreInstructions(diracIgnoreContent)
	}

	let workspaceRoots: Array<{ path: string; name: string; vcs?: string }> | undefined
	const multiRootEnabled = executionOptions.multiRootEnabled
	if (multiRootEnabled && ctx.workspaceManager) {
		workspaceRoots = ctx.workspaceManager.getRoots().map((root) => ({
			path: root.path,
			name: root.name || path.basename(root.path),
			vcs: root.vcs as string | undefined,
		}))
	}

	const resolvedSkills = await getOrDiscoverSkills(ctx.cwd, ctx.taskState)
	const providerSkills = filterSkillsByProviderCapabilities(resolvedSkills, {
		native_web_search: providerInfo.supportsNativeWebSearch === true,
	})
	const globalSkillsToggles = settings.globalSkillsToggles ?? {}
	const localSkillsToggles = workspaceConfiguration.localSkillsToggles ?? {}
	const availableSkills = providerSkills.filter((skill) => {
		if (settings.yoloModeToggled && skill.interactiveOnly) return false
		if (skill.source === "builtin") return true
		const toggles = skill.source === "global" ? globalSkillsToggles : localSkillsToggles
		return toggles[skill.path] !== false
	})
	ctx.taskState.availableSkills = availableSkills

	const openTabPaths = (await HostProvider.window.getOpenTabs({})).paths || []
	const visibleTabPaths = (await HostProvider.window.getVisibleTabs({})).paths || []
	const cap = 50
	const editorTabs = {
		open: openTabPaths.slice(0, cap),
		visible: visibleTabPaths.slice(0, cap),
	}
	const shellInfo = detectBestShell()
	const taskHandoffCondensationAvailable = isUtilityTextCondensationAvailable(
		{
			utilityModelEnabled: settings.utilityModelEnabled,
			utilityModelUseCondense: settings.utilityModelUseCondense,
			utilityModelUseNewTask: settings.utilityModelUseNewTask,
			utilityModelSelection: settings.utilityModelSelection,
		},
		TASK_HANDOFF_TEMPLATE_ID,
		createDefaultTextCondensationTemplateRegistry(),
	)

	const promptContext: SystemPromptContext = {
		executionProfile: ctx.executionProfile,
		profileInstructions: taskProfileSystemInstructions(ctx.executionProfile),
		cwd: ctx.cwd,
		ide,
		providerInfo,
		editorTabs,
		supportsBrowserUse,
		taskHandoffCondensationAvailable,
		utilityModelConfigured: getConfiguredUtilityModelSelection(settings.utilityModelSelection) !== undefined,
		skills: availableSkills,
		globalDiracRulesFileInstructions,
		localDiracRulesFileInstructions,
		localCursorRulesFileInstructions,
		localCursorRulesDirInstructions,
		localWindsurfRulesFileInstructions,
		localAgentsRulesFileInstructions,
		diracIgnoreInstructions,
		preferredLanguageInstructions,
		browserSettings,
		yoloModeToggled: settings.yoloModeToggled,
		lowVerbosityEnabled: settings.lowVerbosityEnabled,
		subagentsEnabled: settings.subagentsEnabled,
		diracWebToolsEnabled: settings.diracWebToolsEnabled && featureFlagsService.getWebtoolsEnabled(),
		isMultiRootEnabled: multiRootEnabled,
		workspaceRoots,
		isSubagentRun: false,
		isCliEnvironment,
		terminalExecutionMode: ctx.terminalExecutionMode,
		activeShellType: shellInfo.type,
		activeShellPath: shellInfo.path,
		activeShellIsPosix: shellInfo.isPosix,
		availableCores: getAvailableCores(),
		shouldCompact: params.shouldCompact,
	}

	const activatedConditionalRules = [...globalRules.activatedConditionalRules, ...localRules.activatedConditionalRules]
	if (activatedConditionalRules.length > 0) {
		await ctx.taskMessenger.upsertText(JSON.stringify({ rules: activatedConditionalRules }))
	}

	const ruleLoadErrors = [...(globalRules.errors ?? []), ...(localRules.errors ?? [])]
	if (ruleLoadErrors.length > 0) {
		await ctx.taskMessenger.upsertText(JSON.stringify({ ruleLoadErrors }))
	}

	const toolSnapshot = await ctx.toolExecutor.getSnapshotForRequest(promptContext, requestRuntime)
	const { systemPrompt: baseSystemPrompt } = await getSystemPrompt(promptContext, toolSnapshot)
	const pinnedContext = await ctx.getPinnedContext()
	const systemPrompt =
		ctx.executionProfile === "standalone" || !pinnedContext
			? baseSystemPrompt
			: `${baseSystemPrompt}\n\n${pinnedContext}`
	const boundRequestRuntime = bindToolSnapshotToRequestRuntime(requestRuntime, toolSnapshot)
	ctx.toolExecutor.activateSnapshot(toolSnapshot, boundRequestRuntime)
	ctx.taskState.useNativeToolCalls = toolSnapshot.nativeTools.length > 0
	const contextManagementMetadata = await ctx.contextManager.getNewContextMessagesAndMetadata(
		ctx.messageStateHandler.getApiConversationHistory(),
		ctx.messageStateHandler.getDiracMessages(),
		requestRuntime.api,
		ctx.taskState.conversationHistoryDeletedRange,
		params.previousApiReqIndex,
		await ensureTaskDirectoryExists(ctx.taskId),
		settings.useAutoCondense,
	)

	if (contextManagementMetadata.updatedConversationHistoryDeletedRange) {
		const previousConversationHistoryDeletedRange = ctx.taskState.conversationHistoryDeletedRange
		const conversationHistoryDeletedRange = contextManagementMetadata.conversationHistoryDeletedRange
		if (!conversationHistoryDeletedRange) {
			throw new Error("Context management reported a truncation update without a deleted range.")
		}
		ctx.taskState.conversationHistoryDeletedRange = conversationHistoryDeletedRange
		await ctx.apiConversationManager.scheduleProviderConversationCompaction(
			previousConversationHistoryDeletedRange,
			conversationHistoryDeletedRange,
		)
		await ctx.messageStateHandler.saveDiracMessagesAndUpdateHistory()
	}

	const useAutoCondense = settings.useAutoCondense
	if (!useAutoCondense) {
		const lastMessage =
			contextManagementMetadata.truncatedConversationHistory[
			contextManagementMetadata.truncatedConversationHistory.length - 1
			]
		if (lastMessage && lastMessage.role === "user") {
			const notice = formatResponse.contextTruncationNotice()
			if (typeof lastMessage.content === "string") {
				lastMessage.content += `\n\n${notice}`
			} else if (Array.isArray(lastMessage.content)) {
				lastMessage.content.push({
					type: "text",
					text: notice,
				})
			}
		}
	}

	await ctx.writePromptMetadataArtifacts({
		systemPrompt,
		providerInfo,
		tools: toolSnapshot.nativeTools,
		fullHistory: ctx.messageStateHandler.getApiConversationHistory(),
		deletedRange: ctx.taskState.conversationHistoryDeletedRange,
	})
	return { systemPrompt, toolSnapshot, contextManagementMetadata, providerInfo }
}
```

### /Users/highlands/pools/Development/dirac/src/core/permissions/CommandPermissionController.ts (lines 29-319)
```
export class CommandPermissionController {
	private workspaceRoot: string | null = null
	private fileWatcher?: FSWatcher
	private readonly watcherCloser = new ChokidarWatcherCloser()
	private config: CommandPermissionConfig | null = null
	private readonly ruleEvaluator = new PermissionRuleEvaluator()
	private readonly commandParser = new CommandParser()
	private readonly dangerousCharDetector = new DangerousCharDetector()

	constructor(private watcherFactory: WatcherFactory = chokidar.watch) {
		this.config = this.parseConfigFromEnv()
	}

	/** Initialize the controller with a workspace root and load configuration from file. */
	async initialize(workspaceRoot: string): Promise<void> {
		this.workspaceRoot = workspaceRoot
		await this.loadConfig()
		await this.setupFileWatcher()
	}

	/** Set up a file watcher for .dirac/permissions.json */
	private async setupFileWatcher(): Promise<void> {
		await this.watcherCloser.closeAll()
		if (this.fileWatcher) {
			const previousWatcher = this.fileWatcher
			this.fileWatcher = undefined
			await this.watcherCloser.close(previousWatcher)
		}
		if (!this.workspaceRoot) return

		const configPath = path.join(this.workspaceRoot, ".dirac", "permissions.json")
		try {
			const watcher = this.watcherFactory(configPath, {
				persistent: true,
				ignoreInitial: true,
				awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 100 },
				atomic: true,
			})
			this.fileWatcher = watcher
			watcher.on("error", (error) => {
				if (this.fileWatcher !== watcher) return
				this.fileWatcher = undefined
				Logger.error("Command permissions live reload is disabled after watcher failure:", error)
				void this.watcherCloser
					.close(watcher)
					.catch((closeError) => Logger.error("Failed to close disabled command permissions watcher:", closeError))
			})
			watcher.on("all", (_event) => {
				if (this.fileWatcher !== watcher) return
				void this.loadConfig().catch((error) => {
					Logger.error("Failed to reload command permissions:", error)
				})
			})
		} catch (error) {
			this.fileWatcher = undefined
			Logger.error("Command permissions live reload could not start and is disabled:", error)
		}
	}

	/** Load configuration from environment and file. */
	private async loadConfig(): Promise<void> {
		const envConfig = this.parseConfigFromEnv()
		const fileConfig = await this.loadConfigFromFile()

		this.config = {
			...envConfig,
			...fileConfig,
			rules: [...(envConfig?.rules || []), ...(fileConfig?.rules || [])],
		}
	}

	/** Load configuration from .dirac/permissions.json */
	private async loadConfigFromFile(): Promise<CommandPermissionConfig | null> {
		if (!this.workspaceRoot) return null

		const configPath = path.join(this.workspaceRoot, ".dirac", "permissions.json")
		if (!(await fileExistsAtPath(configPath))) return null

		try {
			const content = await fs.readFile(configPath, "utf8")
			return JSON.parse(content) as CommandPermissionConfig
		} catch (_error) {
			return null
		}
	}

	/** Add a new permission rule and save to file. */
	async addRule(rule: ToolPermissionRule): Promise<void> {
		const currentConfig = (await this.loadConfigFromFile()) || { rules: [] }
		const rules = currentConfig.rules || []

		// Check if rule already exists to avoid duplicates
		const exists = rules.some((r) => r.tool === rule.tool && r.pattern === rule.pattern && r.action === rule.action)

		if (!exists) {
			rules.push(rule)
			await this.saveConfig({ ...currentConfig, rules })
		}
	}

	/** List project-scoped rules persisted in .dirac/permissions.json. */
	async listRules(): Promise<ToolPermissionRule[]> {
		const config = await this.loadConfigFromFile()
		return config?.rules || []
	}

	/** Delete one project-scoped rule by its exact persisted value. */
	async deleteRule(rule: ToolPermissionRule): Promise<void> {
		const currentConfig = await this.loadConfigFromFile()
		if (!currentConfig?.rules) {
			return
		}

		const rules = currentConfig.rules.filter(
			(candidate) => candidate.tool !== rule.tool || candidate.pattern !== rule.pattern || candidate.action !== rule.action,
		)
		if (rules.length === currentConfig.rules.length) {
			return
		}

		await this.saveConfig({ ...currentConfig, rules })
	}

	async saveConfig(config: CommandPermissionConfig): Promise<void> {
		if (!this.workspaceRoot) {
			throw new Error("Workspace root not set. Cannot save permissions.")
		}

		const diracDir = path.join(this.workspaceRoot, ".dirac")
		const configPath = path.join(diracDir, "permissions.json")

		await fs.mkdir(diracDir, { recursive: true })
		await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8")

		// Update in-memory config. loadConfig() will be called by file watcher,
		// but we update it here for immediate effect.
		const envConfig = this.parseConfigFromEnv()
		this.config = {
			...envConfig,
			...config,
			rules: [...(envConfig?.rules || []), ...(config.rules || [])],
		}
	}

	private isConfigEmpty(): boolean {
		if (!this.config) return true
		return !(this.config.rules?.length || this.config.allow?.length || this.config.deny?.length)
	}

	/** Parse the DIRAC_COMMAND_PERMISSIONS environment variable. */
	private parseConfigFromEnv(): CommandPermissionConfig | null {
		const envValue = commandPermissionsEnv()
		if (!envValue) return null

		try {
			const parsed = JSON.parse(envValue)
			return {
				allow: Array.isArray(parsed.allow) ? parsed.allow : undefined,
				deny: Array.isArray(parsed.deny) ? parsed.deny : undefined,
				allowRedirects: typeof parsed.allowRedirects === "boolean" ? parsed.allowRedirects : undefined,
			}
		} catch (error) {
			Logger.error(`Failed to parse ${COMMAND_PERMISSIONS_ENV_VAR}:`, error)
			return null
		}
	}

	validateTool(tool: string, pattern?: string): PermissionValidationResult {
		if (this.isConfigEmpty()) {
			return { allowed: true, reason: "no_config" }
		}

		// Check general rules first (deny takes precedence, then allow)
		if (this.config?.rules) {
			const denyResult = this.matchToolRule(tool, pattern, "deny")
			if (denyResult) return denyResult

			const allowResult = this.matchToolRule(tool, pattern, "allow")
			if (allowResult) return allowResult
		}

		// Fallback to legacy command validation if it's execute_command
		if (tool === "execute_command" && pattern) {
			return this.validateCommand(pattern)
		}

		return { allowed: true, reason: "no_config" }
	}

	/** Match a tool against rules of a specific action (deny or allow). Returns null if no match. */
	private matchToolRule(
		tool: string,
		pattern: string | undefined,
		action: "allow" | "deny",
	): PermissionValidationResult | null {
		if (!this.config?.rules) return null

		for (const rule of this.config.rules) {
			if (rule.action !== action || !this.ruleEvaluator.matchesRule(rule, tool, pattern)) continue

			if (action === "deny") {
				return { allowed: false, reason: "denied", matchedPattern: rule.pattern }
			}

			// Allow rule matched - for execute_command, still run full validation (dangerous chars, redirects)
			if (tool === "execute_command" && pattern) {
				// Explicit allow means we bypass dangerous char checks (user trusted this pattern)
				const validationResult = this.validateCommand(pattern, true)
				if (validationResult.allowed) {
					return { ...validationResult, matchedPattern: rule.pattern }
				}
				return validationResult
			}
			return { allowed: true, reason: "allowed", matchedPattern: rule.pattern }
		}

		return null
	}

	/**
	 * Validate a command against allow/deny rules.
	 * @param allowDangerous - If true, bypasses checks for dangerous characters (newlines, backticks).
	 *                        Use this only when the command has already matched an explicit allow rule.
	 */
	validateCommand(command: string, allowDangerous = false): PermissionValidationResult {
		// No config = allow everything (backward compatibility)
		if (this.isConfigEmpty()) {
			return { allowed: true, reason: "no_config" }
		}

		// Check for dangerous characters first (backticks in double quotes, newlines outside quotes)
		if (!allowDangerous) {
			const dangerousChar = this.dangerousCharDetector.detect(command)
			if (dangerousChar) {
				return { allowed: false, reason: "shell_operator_detected", detectedOperator: dangerousChar.operator }
			}
		}

		// Parse the command into segments recursively
		const parseResult = this.commandParser.parseCommandSegments(command)
		if (!parseResult) {
			// Parsing failed - be conservative and block
			return { allowed: false, reason: "shell_operator_detected", detectedOperator: "parse_error" }
		}

		return this.validateParsedCommand(parseResult)
	}

	/** Recursively validate a parsed command structure. */
	private validateParsedCommand(parsed: ParsedCommand): PermissionValidationResult {
		// Check if redirects are allowed
		if (parsed.hasRedirects && !this.config?.allowRedirects) {
			return { allowed: false, reason: "redirect_detected" }
		}

		// Validate each command segment
		const isMultiSegment = parsed.segments.length > 1 || parsed.subshells.length > 0
		for (const segment of parsed.segments) {
			const result = this.ruleEvaluator.validateSingleCommand(segment, this.config!)
			if (!result.allowed) {
				return isMultiSegment ? this.toSegmentResult(result, segment) : result
			}
		}

		// Recursively validate subshell contents
		for (const subshell of parsed.subshells) {
			const result = this.validateParsedCommand(subshell)
			if (!result.allowed) return result
		}

		return { allowed: true, reason: "allowed" }
	}

	/** Convert a validation result to a segment-specific result for multi-segment commands. */
	private toSegmentResult(result: PermissionValidationResult, segment: string): PermissionValidationResult {
		const segmentReason =
			result.reason === "denied"
				? "segment_denied"
				: result.reason === "no_match_deny_default"
					? "segment_no_match"
					: result.reason
		return { ...result, failedSegment: segment, reason: segmentReason }
	}

	/** Clean up resources when the controller is no longer needed. */
	async dispose(): Promise<void> {
		const watcher = this.fileWatcher
		this.fileWatcher = undefined
		await this.watcherCloser.closeAll(watcher ? [watcher] : [])
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/tools/subagent/AgentConfigLoader.ts (lines 233-472)
```
export class AgentConfigLoader {
	private static instance?: AgentConfigLoader

	private readonly homeDir: string
	private readonly directoryPath: string
	private readonly initialLoadPromise: Promise<void>
	private watcher?: FSWatcher
	private readonly watcherCloser = new ChokidarWatcherCloser()
	private disposed = false
	private cachedConfigs = new Map<string, AgentBaseConfig>()
	private cachedAgentToolNames = new Map<string, string>()
	private cachedToolNameToAgentName = new Map<string, string>()
	private listeners = new Set<AgentConfigChangeListener>()

	private constructor(homeDir = os.homedir()) {
		this.homeDir = homeDir
		this.directoryPath = getAgentsConfigPath(homeDir)
		this.initialLoadPromise = this.load()
			.then(() => undefined)
			.catch((error) => {
				Logger.error("[AgentConfigLoader] Failed to load initial agent configs", error)
			})
			.finally(() =>
				this.watch().catch((error) => Logger.error("[AgentConfigLoader] Failed to start watching agent configs", error)),
			)
	}

	public static getInstance(homeDir = os.homedir()): AgentConfigLoader {
		if (!AgentConfigLoader.instance) {
			AgentConfigLoader.instance = new AgentConfigLoader(homeDir)
		}
		return AgentConfigLoader.instance
	}

	/**
	 * Test-only helper to clear singleton state between unit tests.
	 */
	public static async resetInstanceForTests(): Promise<void> {
		if (!AgentConfigLoader.instance) {
			return
		}

		await AgentConfigLoader.instance.dispose()
		AgentConfigLoader.instance = undefined
	}

	public getConfigPath(): string {
		return this.directoryPath
	}

	public async ready(): Promise<void> {
		await this.initialLoadPromise
	}

	public getCachedConfig(subagentName?: string): AgentBaseConfig | undefined {
		if (!subagentName?.trim()) {
			return undefined
		}
		return this.cachedConfigs.get(normalizeAgentName(subagentName))
	}

	public getAllCachedConfigs(): ReadonlyMap<string, AgentBaseConfig> {
		return new Map(this.cachedConfigs)
	}

	public getAllCachedConfigsWithToolNames(): Array<{ toolName: string; config: AgentBaseConfig }> {
		const result: Array<{ toolName: string; config: AgentBaseConfig }> = []
		for (const [normalizedName, config] of this.cachedConfigs.entries()) {
			const toolName = this.cachedAgentToolNames.get(normalizedName)
			if (toolName) {
				result.push({ toolName, config })
			}
		}
		return result
	}

	public resolveSubagentNameForTool(toolName?: string): string | undefined {
		if (!toolName?.trim()) {
			return undefined
		}

		const normalizedName = this.cachedToolNameToAgentName.get(toolName.trim())
		if (!normalizedName) {
			return undefined
		}

		return this.cachedConfigs.get(normalizedName)?.name
	}

	public isDynamicSubagentTool(toolName?: string): boolean {
		if (!toolName?.trim()) {
			return false
		}
		return this.cachedToolNameToAgentName.has(toolName.trim())
	}

	public async load(): Promise<ReadonlyMap<string, AgentBaseConfig>> {
		const configs = await readAgentConfigsFromDisk(this.homeDir)
		this.cachedConfigs = configs
		this.rebuildDynamicToolMappings()
		Logger.debug(`[AgentConfigLoader] Loaded ${configs.size} agent config(s) from disk.`)
		return this.getAllCachedConfigs()
	}

	public async watch(listener?: AgentConfigChangeListener): Promise<void> {
		await this.watcherCloser.closeAll()
		if (this.disposed) return
		if (listener) {
			this.listeners.add(listener)
		}

		if (this.watcher) {
			return
		}

		try {
			await fs.mkdir(this.directoryPath, { recursive: true })
			const watcher = chokidar.watch(this.directoryPath, {
				persistent: true,
				ignoreInitial: true,
				awaitWriteFinish: {
					stabilityThreshold: 300,
					pollInterval: 100,
				},
			})
			this.watcher = watcher
			watcher
				.on("error", (error) => {
					if (this.watcher !== watcher) return
					this.watcher = undefined
					const watcherError = toError(error)
					const isPerm = (watcherError as any).code === "EPERM" || (watcherError as any).code === "EACCES"
					if (isPerm) {
						Logger.warn(
							`[AgentConfigLoader] Agent config live reload is disabled due to missing filesystem permissions on '${this.directoryPath}'`,
						)
					} else {
						Logger.error(
							"[AgentConfigLoader] Agent config live reload is disabled after watcher failure",
							watcherError,
						)
					}
					this.notify(this.cachedConfigs, watcherError)
					void this.watcherCloser
						.close(watcher)
						.catch((closeError) =>
							Logger.warn("[AgentConfigLoader] Failed to close disabled agent config watcher", closeError),
						)
				})
				.on("add", (filePath) => {
					if (this.watcher !== watcher) return
					if (isYamlFile(filePath)) {
						void this.reloadAndNotify()
					}
				})
				.on("change", (filePath) => {
					if (this.watcher !== watcher) return
					if (isYamlFile(filePath)) {
						void this.reloadAndNotify()
					}
				})
				.on("unlink", (filePath) => {
					if (this.watcher !== watcher) return
					if (isYamlFile(filePath)) {
						void this.reloadAndNotify()
					}
				})
		} catch (error) {
			this.watcher = undefined
			const watcherError = toError(error)
			const isPerm = (watcherError as any).code === "EPERM" || (watcherError as any).code === "EACCES"
			if (isPerm) {
				Logger.warn(
					`[AgentConfigLoader] Agent config live reload could not start due to missing filesystem permissions on '${this.directoryPath}'`,
				)
			} else {
				Logger.error("[AgentConfigLoader] Agent config live reload could not start and is disabled", watcherError)
			}
			this.notify(this.cachedConfigs, watcherError)
		}
	}

	public unwatch(listener: AgentConfigChangeListener): void {
		this.listeners.delete(listener)
	}

	public async dispose(): Promise<void> {
		this.disposed = true
		const watcher = this.watcher
		this.watcher = undefined
		await this.watcherCloser.closeAll(watcher ? [watcher] : [])
	}

	private async reloadAndNotify(): Promise<void> {
		try {
			await this.load()
			this.notify(this.cachedConfigs)
		} catch (error) {
			const parseError = toError(error)
			Logger.error("[AgentConfigLoader] Failed to reload agent configs", parseError)
			this.notify(this.cachedConfigs, parseError)
		}
	}

	private notify(configs: ReadonlyMap<string, AgentBaseConfig>, error?: Error): void {
		for (const listener of this.listeners) {
			try {
				listener(new Map(configs), error)
			} catch (listenerError) {
				Logger.error("[AgentConfigLoader] Agent config listener failed", listenerError)
			}
		}
	}

	private rebuildDynamicToolMappings(): void {
		const sortedConfigs = Array.from(this.cachedConfigs.entries()).sort((a, b) => a[0].localeCompare(b[0]))
		const usedToolNames = new Set<string>()
		const agentToolNames = new Map<string, string>()
		const toolNameToAgentName = new Map<string, string>()

		for (const [normalizedName, config] of sortedConfigs) {
			const baseName = buildSubagentToolName(config.name)
			let candidate = baseName
			let suffix = 2
			while (usedToolNames.has(candidate)) {
				const suffixText = `_${suffix++}`
				const maxBaseLength = Math.max(1, 64 - suffixText.length)
				candidate = `${baseName.slice(0, maxBaseLength)}${suffixText}`
			}

			usedToolNames.add(candidate)
			agentToolNames.set(normalizedName, candidate)
			toolNameToAgentName.set(candidate, normalizedName)
		}

		this.cachedAgentToolNames = agentToolNames
		this.cachedToolNameToAgentName = toolNameToAgentName
		setDynamicToolUseNames(SUBAGENT_DYNAMIC_TOOL_NAMESPACE, Array.from(toolNameToAgentName.keys()))
	}
}
```


## Source Files:

- `src/core/assistant-message/index.ts`
- `src/core/assistant-message/parse-assistant-message.ts`
- `src/core/commands/reconstructTaskHistory.ts`
- `src/core/goal/GoalAccounting.ts`
- `src/core/goal/GoalCoordinatorEnvironment.ts`
- `src/core/goal/GoalHistory.ts`
- `src/core/goal/GoalLifecycle.ts`
- `src/core/goal/GoalStore.ts`
- `src/core/goal/GoalTaskEnvironment.ts`
- `src/core/goal/GoalTaskFactory.ts`
- `src/core/goal/validateGoalRecord.ts`
- `src/core/hooks/HookError.ts`
- `src/core/hooks/HookLaunchConfig.ts`
- `src/core/hooks/HookOutputParser.ts`
- `src/core/hooks/HookProcess.ts`
- `src/core/hooks/HookProcessRegistry.ts`
- `src/core/hooks/HookRegistry.ts`
- `src/core/hooks/HookResponseParser.ts`
- `src/core/hooks/HookTelemetryRecorder.ts`
- `src/core/hooks/PreToolUseHookCancellationError.ts`
- `src/core/hooks/hook-executor.ts`
- `src/core/hooks/hook-model-context.ts`
- `src/core/hooks/hooks-utils.ts`
- `src/core/hooks/precompact-executor.ts`
- `src/core/hooks/shell-escape.ts`
- `src/core/hooks/templates.ts`
- `src/core/permissions/CommandParser.ts`
- `src/core/permissions/CommandPermissionController.ts`
- `src/core/permissions/DangerousCharDetector.ts`
- `src/core/permissions/PermissionRuleEvaluator.ts`
- `src/core/permissions/UtilityPermissionDecisionService.ts`
- `src/core/permissions/types.ts`
- `src/core/task/AssistantStreamManager.ts`
- `src/core/task/ContextLoader.ts`
- `src/core/task/HookManager.ts`
- `src/core/task/ITaskContext.ts`
- `src/core/task/LocalConversationCompaction.ts`
- `src/core/task/ResponseProcessor.ts`
- `src/core/task/StreamChunkCoordinator.ts`
- `src/core/task/StreamResponseHandler.ts`
- `src/core/task/StreamingMetricsManager.ts`
- `src/core/task/TaskApiRequestAttempt.ts`
- `src/core/task/TaskConversationPersistence.ts`
- `src/core/task/TaskExecutionProfile.ts`
- `src/core/task/TaskLockUtils.ts`
- `src/core/task/TaskMistakeLimit.ts`
- `src/core/task/TaskPromptArtifacts.ts`
- `src/core/task/TaskRequestBuilder.ts`
- `src/core/task/TaskRequestOutcome.ts`
- `src/core/task/TaskRunOutcome.ts`
- `src/core/task/TaskState.ts`
- `src/core/task/TaskSteering.ts`
- `src/core/task/TaskUserInput.ts`
- `src/core/task/activateTaskSkill.ts`
- `src/core/task/context/FileContextLoader.ts`
- `src/core/task/lifecycle/TaskAbortManager.ts`
- `src/core/task/recordUtilityModelUsage.ts`
- `src/core/task/response/EmptyResponseHandler.ts`
- `src/core/task/response/ResponseFormatter.ts`
- `src/core/task/response/StreamStateSync.ts`
- `src/core/task/response/ToolCallExtractor.ts`
- `src/core/task/runtime/TaskRequestRuntime.ts`
- `src/core/task/runtime/TaskRuntimeModelContext.ts`
- `src/core/task/runtime/TaskWorkingConfiguration.ts`
- `src/core/task/steering.ts`
- `src/core/task/stream/ReasoningHandler.ts`
- `src/core/task/stream/ToolUseHandler.ts`
- `src/core/task/stream/types.ts`
- `src/core/task/tools/ToolExecutorCoordinator.ts`
- `src/core/task/tools/adapters/ApprovedPermissionCardHandle.ts`
- `src/core/task/tools/adapters/CardHandle.ts`
- `src/core/task/tools/adapters/DelegatingCardHandle.ts`
- `src/core/task/tools/adapters/SurfaceAdapter.ts`
- `src/core/task/tools/adapters/traits/ConversationCondensationTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/DiagnosticsTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/EditorTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/LoggingTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/SkillsTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/SourceAstTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/SubagentUsagePublisher.ts`
- `src/core/task/tools/adapters/traits/SystemTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/TelemetryTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/UiTraitBuilder.ts`
- `src/core/task/tools/discovery/DiscoveredTool.ts`
- `src/core/task/tools/discovery/UserToolLoader.ts`
- `src/core/task/tools/goal/GoalTaskActionCard.ts`
- `src/core/task/tools/goal/GoalToolInput.ts`
- `src/core/task/tools/interfaces/IDiracContext.ts`
- `src/core/task/tools/interfaces/IDiracTool.ts`
- `src/core/task/tools/interfaces/ToolEnvironmentFactory.ts`
- `src/core/task/tools/interfaces/ValidationResult.ts`
- `src/core/task/tools/modules/block_goal/BlockGoalTool.ts`
- `src/core/task/tools/modules/block_goal/tool.ts`
- `src/core/task/tools/modules/cancel_task/CancelTaskTool.ts`
- `src/core/task/tools/modules/cancel_task/tool.ts`
- `src/core/task/tools/modules/condense/CondenseTool.ts`
- `src/core/task/tools/modules/condense/tool.ts`
- `src/core/task/tools/modules/diagnostics_scan/index.ts`
- `src/core/task/tools/modules/diagnostics_scan/tool.ts`
- `src/core/task/tools/modules/edit_ast/AstEditApplier.ts`
- `src/core/task/tools/modules/edit_ast/AstEditApproval.ts`
- `src/core/task/tools/modules/edit_ast/AstEditFormatter.ts`
- `src/core/task/tools/modules/edit_ast/EditAstTool.ts`
- `src/core/task/tools/modules/edit_ast/EditAstValidator.ts`
- `src/core/task/tools/modules/edit_ast/tool.ts`
- `src/core/task/tools/modules/edit_file/EditFileApplier.ts`
- `src/core/task/tools/modules/edit_file/EditFileApprovalFlow.ts`
- `src/core/task/tools/modules/edit_file/EditFileBatchPreparer.ts`
- `src/core/task/tools/modules/edit_file/EditFileFormatter.ts`
- `src/core/task/tools/modules/edit_file/EditFileTool.ts`
- `src/core/task/tools/modules/edit_file/EditFileValidator.ts`
- `src/core/task/tools/modules/edit_file/tool.ts`
- `src/core/task/tools/modules/edit_file/types.ts`
- `src/core/task/tools/modules/edit_file/utils/EditExecutor.ts`
- `src/core/task/tools/modules/edit_file/utils/EditFormatter.ts`
- `src/core/task/tools/modules/execute_command/path-display.ts`
- `src/core/task/tools/modules/execute_command/tool.ts`
- `src/core/task/tools/modules/inspect_ast/InspectAstFormatter.ts`
- `src/core/task/tools/modules/inspect_ast/InspectAstResultReducer.ts`
- `src/core/task/tools/modules/inspect_ast/InspectAstTool.ts`
- `src/core/task/tools/modules/inspect_ast/InspectAstValidator.ts`
- `src/core/task/tools/modules/inspect_ast/tool.ts`
- `src/core/task/tools/modules/list_files/index.ts`
- `src/core/task/tools/modules/list_files/tool.ts`
- `src/core/task/tools/modules/list_skills/ListSkillsTool.ts`
- `src/core/task/tools/modules/list_skills/tool.ts`
- `src/core/task/tools/modules/list_tasks/ListTasksTool.ts`
- `src/core/task/tools/modules/list_tasks/tool.ts`
- `src/core/task/tools/modules/new_task/NewTaskTool.ts`
- `src/core/task/tools/modules/new_task/tool.ts`
- `src/core/task/tools/modules/read_file/ReadFileTool.ts`
- `src/core/task/tools/modules/read_file/tool.ts`
- `src/core/task/tools/modules/read_task_transcript/ReadTaskTranscriptTool.ts`
- `src/core/task/tools/modules/read_task_transcript/tool.ts`
- `src/core/task/tools/modules/resolve_task_interaction/ResolveTaskInteractionTool.ts`
- `src/core/task/tools/modules/resolve_task_interaction/tool.ts`
- `src/core/task/tools/modules/respond/CompletionResponseOperation.ts`
- `src/core/task/tools/modules/respond/CompletionVerificationContext.ts`
- `src/core/task/tools/modules/respond/PlanResponseOperation.ts`
- `src/core/task/tools/modules/respond/ProgressResponseOperation.ts`
- `src/core/task/tools/modules/respond/QuestionResponseOperation.ts`
- `src/core/task/tools/modules/respond/RespondTool.ts`
- `src/core/task/tools/modules/respond/ResponseArgumentsValidator.ts`
- `src/core/task/tools/modules/respond/tool.ts`
- `src/core/task/tools/modules/search_files/tool.ts`
- `src/core/task/tools/modules/send_task_message/SendTaskMessageTool.ts`
- `src/core/task/tools/modules/send_task_message/tool.ts`
- `src/core/task/tools/modules/start_task/StartTaskTool.ts`
- `src/core/task/tools/modules/start_task/tool.ts`
- `src/core/task/tools/modules/update_goal/UpdateGoalTool.ts`
- `src/core/task/tools/modules/update_goal/tool.ts`
- `src/core/task/tools/modules/upsert_tool/UpsertTool.ts`
- `src/core/task/tools/modules/upsert_tool/builder-validation.ts`
- `src/core/task/tools/modules/upsert_tool/constants.ts`
- `src/core/task/tools/modules/upsert_tool/scaffold-generator.ts`
- `src/core/task/tools/modules/upsert_tool/subagent-builder.ts`
- `src/core/task/tools/modules/upsert_tool/tool-lifecycle.ts`
- `src/core/task/tools/modules/upsert_tool/tool.ts`
- `src/core/task/tools/modules/use_skill/UseSkillTool.ts`
- `src/core/task/tools/modules/use_skill/tool.ts`
- `src/core/task/tools/modules/use_subagents/UseSubagentsTool.ts`
- `src/core/task/tools/modules/use_subagents/tool.ts`
- `src/core/task/tools/modules/verify_goal/VerifyGoalTool.ts`
- `src/core/task/tools/modules/verify_goal/tool.ts`
- `src/core/task/tools/modules/wait_for_goal_events/WaitForGoalEventsTool.ts`
- `src/core/task/tools/modules/wait_for_goal_events/tool.ts`
- `src/core/task/tools/modules/write_to_file/WriteToFileTool.ts`
- `src/core/task/tools/modules/write_to_file/tool.ts`
- `src/core/task/tools/runtime/ToolExecutionDeadline.ts`
- `src/core/task/tools/runtime/ToolHookRunner.ts`
- `src/core/task/tools/runtime/ToolResultPusher.ts`
- `src/core/task/tools/runtime/ToolSelectionPolicy.ts`
- `src/core/task/tools/runtime/ToolSnapshot.ts`
- `src/core/task/tools/runtime/ToolTimeoutPresentation.ts`
- `src/core/task/tools/runtime/assertValidToolResponse.ts`
- `src/core/task/tools/runtime/normalizeOptionalToolParameters.ts`
- `src/core/task/tools/subagent/AgentConfigLoader.ts`
- `src/core/task/tools/subagent/LatestPresentationQueue.ts`
- `src/core/task/tools/subagent/PresentationDeadline.ts`
- `src/core/task/tools/subagent/SubagentAbortHandler.ts`
- `src/core/task/tools/subagent/SubagentBuilder.ts`
- `src/core/task/tools/subagent/SubagentExecutionPolicy.ts`
- `src/core/task/tools/subagent/SubagentRunHelpers.ts`
- `src/core/task/tools/subagent/SubagentRunProgress.ts`
- `src/core/task/tools/subagent/SubagentRunRecorder.ts`
- `src/core/task/tools/subagent/SubagentRunState.ts`
- `src/core/task/tools/subagent/SubagentRunTypes.ts`
- `src/core/task/tools/subagent/SubagentToolExecutor.ts`
- `src/core/task/tools/subagent/SubagentToolName.ts`
- `src/core/task/tools/types/ToolSkippedByUserMessage.ts`
- `src/core/task/tools/types/UIHelpers.ts`
- `src/core/task/tools/utils/AiOutputTelemetry.ts`
- `src/core/task/tools/utils/CommandSafetyChecker.ts`
- `src/core/task/tools/utils/CommandTimeoutUtils.ts`
- `src/core/task/tools/utils/DiagnosticFormatter.ts`
- `src/core/task/tools/utils/FileProviderOperations.ts`
- `src/core/task/tools/utils/ModelContentProcessor.ts`
- `src/core/task/tools/utils/PatchParser.ts`
- `src/core/task/tools/utils/PathResolver.ts`
- `src/core/task/tools/utils/ToolConstants.ts`
- `src/core/task/tools/utils/ToolDisplayUtils.ts`
- `src/core/task/tools/utils/ToolHookUtils.ts`
- `src/core/task/tools/utils/ToolResponseCombiner.ts`
- `src/core/task/tools/utils/UserApprovedCommandMatcher.ts`
- `src/core/task/tools/utils/index.ts`
- `src/core/task/tools/utils/lineDiffStats.ts`
- `src/core/task/types/HookExecution.ts`
- `src/core/task/types/api-conversation-manager.ts`
- `src/core/task/types/context-loader.ts`
- `src/core/task/types/hook-manager.ts`
- `src/core/task/types/lifecycle-manager.ts`
- `src/core/task/types/response-processor.ts`
- `src/core/task/types/task-messenger.ts`
- `src/core/task/utils/buildUserFeedbackContent.ts`
- `src/core/task/utils/excerpt.ts`
- `src/core/task/utils/extractUserPromptFromContent.ts`
- `src/core/task/utils/symbol-block.ts`
- `src/core/task/utils/ui-projector.ts`
- `src/core/text-condensation/ConversationCondensationService.ts`
- `src/core/text-condensation/ConversationTextSerializer.ts`
- `src/core/text-condensation/CurrentTurnUserRequests.ts`
- `src/core/text-condensation/TextCondensationTemplateRegistry.ts`
- `src/core/text-condensation/TextCondenser.ts`
- `src/core/text-condensation/UtilityModelTextCondenser.ts`
- `src/core/text-condensation/UtilityTextCondensationAvailability.ts`
- `src/core/text-condensation/templates/index.ts`
- `src/core/text-condensation/templates/taskHandoffTemplate.ts`

