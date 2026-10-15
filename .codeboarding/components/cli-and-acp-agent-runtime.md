---
component_id: 2
component_name: CLI & ACP Agent Runtime
---

# CLI & ACP Agent Runtime

## Component Description

Provides the terminal-based CLI interface, Agent Client Protocol (ACP) runtime, DiracAgent session management, and Unbiased provider integration.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/agent/DiracAgent.ts (lines 176-2384)
```
export class DiracAgent implements acp.Agent {
	async shutdown() {
		try {
			for (const sessionId of [...this.sessions.keys()]) {
				await this.releaseSessionResources(sessionId, true)
			}
		} finally {
			this.authentication.shutdown()
			DiracTempManager.stopPeriodicCleanup()
		}
	}

	/** Release active session resources while retaining all persisted history. */
	private async releaseSessionResources(sessionId: string, force = false): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			return
		}

		if (!force && this.configuringSessions.has(sessionId)) {
			throw new Error(`Session ${sessionId} is applying a runtime configuration change`)
		}
		if (this.sessionStates.get(sessionId)?.status === AcpSessionStatus.Processing) {
			await this.cancel({ sessionId })
		}

		await this.#sessionControllers.get(session)?.dispose()
		this.sessions.delete(sessionId)
		this.sessionStates.delete(sessionId)
		this.sessionEmitters.delete(sessionId)
		this.acpSessionOverrides.delete(sessionId)
		this.activePromptOverrides.delete(sessionId)
		this.configuringSessions.delete(sessionId)
		this.sessionRuntimeMutationTails.delete(sessionId)
		this.bridges.delete(sessionId)
		this.releasePromptSteeringOwnership(sessionId)
	}

	/** Delete a session's active resources, owned worktree, and persisted task history. */
	private async deleteSessionResources(sessionId: string): Promise<void> {
		await this.releaseSessionResources(sessionId)

		const worktree = getSessionWorktree(sessionId)
		if (worktree) {
			const removal = await deleteWorktree(worktree.sourceCwd, worktree.worktreePath, true)
			if (!removal.success) {
				throw new Error(removal.message)
			}
			deleteSessionWorktree(sessionId)
		}

		const taskIds = getTaskIdsForSession(sessionId)
		const stateManager = StateManager.get()
		await withTaskHistoryInventoryLock(async () => {
			for (const taskId of taskIds) {
				await fs.rm(`${this.ctx.DATA_DIR}/tasks/${taskId}`, {
					recursive: true,
					force: true,
				})
			}
			stateManager.removeTaskHistoryItems(taskIds)
			await stateManager.flushPendingState()
		})
		deleteTasksForSession(sessionId)
		deleteSessionUpdates(sessionId)
		deletePinnedSessionMessages(sessionId)

		deleteSessionRuntimeConfig(this.ctx.DATA_DIR, sessionId)
	}

	/** Create a branch-backed git worktree owned exclusively by one ACP session. */
	private async provisionSessionWorktree(
		sessionId: string,
		cwd: string,
		request: WorktreeProvisioningRequest,
	): Promise<SessionWorktree> {
		const sourceCwd = await getGitRootPath(cwd)
		if (!sourceCwd) {
			throw new Error("dev.dirac/worktree requires cwd to be inside a git repository")
		}

		const git = simpleGit(sourceCwd)
		const checkedOutBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
		const targetBranch = request.baseBranch ?? (checkedOutBranch === "HEAD" ? undefined : checkedOutBranch)
		const branch = `dirac/acp-${sessionId}`
		const worktreeDirectory = path.join(path.dirname(sourceCwd), ".dirac-worktrees")
		const worktreePath = path.join(worktreeDirectory, `${path.basename(sourceCwd)}-${sessionId}`)
		await fs.mkdir(worktreeDirectory, { recursive: true })

		const result = await createWorktree(sourceCwd, worktreePath, {
			branch,
			baseBranch: targetBranch,
			createNewBranch: true,
		})
		if (!result.success || !result.worktree) {
			throw new Error(result.message)
		}

		const worktree = {
			sourceCwd,
			worktreePath: result.worktree.path,
			branch: result.worktree.branch,
			...(targetBranch ? { targetBranch } : {}),
		}
		setSessionWorktree(sessionId, worktree)
		return worktree
	}

	/** Merge a session-owned worktree branch into its requested target branch. */
	async integrateSessionWorktree(
		sessionId: string,
		targetBranch?: string,
		deleteAfterMerge = true,
	): Promise<{
		sourceBranch: string
		targetBranch: string
		worktreePath: string
	}> {
		const worktree = getSessionWorktree(sessionId)
		if (!worktree) {
			throw new Error(`Session ${sessionId} has no Dirac-provisioned worktree`)
		}

		const activeSession = this.sessions.get(sessionId)
		const activeController = activeSession ? this.#sessionControllers.get(activeSession) : undefined
		if (activeController?.task) {
			throw new Error(`Cannot integrate ACP session ${sessionId} while its task is active; close the session first`)
		}

		const branch = targetBranch ?? worktree.targetBranch
		if (!branch) {
			throw new Error("targetBranch is required when the session was created from a detached HEAD")
		}

		const targetGit = simpleGit(worktree.sourceCwd)
		const checkedOutBranch = (await targetGit.revparse(["--abbrev-ref", "HEAD"])).trim()
		if (checkedOutBranch !== branch) {
			throw new Error(`Target branch ${branch} is not checked out at ${worktree.sourceCwd}`)
		}
		if (!(await targetGit.status()).isClean()) {
			throw new Error(`Target branch ${branch} has uncommitted changes`)
		}

		const worktreeGit = simpleGit(worktree.worktreePath)
		if (!(await worktreeGit.status()).isClean()) {
			throw new Error("Session worktree has uncommitted changes; commit or stash them before integrating")
		}

		await targetGit.merge([worktree.branch, "--no-edit"])
		if (deleteAfterMerge) {
			await targetGit.raw(["worktree", "remove", "--force", worktree.worktreePath])
			await targetGit.deleteLocalBranch(worktree.branch)
			deleteSessionWorktree(sessionId)
		}

		return {
			sourceBranch: worktree.branch,
			targetBranch: branch,
			worktreePath: worktree.worktreePath,
		}
	}
	private readonly options: DiracAgentOptions
	private readonly authentication: AcpAuthenticationManager
	private ctx!: CliContextResult

	/** Map of active sessions by session ID */
	public readonly sessions: Map<string, DiracAcpSession> = new Map()

	/** WeakMap to associate DiracAcpSession with its Controller without exposing it to consumers */
	readonly #sessionControllers = new WeakMap<DiracAcpSession, Controller>()

	/** Runtime state for active sessions */
	private readonly sessionStates: Map<string, AcpSessionState> = new Map()

	/** Per-session event emitters for session updates */
	private readonly sessionEmitters: Map<string, DiracSessionEmitter> = new Map()

	/** Permission handler callback for requesting user permission */
	private permissionHandler?: PermissionHandler

	/** Elicitation handler supplied by the ACP transport. */
	private elicitationHandler?: ElicitationHandler

	/** Client capabilities received during initialization */
	private clientCapabilities?: acp.ClientCapabilities

	/** Per-session bridges isolate message, tool-call, and streaming state. */
	private readonly bridges: Map<string, TaskMessageBridge> = new Map()

	/** Whispers received while a processing prompt has not yet bound its target task. */
	private readonly pendingWhispers = new Map<string, string[]>()

	/** The task selected for the active prompt. Undefined means task selection is still in progress. */
	private readonly promptTasks = new Map<string, NonNullable<Controller["task"]>>()

	private unbindPromptTask(sessionId: string): void {
		this.promptTasks.delete(sessionId)
	}

	private releasePromptSteeringOwnership(sessionId: string): void {
		this.pendingWhispers.delete(sessionId)
		this.unbindPromptTask(sessionId)
	}

	private createTaskMessageBridge(): TaskMessageBridge {
		return new TaskMessageBridge({
			getSession: (sessionId: string) => this.sessions.get(sessionId),
			getController: (session: DiracAcpSession) => this.#sessionControllers.get(session),
			requestPermission: (sessionId, toolCall, options) => this.requestPermission(sessionId, toolCall, options),
			emitSessionUpdate: (sessionId, update) => this.emitSessionUpdate(sessionId, update),
			persistPermissionRule: (sessionId, toolCall, action) => this.persistPermissionRule(sessionId, toolCall, action),
			getClientCapabilities: () => this.clientCapabilities,
			requestElicitation: (request) => this.requestElicitation(request),
			emitSteeringStatus: (sessionId, steeringMessageId, status) =>
				this.emitSteeringStatus(sessionId, steeringMessageId, status),
		})
	}

	private bridgeForSession(sessionId: string): TaskMessageBridge {
		let bridge = this.bridges.get(sessionId)
		if (!bridge) {
			bridge = this.createTaskMessageBridge()
			this.bridges.set(sessionId, bridge)
		}
		return bridge
	}

	/** Queue client guidance in the task selected by the active prompt. */
	async queueWhisper(params: Record<string, unknown>): Promise<void> {
		const sessionId = params.sessionId
		const text = params.text
		if (typeof sessionId !== "string" || typeof text !== "string" || !text.trim()) {
			Logger.debug("[DiracAgent] Ignoring malformed dev.dirac/whisper notification")
			return
		}
		if (this.sessionStates.get(sessionId)?.status !== AcpSessionStatus.Processing) {
			Logger.debug("[DiracAgent] Ignoring whisper outside an active turn:", sessionId)
			return
		}

		const task = this.promptTasks.get(sessionId)
		if (!task) {
			this.bufferWhisper(sessionId, text)
			return
		}

		if (!task.canAcceptSteeringMessage()) {
			if (task.taskState.abort || task.taskState.pendingTaskReplacement) {
				this.unbindPromptTask(sessionId)
			}
			this.bufferWhisper(sessionId, text)
			return
		}

		try {
			const steeringMessageId = await task.enqueueSteeringMessage(text)
			this.emitSteeringStatus(sessionId, steeringMessageId, "queued")
		} catch (error) {
			if (task.canAcceptSteeringMessage()) throw error
			this.unbindPromptTask(sessionId)
			this.bufferWhisper(sessionId, text)
		}
	}

	private bufferWhisper(sessionId: string, text: string): void {
		const whispers = this.pendingWhispers.get(sessionId) ?? []
		whispers.push(text.trim())
		this.pendingWhispers.set(sessionId, whispers)
	}

	/** Persist a client control-plane event so a later session/load can replay it. */
	recordClientAnnotation(params: Record<string, unknown>): void {
		const sessionId = params.sessionId
		const annotation = params.annotation
		if (typeof sessionId !== "string" || !annotation || typeof annotation !== "object" || Array.isArray(annotation)) {
			Logger.debug("[DiracAgent] Ignoring malformed dev.dirac/client_annotation notification")
			return
		}

		try {
			recordClientAnnotation(sessionId, annotation as Record<string, unknown>)
		} catch (error) {
			Logger.error("[DiracAgent] ACP journal persistence failed for client annotation:", error)
		}
	}

	/** Pin a persisted message snapshot so it remains in every compacted request context. */
	async pinMessage(sessionId: string, messageId: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error(`Unknown session: ${sessionId}`)
		const controller =
			this.#sessionControllers.get(session) ?? (session as DiracAcpSession & { controller?: Controller }).controller
		const task = controller?.task
		const message = task?.messageStateHandler.getMessageById(messageId)
		if (!message) throw new Error(`Message not found: ${messageId}`)
		const content = this.pinnedContentFromMessage(message)
		if (!content) throw new Error(`Message cannot be pinned: ${messageId}`)
		pinSessionMessage(sessionId, {
			messageId,
			content,
			pinnedAt: new Date().toISOString(),
		})
		this.applyPinnedContext(task, sessionId)
		await this.emitPinnedMessagesUpdate(sessionId, "pinned")
	}

	async unpinMessage(sessionId: string, messageId: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error(`Unknown session: ${sessionId}`)
		if (!unpinSessionMessage(sessionId, messageId)) throw new Error(`Message is not pinned: ${messageId}`)
		this.applyPinnedContext(
			(this.#sessionControllers.get(session) ?? (session as DiracAcpSession & { controller?: Controller }).controller)
				?.task,
			sessionId,
		)
		await this.emitPinnedMessagesUpdate(sessionId, "unpinned")
	}

	listPinnedMessages(sessionId: string): PinnedSessionMessage[] {
		if (!this.sessions.has(sessionId)) throw new Error(`Unknown session: ${sessionId}`)
		return getPinnedSessionMessages(sessionId)
	}
	private pinnedContentFromMessage(message: DiracMessage): string | undefined {
		if (message.content.type === DiracMessageType.MARKDOWN) return message.content.content || undefined
		if (message.content.type === DiracMessageType.CARD) return message.content.card.body || message.content.card.header
		return undefined
	}
	private pinnedContextForSession(sessionId: string): string | undefined {
		const pins = getPinnedSessionMessages(sessionId)
		if (pins.length === 0) return undefined
		return [
			"<pinned_messages>",
			...pins.map((pin) => `<message id="${pin.messageId}">\n${pin.content}\n</message>`),
			"</pinned_messages>",
		].join("\n")
	}

	private pinnedContextInitializationOptions(sessionId: string, runtimeOverrides?: Partial<Settings>) {
		return {
			pinnedContext: this.pinnedContextForSession(sessionId),
			onContextCompacted: () => void this.emitPinnedMessagesUpdate(sessionId, "compacted"),
			switchToActMode: () => this.switchSessionToActMode(sessionId),
			enqueueSteeringMessages: (task: NonNullable<Controller["task"]>) => this.bindPromptTask(sessionId, task),
			...(runtimeOverrides ? { runtimeConfigurationOverrides: copyTaskRuntimeSettings(runtimeOverrides) } : {}),
		}
	}

	private activePromptInitializationOptions(sessionId: string) {
		const activeOverrides = this.activePromptOverrides.get(sessionId)
		if (!activeOverrides) throw new Error(`Active prompt runtime configuration not found: ${sessionId}`)
		return this.pinnedContextInitializationOptions(sessionId, activeOverrides)
	}

	private async bindPromptTask(sessionId: string, task: NonNullable<Controller["task"]>): Promise<void> {
		this.promptTasks.set(sessionId, task)
		const session = this.sessions.get(sessionId)!
		if (session.taskId !== task.taskId) {
			session.taskId = task.taskId
			this.persistSessionOverrides(sessionId)
		}
		if (!task.canAcceptSteeringMessage()) return

		const whispers = this.pendingWhispers.get(sessionId)
		if (!whispers) return

		while (whispers.length > 0) {
			const steeringMessageId = await task.enqueueSteeringMessage(whispers[0])
			this.emitSteeringStatus(sessionId, steeringMessageId, "queued")
			whispers.shift()
		}
		this.pendingWhispers.delete(sessionId)
	}

	private emitSteeringStatus(sessionId: string, steeringMessageId: string, status: "queued" | "sent"): void {
		this.emitterForSession(sessionId).emit("steering_status", { steeringMessageId, status })
	}

	private applyPinnedContext(
		task:
			| {
				taskState: { pinnedContext?: string }
				setContextCompactionObserver: (observer: () => void) => void
			}
			| undefined,
		sessionId: string,
	): void {
		if (!task) return
		task.taskState.pinnedContext = this.pinnedContextForSession(sessionId)
		task.setContextCompactionObserver(() => void this.emitPinnedMessagesUpdate(sessionId, "compacted"))
	}
	private async emitPinnedMessagesUpdate(sessionId: string, event: "pinned" | "unpinned" | "compacted"): Promise<void> {
		this.emitterForSession(sessionId).emit("pinned_messages_update", {
			event,
			messages: getPinnedSessionMessages(sessionId),
		})
	}

	/** List the workspace snapshots created at task and tool boundaries for a session. */
	async listWorkspaceCheckpoints(sessionId: string): Promise<WorkspaceCheckpoint[]> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`)
		}

		const controller = this.#sessionControllers.get(session)
		if (!controller) {
			throw new Error(`Controller not found for session: ${sessionId}`)
		}

		const task = controller.task
		if (task) {
			return workspaceCheckpointsFromMessages(task.messageStateHandler.getDiracMessages())
		}

		const taskId = session.loadedTaskId ?? getLatestTaskIdForSession(sessionId) ?? sessionId
		await controller.getTaskWithId(taskId)
		const messages = await getSavedDiracMessages(taskId)
		return workspaceCheckpointsFromMessages(messages)
	}

	/** Restore both task history and workspace files to one previously listed checkpoint. */
	async restoreWorkspaceCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
		await this.checkpointRestore(sessionId, checkpointId, "taskAndWorkspace")

		const session = this.sessions.get(sessionId)
		if (session) {
			session.lastActivityAt = Date.now()
			await this.emitSessionInfoUpdate(session)
		}
	}

	/** Provider routing configured through ACP's provider provisioning methods. */
	private readonly providerConfiguration = new ProviderConfigurationManager()

	/** Session config manager for mode, model, provider, reasoning effort, and thinking budget */
	private readonly sessionConfig = new SessionConfigManager(this.providerConfiguration)

	/**
	 * Legacy host services remain process-global, so prompt execution is still
	 * serialized. Task operational configuration itself is session/task-owned.
	 */
	private activePrompt: Promise<void> = Promise.resolve()

	/** Session currently owning the serialized host-service prompt path. */
	private activePromptSessionId?: string

	/** Authoritative committed, persisted runtime choices for each ACP session. */
	private readonly acpSessionOverrides: Map<string, Partial<Settings>> = new Map()

	/** Session-owned mirror of the configuration currently committed to the active Task. */
	private readonly activePromptOverrides: Map<string, Partial<Settings>> = new Map()

	/** Config mutations are serialized independently from prompt lifecycle state. */
	private readonly configuringSessions: Set<string> = new Set()

	/** Per-session barriers ensure runtime snapshots are read and committed in order. */
	private readonly sessionRuntimeMutationTails: Map<string, Promise<void>> = new Map()

	/**
	 * Highest persisted journal sequence per session for this process, used to
	 * synthesize a monotonic sequence when journal persistence fails so the live
	 * ACP emit can continue without crashing the session.
	 */
	private readonly lastJournalSequence = new Map<string, number>()

	/**
	 * In-flight prompt resolvers, keyed by session id. {@link cancel} uses these
	 * to resolve the current `session/prompt` request with `stopReason: "cancelled"`
	 * as required by the ACP spec
	 * (agent-client-protocol/docs/protocol/prompt-turn.mdx — "After all ongoing
	 * operations have been successfully aborted ... the Agent MUST respond to
	 * the original session/prompt request with the cancelled stop reason").
	 */
	private readonly pendingPromptResolvers: Map<
		string,
		{
			resolve: (response: acp.PromptResponse) => void
			resolved: { value: boolean }
		}
	> = new Map()

	/** Pending permission requests, so session/cancel can abort the client interaction. */
	private readonly pendingPermissionResolvers: Map<string, (response: acp.RequestPermissionResponse) => void> = new Map()

	/** Pending elicitation requests, so session/cancel can abort the client interaction. */
	private readonly pendingElicitationResolvers: Map<string, (response: acp.CreateElicitationResponse) => void> = new Map()

	constructor(options: DiracAgentOptions) {
		this.options = options
		this.authentication = new AcpAuthenticationManager({ diracDir: options.diracDir, cwd: options.cwd })
		setRuntimeHooksDir(options.hooksDir)
		// ctx is initialized lazily in initialize() so that IO failures (e.g. an
		// unwritable --config path) surface as a JSON-RPC error response on
		// `initialize` rather than killing the process before the client can
		// observe anything.
	}

	private applyStartupProviderInfrastructure(): void {
		const { provider, model, mode, thinkingBudgetTokens, reasoningEffort, inferenceSpeed } = this.options

		if (mode && !["plan", "act"].includes(mode)) {
			throw RequestError.invalidParams(undefined, `Invalid startup mode: ${mode}`)
		}
		if (thinkingBudgetTokens !== undefined && (!Number.isFinite(thinkingBudgetTokens) || thinkingBudgetTokens < 0)) {
			throw RequestError.invalidParams(undefined, `Invalid --thinking value: ${thinkingBudgetTokens}`)
		}
		if (reasoningEffort !== undefined && !isOpenaiReasoningEffort(reasoningEffort)) {
			throw RequestError.invalidParams(
				undefined,
				`Invalid --reasoning-effort value: ${reasoningEffort}. Expected one of: ${OPENAI_REASONING_EFFORT_OPTIONS.join(", ")}`,
			)
		}
		if (inferenceSpeed !== undefined && !isInferenceSpeed(inferenceSpeed)) {
			throw RequestError.invalidParams(
				undefined,
				`Invalid --speed value: ${inferenceSpeed}. Expected one of: ${INFERENCE_SPEED_OPTIONS.join(", ")}`,
			)
		}
		if (provider && !model) {
			throw RequestError.invalidParams(undefined, "--provider requires --model to be specified")
		}
		if (provider && !provider.startsWith("http://") && !provider.startsWith("https://") && !isValidCliProvider(provider)) {
			throw RequestError.invalidParams(undefined, `Invalid provider: ${provider}`)
		}

		if (provider?.startsWith("http://") || provider?.startsWith("https://")) {
			StateManager.get().setApiConfiguration({ openAiBaseUrl: provider })
		}
	}

	private createStartupSessionOverrides(): Partial<Settings> {
		const { provider, model, mode: startupMode, autoApprove, yolo, thinkingBudgetTokens, reasoningEffort, inferenceSpeed } =
			this.options
		const stateManager = StateManager.get()
		const environmentSettings = getSettingsFromEnv()
		const effectiveDefaults: Partial<Settings> = {}

		for (const key of TASK_RUNTIME_SETTINGS_KEYS) {
			const systemDefault = stateManager.getSystemDefaultSettingsKey(key)
				; (effectiveDefaults as Record<keyof Settings, unknown>)[key] = systemDefault ?? environmentSettings[key]
		}
		Object.assign(effectiveDefaults, getExplicitDiracSettingsFromEnv())
		const environmentProvider = getProviderFromEnv()
		if (environmentProvider && isValidCliProvider(environmentProvider)) {
			effectiveDefaults.actModeApiProvider ??= environmentProvider
			effectiveDefaults.planModeApiProvider ??= environmentProvider
		}

		const overrides = copyTaskRuntimeSettings(effectiveDefaults)
		overrides.mode ??= "act"
		overrides.autoApproveAllToggled ??= false
		overrides.yoloModeToggled ??= false
		overrides.planActSeparateModelsSetting ??= false

		if (startupMode) overrides.mode = startupMode
		if (autoApprove !== undefined) overrides.autoApproveAllToggled = autoApprove
		if (yolo !== undefined) overrides.yoloModeToggled = yolo

		for (const mode of ["plan", "act"] as const) {
			const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
			const defaultProvider = overrides[providerKey] as ApiProvider | undefined
			if (!defaultProvider) throw new Error(`No default API provider is configured for ${mode} mode`)

			const modelKey = getProviderModelIdKey(defaultProvider, mode)
			if (defaultProvider === "openai") {
				const profileNameKey = mode === "act" ? "actModeOpenAiProfileName" : "planModeOpenAiProfileName"
				const profileName = overrides[profileNameKey]
				const profiles =
					stateManager.getSystemDefaultSettingsKey("openAiCompatibleProfiles") ??
					environmentSettings.openAiCompatibleProfiles
				const profile = profileName ? profiles?.find((candidate) => candidate.name === profileName) : undefined
				if (profile) {
					const runtimeValues = overrides as Record<string, unknown>
					runtimeValues[modelKey] ||= profile.modelId
					const modelInfoKey = getProviderModelInfoKey(defaultProvider, mode)!
					runtimeValues[modelInfoKey] ||= structuredClone(profile.modelInfo)
				}
			}
			; (overrides as Record<string, unknown>)[modelKey] =
				(overrides[modelKey] as string | undefined) || getDefaultModelId(defaultProvider)

			const thinkingKey = mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
			const reasoningKey = mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"
			const inferenceSpeedKey = mode === "act" ? "actModeInferenceSpeed" : "planModeInferenceSpeed"
				; (overrides as Record<string, unknown>)[thinkingKey] ??= 0
				; (overrides as Record<string, unknown>)[reasoningKey] ??= "medium"
				; (overrides as Record<string, unknown>)[inferenceSpeedKey] ??= "default"
		}

		if (model) {
			let targetProvider: ApiProvider | undefined
			if (provider?.startsWith("http://") || provider?.startsWith("https://")) {
				targetProvider = "openai"
			} else if (provider) {
				if (!isValidCliProvider(provider)) throw new Error(`Invalid provider: ${provider}`)
				targetProvider = provider as ApiProvider
			} else {
				const currentMode = overrides.mode
				targetProvider = overrides[currentMode === "act" ? "actModeApiProvider" : "planModeApiProvider"] as
					| ApiProvider
					| undefined
			}
			if (!targetProvider) throw new Error("--model requires a configured provider or an explicit --provider")

			const modes = overrides.planActSeparateModelsSetting ? [overrides.mode] : (["plan", "act"] as const)
			for (const mode of modes) {
				; (overrides as Record<string, unknown>)[mode === "act" ? "actModeApiProvider" : "planModeApiProvider"] =
					targetProvider
					; (overrides as Record<string, unknown>)[getProviderModelIdKey(targetProvider, mode)] = model
				const modelInfoKey = getProviderModelInfoKey(targetProvider, mode)
				if (modelInfoKey) overrides[modelInfoKey] = undefined
				if (provider?.startsWith("http://") || provider?.startsWith("https://")) {
					overrides[mode === "act" ? "actModeOpenAiProfileName" : "planModeOpenAiProfileName"] = undefined
				}
			}
		}

		if (thinkingBudgetTokens !== undefined) {
			const modes = overrides.planActSeparateModelsSetting ? [overrides.mode] : (["plan", "act"] as const)
			for (const mode of modes) {
				overrides[mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"] = thinkingBudgetTokens
			}
		}
		if (reasoningEffort !== undefined) {
			const modes = overrides.planActSeparateModelsSetting ? [overrides.mode] : (["plan", "act"] as const)
			for (const mode of modes) {
				overrides[mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"] = reasoningEffort
			}
		}
		if (inferenceSpeed !== undefined) {
			const modes = overrides.planActSeparateModelsSetting ? [overrides.mode] : (["plan", "act"] as const)
			for (const mode of modes) {
				const provider = overrides[mode === "act" ? "actModeApiProvider" : "planModeApiProvider"] as ApiProvider
				const modelId = overrides[getProviderModelIdKey(provider, mode)] as string
				if (inferenceSpeed === "standard" && !providerSupportsInferenceSpeed(provider)) {
					throw new Error(`Provider ${provider} does not support inference speed controls`)
				}
				if (inferenceSpeed === "fast" && !modelSupportsInferenceSpeed(provider, modelId)) {
					throw new Error(`Model ${modelId} does not support Fast mode`)
				}
				overrides[mode === "act" ? "actModeInferenceSpeed" : "planModeInferenceSpeed"] = inferenceSpeed
			}
		}
		return overrides
	}

	private isStartupProviderConfigured(overrides: Partial<Settings>): boolean {
		const mode = overrides.mode === "plan" ? "plan" : "act"
		const configuration = StateManager.get().captureEffectiveTaskConfiguration(overrides).apiConfiguration
		return isSelectedProviderConfigured(configuration as ApiConfiguration, mode)
	}

	private initializeSessionOverrides(sessionId: string, persisted?: Partial<Settings>): Partial<Settings> {
		const overrides = copyTaskRuntimeSettings(persisted ?? this.createStartupSessionOverrides())
		this.acpSessionOverrides.set(sessionId, overrides)
		return overrides
	}

	private persistSessionOverrides(sessionId: string): void {
		const overrides = this.acpSessionOverrides.get(sessionId)
		if (!overrides) throw new Error(`Session runtime configuration not found: ${sessionId}`)
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error(`Session not found: ${sessionId}`)
		this.writeSessionRuntimeConfig(session, overrides)
	}

	private writeSessionRuntimeConfig(session: DiracAcpSession, overrides: Partial<Settings>): void {
		setSessionRuntimeConfig(this.ctx.DATA_DIR, session.sessionId, {
			settings: overrides,
			cwd: session.cwd,
			createdAt: session.createdAt,
			taskId: session.taskId,
		})
	}

	private async runSessionRuntimeMutation<T>(sessionId: string, mutation: () => Promise<T>): Promise<T> {
		if (!this.sessionStates.has(sessionId)) throw new Error(`Session not found: ${sessionId}`)

		const previousMutation = this.sessionRuntimeMutationTails.get(sessionId) ?? Promise.resolve()
		let releaseMutation!: () => void
		const mutationBarrier = new Promise<void>((resolve) => {
			releaseMutation = resolve
		})
		const mutationTail = previousMutation.then(() => mutationBarrier)
		this.sessionRuntimeMutationTails.set(sessionId, mutationTail)
		this.configuringSessions.add(sessionId)

		await previousMutation
		try {
			if (!this.sessionStates.has(sessionId)) throw new Error(`Session not found: ${sessionId}`)
			return await mutation()
		} finally {
			releaseMutation()
			if (this.sessionRuntimeMutationTails.get(sessionId) === mutationTail) {
				this.sessionRuntimeMutationTails.delete(sessionId)
				this.configuringSessions.delete(sessionId)
			}
		}
	}

	private resolveSessionTaskRuntime(
		overrides: Partial<Settings>,
		mode: "act" | "plan",
		task?: NonNullable<Controller["task"]>,
	) {
		if (task) {
			// Existing tasks retain their captured credentials and unrelated defaults.
			// Task synchronizes API-handler setting keys from this exact session patch.
			return { settings: overrides }
		}

		const captured = StateManager.get().captureEffectiveTaskConfiguration(overrides)
		validateApiConfiguration(captured.apiConfiguration as ApiConfiguration, mode)
		return {
			settings: overrides,
			apiConfiguration: captured.apiConfiguration as ApiConfiguration,
		}
	}

	private async refreshSessionProviderRuntime(session: DiracAcpSession): Promise<void> {
		const task = this.#sessionControllers.get(session)?.task
		if (!task) return
		const overrides = this.acpSessionOverrides.get(session.sessionId)
		if (!overrides) throw new Error(`Session runtime configuration not found: ${session.sessionId}`)
		const mode = overrides.mode
		if (mode !== "plan" && mode !== "act") throw new Error(`Invalid session mode: ${mode}`)
		const captured = StateManager.get().captureEffectiveTaskConfiguration(overrides)
		validateApiConfiguration(captured.apiConfiguration as ApiConfiguration, mode)
		await task.applyWorkingConfigurationUpdate({
			apiConfiguration: captured.apiConfiguration as ApiConfiguration,
		})
	}

	private async commitClientSessionRuntime(session: DiracAcpSession, nextOverrides: Partial<Settings>): Promise<void> {
		const nextMode = nextOverrides.mode
		if (nextMode !== "plan" && nextMode !== "act") throw new Error(`Invalid session mode: ${nextMode}`)

		if (!this.activePromptOverrides.has(session.sessionId)) {
			await this.replaceSessionRuntimeConfig(session, nextOverrides, nextMode)
			return
		}

		await this.applyActivePromptRuntime(
			session,
			nextOverrides,
			nextMode,
			() => this.writeSessionRuntimeConfig(session, nextOverrides),
		)
		this.acpSessionOverrides.set(session.sessionId, nextOverrides)
	}

	private async applyActivePromptRuntime(
		session: DiracAcpSession,
		nextOverrides: Partial<Settings>,
		nextMode: "act" | "plan",
		beforeCommit: () => void | Promise<void>,
	): Promise<void> {
		const task = this.#sessionControllers.get(session)?.task
		const runtime = this.resolveSessionTaskRuntime(nextOverrides, nextMode, task)
		if (task) await task.applyWorkingConfigurationUpdate(runtime, beforeCommit)
		else await beforeCommit()
		this.activePromptOverrides.set(session.sessionId, nextOverrides)
		session.mode = nextMode
	}

	private async refreshTaskRuntime(session: DiracAcpSession, overrides: Partial<Settings>): Promise<void> {
		const task = this.#sessionControllers.get(session)?.task
		if (!task) return
		const mode = overrides.mode
		if (mode !== "plan" && mode !== "act") throw new Error(`Invalid session mode: ${mode}`)
		await task.applyWorkingConfigurationUpdate(this.resolveSessionTaskRuntime(overrides, mode, task))
	}

	private async replaceSessionRuntimeConfig(
		session: DiracAcpSession,
		nextOverrides: Partial<Settings>,
		nextMode: "act" | "plan",
	): Promise<void> {
		if (!this.acpSessionOverrides.has(session.sessionId)) {
			throw new Error(`Session runtime configuration not found: ${session.sessionId}`)
		}

		const task = this.#sessionControllers.get(session)?.task
		const runtime = this.resolveSessionTaskRuntime(nextOverrides, nextMode, task)
		const persist = () => this.writeSessionRuntimeConfig(session, nextOverrides)

		if (task) await task.applyWorkingConfigurationUpdate(runtime, persist)
		else persist()

		this.acpSessionOverrides.set(session.sessionId, nextOverrides)
		session.mode = nextMode
	}

	/**
	 * Set the permission handler callback.
	 *
	 * This handler is called when the agent needs permission for a tool call.
	 * The handler should present the request to the user and call the resolve
	 * callback with their response.
	 *
	 * @param handler - The permission handler callback
	 */
	setPermissionHandler(handler: PermissionHandler): void {
		this.permissionHandler = handler
	}

	/** Set the transport callback used for ACP elicitation. */
	setElicitationHandler(handler: ElicitationHandler): void {
		this.elicitationHandler = handler
	}

	private async requestElicitation(request: acp.CreateElicitationRequest): Promise<acp.CreateElicitationResponse> {
		if (!this.elicitationHandler) {
			return { action: "cancel" }
		}

		const sessionId = "sessionId" in request && typeof request.sessionId === "string" ? request.sessionId : undefined
		return await new Promise((resolve) => {
			let settled = false
			const settle = (response: acp.CreateElicitationResponse) => {
				if (settled) return
				settled = true
				if (sessionId && this.pendingElicitationResolvers.get(sessionId) === settle) {
					this.pendingElicitationResolvers.delete(sessionId)
				}
				resolve(response)
			}
			if (sessionId) {
				this.pendingElicitationResolvers.get(sessionId)?.({ action: "cancel" })
				this.pendingElicitationResolvers.set(sessionId, settle)
			}
			this.elicitationHandler!(request, settle)
		})
	}

	/**
	 * Stores ACP “always” decisions in the project's `.dirac/permissions.json`.
	 * The rule applies to the matching tool across every session opened for this workspace.
	 */
	private async persistPermissionRule(
		sessionId: string,
		toolCall: acp.ToolCall | acp.ToolCallUpdate,
		action: "allow" | "deny",
	): Promise<void> {
		const task = this.permissionTaskForSession(sessionId)

		const rawInput = toolCall.rawInput as Record<string, unknown> | undefined
		const commands = rawInput?.commands
		const command =
			Array.isArray(commands) && commands.length === 1 && typeof commands[0] === "object" && commands[0] !== null
				? (commands[0] as Record<string, unknown>).command
				: undefined

		const rule: ToolPermissionRule =
			typeof command === "string"
				? { tool: "execute_command", pattern: command, action }
				: { tool: this.permissionRuleToolName(toolCall), action }

		await task.addPermissionRule(rule)
	}

	/** List persisted project permission rules for an ACP session. */
	async listPermissionRules(sessionId: string): Promise<ToolPermissionRule[]> {
		const task = this.activePermissionTaskForSession(sessionId)
		if (task) {
			return await task.listPermissionRules()
		}

		return await this.withSessionPermissionController(sessionId, (controller) => controller.listRules())
	}

	/** Delete one persisted project permission rule for an ACP session. */
	async deletePermissionRule(sessionId: string, rule: ToolPermissionRule): Promise<void> {
		const task = this.activePermissionTaskForSession(sessionId)
		if (task) {
			await task.deletePermissionRule(rule)
			return
		}

		await this.withSessionPermissionController(sessionId, (controller) => controller.deleteRule(rule))
	}

	private activePermissionTaskForSession(sessionId: string) {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Unknown session: ${sessionId}`)
		}
		return this.#sessionControllers.get(session)?.task
	}

	private async withSessionPermissionController<T>(
		sessionId: string,
		operation: (controller: CommandPermissionController) => Promise<T>,
	): Promise<T> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Unknown session: ${sessionId}`)
		}

		const controller = new CommandPermissionController()
		await controller.initialize(session.cwd)
		try {
			return await operation(controller)
		} finally {
			await controller.dispose()
		}
	}

	private permissionTaskForSession(sessionId: string) {
		const task = this.activePermissionTaskForSession(sessionId)
		if (!task) {
			throw new Error("Cannot persist a permission rule without an active session task")
		}
		return task
	}

	private permissionRuleToolName(toolCall: acp.ToolCall | acp.ToolCallUpdate): string {
		if (!toolCall.title) {
			throw new Error("Cannot persist a permission rule without a tool title")
		}
		return toolCall.title
	}

	private async requestPermission(
		sessionId: string,
		toolCall: any,
		options?: acp.PermissionOption[],
	): Promise<acp.RequestPermissionResponse> {
		if (!this.permissionHandler) {
			throw new Error("Permission handler not set")
		}
		return new Promise((resolve) => {
			const settle = (response: acp.RequestPermissionResponse) => {
				if (this.pendingPermissionResolvers.get(sessionId) === settle) {
					this.pendingPermissionResolvers.delete(sessionId)
				}
				resolve(response)
			}
			this.pendingPermissionResolvers.set(sessionId, settle)
			this.permissionHandler!({ sessionId, toolCall, options: options || [] }, settle)
		})
	}

	/**
	 * Get the event emitter for a session.
	 *
	 * Use this to subscribe to session events like agent_message_chunk,
	 * tool_call, etc.
	 *
	 * @param sessionId - The session ID
	 * @returns The session's event emitter
	 */
	emitterForSession(sessionId: string): DiracSessionEmitter {
		let emitter = this.sessionEmitters.get(sessionId)
		if (!emitter) {
			emitter = new DiracSessionEmitter()
			this.sessionEmitters.set(sessionId, emitter)
		}
		return emitter
	}

	/**
	 * Initialize the agent and return its capabilities.
	 *
	 * This is the first method called by the client after establishing
	 * the connection. The agent returns its protocol version and capabilities.
	 */
	async initialize(params: acp.InitializeRequest, connection?: acp.AgentSideConnection): Promise<acp.InitializeResponse> {
		this.ctx = initializeCliContext({
			diracDir: this.options.diracDir,
			workspaceDir: this.options.cwd,
		})
		DiracTempManager.startPeriodicCleanup()
		this.clientCapabilities = params.clientCapabilities
		this.initializeHostProvider(this.clientCapabilities, connection)
		// Shared with initializeCli — see initCoreServices for why both modes
		// must route through it.
		await initCoreServices({
			extensionDir: this.ctx.EXTENSION_DIR,
			storageContext: this.ctx.storageContext,
		})
		this.applyStartupProviderInfrastructure()
		const startupOverrides = this.createStartupSessionOverrides()
		const authMethods = this.authentication.listAuthenticationMethods(
			this.isStartupProviderConfigured(startupOverrides),
			this.clientCapabilities,
		)

		return {
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {
				_meta: {
					"dev.dirac/session.close": true,
					"dev.dirac/session.delete": true,
					...(this.options.detached ? { "dev.dirac/detached_mode": true } : {}),
					"dev.dirac/auth.logout": true,

					"dev.dirac/seq": true,

					"dev.dirac/permissions.list": true,
					"dev.dirac/permissions.delete": true,

					"dev.dirac/whisper": true,
					"dev.dirac/steering_status": true,
					"dev.dirac/client_annotation": true,

					"dev.dirac/checkpoints.list": true,
					"dev.dirac/checkpoints.restore": true,
					"dev.dirac/messages.pin": true,
					"dev.dirac/messages.unpin": true,
					"dev.dirac/messages.pinned": true,
					"dev.dirac/pinned_messages_update": true,
					"dev.dirac/permission.effect_previews": true,
					"dev.dirac/worktree.provision": {
						requestMetaKey: "dev.dirac/worktree",
						requestShape: "true | { baseBranch?: string }",
					},
					"dev.dirac/worktree.integrate": true,
				},
				loadSession: true,
				auth: { logout: {} },
				providers: {},
				sessionCapabilities: {
					resume: {},
					close: {},
					delete: {},
				},
				promptCapabilities: {
					image: true,
					audio: false,
					embeddedContext: true,
				},
			},
			agentInfo: {
				name: "dirac",
				version: AGENT_VERSION,
			},
			authMethods,
		}
	}

	/**
	 * Initialize the host provider with optional connection for ACP mode.
	 *
	 * When used with the AcpAgent wrapper, a connection is provided for
	 * host bridge operations. When used programmatically, connection is
	 * undefined and standalone providers are used.
	 *
	 * @param clientCapabilities - Client capabilities from initialization
	 * @param connection - Optional ACP connection for host bridge operations
	 */
	initializeHostProvider(clientCapabilities?: acp.ClientCapabilities, connection?: acp.AgentSideConnection): void {
		const activeSessionIdResolver: ActiveAcpSessionIdResolver = () => this.activePromptSessionId
		const hostBridgeClientProvider = new ACPHostBridgeClientProvider(
			connection,
			clientCapabilities,
			activeSessionIdResolver,
			() =>
				this.activePromptSessionId
					? this.sessions.get(this.activePromptSessionId)?.cwd
					: (this.options.cwd ?? process.cwd()),
			connection ? (sessionId, update) => this.persistAndSendSessionUpdate(connection, sessionId, update) : undefined,
			AGENT_VERSION,
		)

		HostProvider.initialize(
			"cli",
			() => new ExternalDiracWebviewProvider(this.ctx.extensionContext),
			() => {
				if (connection) {
					return new FileEditProvider(
						new ACPTextFileAccess(connection, clientCapabilities, activeSessionIdResolver, new NodeTextFileAccess()),
						false,
						false,
					)
				}
				return new FileEditProvider(new NodeTextFileAccess(), false)
			},
			() => new ExternalCommentReviewController(),
			() => {
				if (clientCapabilities?.terminal && connection) {
					return new AcpTerminalManager(connection, clientCapabilities, activeSessionIdResolver)
				}
				return new StandaloneTerminalManager()
			},
			hostBridgeClientProvider,
			(message: string) => Logger.info(message),
			async (path: string) => AuthHandler.getInstance().getCallbackUrl(path),
			getCliBinaryPath,
			this.ctx.EXTENSION_DIR,
			this.ctx.DATA_DIR,
			async (_cwd: string) => undefined,
		)
	}

	/**
	 * Create a new session.
	 *
	 * A session represents a conversation/task with the agent. The client
	 * provides the working directory.
	 */
	async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		const sessionId = crypto.randomUUID()
		const sessionOverrides = this.createStartupSessionOverrides()

		Logger.debug("[DiracAgent] newSession called:", {
			sessionId,
			cwd: params.cwd,
		})

		const worktreeRequest = worktreeProvisioningRequest(params)
		const worktree = worktreeRequest ? await this.provisionSessionWorktree(sessionId, params.cwd, worktreeRequest) : undefined
		const sessionCwd = worktree?.worktreePath ?? params.cwd

		// Create Controller for this session
		const controller = new Controller(this.ctx.extensionContext, {
			workspaceCwd: sessionCwd,
		})

		// Create session record with all resources
		const session: DiracAcpSession = {
			sessionId,
			cwd: sessionCwd,
			mode: sessionOverrides.mode as "act" | "plan",
			createdAt: Date.now(),
			lastActivityAt: Date.now(),
		}

		const configOptions = await this.sessionConfig.getSessionConfigOptions(session, sessionOverrides)

		this.#sessionControllers.set(session, controller)

		this.sessions.set(sessionId, session)
		this.initializeSessionOverrides(sessionId, sessionOverrides)
		this.persistSessionOverrides(sessionId)

		// Initialize session state
		const sessionState: AcpSessionState = {
			sessionId,
			status: AcpSessionStatus.Idle,
			pendingToolCalls: new Map(),
		}

		this.sessionStates.set(sessionId, sessionState)

		return {
			sessionId,
			modes: this.sessionConfig.getSessionModeState(session.mode, sessionOverrides),
			configOptions,
			...(worktree
				? {
					_meta: {
						"dev.dirac/worktree": {
							path: worktree.worktreePath,
							branch: worktree.branch,
							...(worktree.targetBranch ? { targetBranch: worktree.targetBranch } : {}),
						},
					},
				}
				: {}),
		}
	}

	/**
	 * Load an existing session from task history.
	 *
	 * Resolve the stable conversation ID to its latest backing task.
	 * The task is rehydrated lazily on first prompt to align with the ACP flow.
	 */
	async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
		const sessionId = params.sessionId
		const existingSession = this.sessions.get(sessionId)
		if (existingSession) {
			return this.runSessionRuntimeMutation(sessionId, async () => {
				const configOptions = await this.getNormalizedConfigOptions(existingSession)
				const sessionOverrides = this.acpSessionOverrides.get(sessionId)!
				return {
					modes: this.sessionConfig.getSessionModeState(existingSession.mode, sessionOverrides),
					configOptions,
				}
			})
		}

		Logger.debug("[DiracAgent] loadSession called:", { sessionId })

		const persistedRuntimeConfig = getSessionRuntimeConfig(this.ctx.DATA_DIR, sessionId)
		if (!persistedRuntimeConfig) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.SessionRuntimeMissing,
				`Task runtime configuration not found for ACP session ${sessionId}; this session predates task-owned runtime configuration and cannot be loaded safely`,
				"Start a new session under the current provider and model settings.",
			)
		}
		const persistedMode = persistedRuntimeConfig.settings.mode
		if (persistedMode !== "plan" && persistedMode !== "act") {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.SessionRuntimeMalformed,
				`Task runtime configuration for ACP session ${sessionId} has no valid mode`,
				"Start a new session or repair/remove the corrupted runtime record before retrying.",
			)
		}

		const history = resolveHistorySession(sessionId, persistedRuntimeConfig.taskId ?? getLatestTaskIdForSession(sessionId))
		if (
			!history &&
			getSessionUpdates(sessionId).some(
				(entry) =>
					entry.kind === "session_update" &&
					["user_message_chunk", "agent_message_chunk", "tool_call", "tool_call_update"].includes(
						entry.update.sessionUpdate,
					),
			)
		) {
			throw new Error(`Persisted conversation history not found for ACP session ${sessionId}`)
		}
		const persistedHistory = history?.historyItem

		const ownedWorktree = getSessionWorktree(sessionId)
		if (ownedWorktree) {
			try {
				await fs.access(ownedWorktree.worktreePath)
			} catch {
				throw new Error(
					`ACP session ${sessionId} owns a missing worktree at ${ownedWorktree.worktreePath}; restore it or delete the session before loading`,
				)
			}
		}

		const historyCwd =
			ownedWorktree?.worktreePath ??
			(persistedHistory
				? getHistoryItemCwd(persistedHistory, params.cwd, this.options.cwd)
				: persistedRuntimeConfig.cwd || params.cwd || this.options.cwd)
		if (!historyCwd) throw new Error(`Working directory not found for ACP session ${sessionId}`)

		const controller = new Controller(this.ctx.extensionContext, {
			workspaceCwd: historyCwd,
		})

		const session: DiracAcpSession = {
			sessionId,
			cwd: historyCwd,
			mode: persistedMode,
			createdAt: persistedRuntimeConfig.createdAt ?? Date.now(),
			lastActivityAt: Date.now(),
			...(persistedHistory
				? {
					isLoadedFromHistory: true,
					loadedTaskId: history!.taskId,
					taskId: history!.taskId,
				}
				: {}),
		}
		const sessionOverrides = copyTaskRuntimeSettings(persistedRuntimeConfig.settings)
		const configOptions = await this.sessionConfig.getSessionConfigOptions(session, sessionOverrides)
		const loadRuntime = StateManager.get().captureEffectiveTaskConfiguration(sessionOverrides)
		validateApiConfiguration(loadRuntime.apiConfiguration as ApiConfiguration, persistedMode)

		if (history) {
			await controller.getTaskWithId(history.taskId)
		}

		this.#sessionControllers.set(session, controller)
		this.sessions.set(sessionId, session)
		this.acpSessionOverrides.set(sessionId, sessionOverrides)
		this.sessionStates.set(sessionId, {
			sessionId,
			status: AcpSessionStatus.Idle,
			pendingToolCalls: new Map(),
		})
		this.writeSessionRuntimeConfig(session, sessionOverrides)

		return {
			modes: this.sessionConfig.getSessionModeState(session.mode, sessionOverrides),
			configOptions,
		}
	}

	/**
	 * Resume an existing session without replaying historical session updates.
	 *
	 * Unlike `loadSession`, this restores the same persisted task context but leaves
	 * transcript ownership with the reattaching client.
	 */
	async unstable_resumeSession(params: acp.ResumeSessionRequest): Promise<acp.ResumeSessionResponse> {
		return this.loadSession({
			sessionId: params.sessionId,
			cwd: params.cwd,
			mcpServers: params.mcpServers ?? [],
		})
	}

	/**
	 * Emit initial session updates that must happen after the ACP stdio wrapper
	 * has registered and subscribed to the session.
	 */
	async publishSessionSetupUpdates(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`)
		}

		const controller = this.#sessionControllers.get(session)
		if (!controller) {
			throw new Error("Controller not initialized for session. This is a bug in the ACP agent setup.")
		}

		await this.sendAvailableCommands(sessionId, controller)
		await this.emitConfigOptionsUpdate(sessionId)
	}

	async setSessionConfigOption(params: acp.SetSessionConfigOptionRequest): Promise<acp.SetSessionConfigOptionResponse> {
		const session = this.sessions.get(params.sessionId)
		if (!session) throw new Error(`Session not found: ${params.sessionId}`)

		Logger.debug("[DiracAgent] setSessionConfigOption called:", {
			sessionId: params.sessionId,
			configId: params.configId,
			value: params.value,
		})

		if (params.configId === "mode") {
			if (typeof params.value !== "string") throw new Error("Mode must be a select value")
			return { configOptions: await this.applySessionMode(params.sessionId, params.value) }
		}

		return this.runSessionRuntimeMutation(params.sessionId, async () => {
			const currentOverrides = this.acpSessionOverrides.get(params.sessionId)
			if (!currentOverrides) throw new Error(`Session runtime configuration not found: ${params.sessionId}`)
			const nextOverrides = copyTaskRuntimeSettings(currentOverrides)
			let configOptions: acp.SessionConfigOption[] | undefined

			switch (params.configId) {
				case "auto_approve":
					if (typeof params.value !== "boolean") throw new Error("Auto-approve must be a boolean value")
					nextOverrides.autoApproveAllToggled = params.value
					break
				case "yolo":
					if (typeof params.value !== "boolean") throw new Error("YOLO must be a boolean value")
					nextOverrides.yoloModeToggled = params.value
					break
				case "provider":
					if (typeof params.value !== "string") throw new Error("Provider must be a select value")
					configOptions = await this.sessionConfig.applyProviderConfigOption(session, params.value, nextOverrides)
					break
				case "model":
					if (typeof params.value !== "string") throw new Error("Model must be a select value")
					configOptions = await this.sessionConfig.applyModelConfigOption(session, params.value, nextOverrides)
					break
				case "reasoning_effort":
					if (typeof params.value !== "string") throw new Error("Reasoning effort must be a select value")
					this.sessionConfig.applyReasoningEffortConfigOption(session, params.value, nextOverrides)
					break
				case "inference_speed":
					if (typeof params.value !== "string") throw new Error("Inference speed must be a select value")
					this.sessionConfig.applyInferenceSpeedConfigOption(session, params.value, nextOverrides)
					break
				case "thinking_budget":
					if (typeof params.value !== "string") throw new Error("Thinking budget must be a select value")
					this.sessionConfig.applyThinkingBudgetConfigOption(session, params.value, nextOverrides)
					break
				default:
					throw new Error(`Unknown session config option: ${params.configId}`)
			}

			configOptions ??= await this.sessionConfig.getSessionConfigOptions(session, nextOverrides)
			await this.commitClientSessionRuntime(session, nextOverrides)
			session.lastActivityAt = Date.now()
			await this.emitSessionUpdate(params.sessionId, { sessionUpdate: "config_option_update", configOptions })
			return { configOptions }
		})
	}

	/**
	 * Handle a user prompt.
	 *
	 * This is the main entry point for user interaction. The agent
	 * processes the prompt and sends updates back via sessionUpdate.
	 *
	 * The prompt flow:
	 * 1. Extract content from the ACP prompt (text, images, files)
	 * 2. Set up internal dirac state subsription
	 * 3. Initialize or continue dirac task
	 * 4. Translate DiracMessages to ACP SessionUpdates
	 * 5. Handle permission requests for tools/commands
	 * 6. Return when dirac task completes, is cancelled, or needs user input
	 */
	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		const session = this.sessions.get(params.sessionId)
		const sessionState = this.sessionStates.get(params.sessionId)

		if (!session || !sessionState) {
			throw new Error(`Session not found: ${params.sessionId}`)
		}

		const controller = this.#sessionControllers.get(session)
		if (!controller) {
			throw new Error("Controller not initialized for session. This is a bug in the ACP agent setup.")
		}

		const activeOverrides = await this.runSessionRuntimeMutation(params.sessionId, async () => {
			if (sessionState.status !== AcpSessionStatus.Idle) {
				throw new Error(`Session ${params.sessionId} is busy with another operation`)
			}
			const sessionOverrides = this.acpSessionOverrides.get(params.sessionId)
			if (!sessionOverrides) throw new Error(`Session runtime configuration not found: ${params.sessionId}`)
			const overrides = copyTaskRuntimeSettings(sessionOverrides)
			await this.sessionConfig.assertTaskRuntimeAvailable(session, overrides)
			await this.refreshTaskRuntime(session, overrides)
			this.activePromptOverrides.set(params.sessionId, overrides)
			this.unbindPromptTask(params.sessionId)
			sessionState.status = AcpSessionStatus.Processing
			session.lastActivityAt = Date.now()
			return overrides
		})

		Logger.debug("[DiracAgent] prompt called:", {
			sessionId: params.sessionId,
			promptLength: params.prompt.length,
		})
		const previousPrompt = this.activePrompt
		let releasePrompt!: () => void
		this.activePrompt = new Promise<void>((resolve) => {
			releasePrompt = resolve
		})
		await previousPrompt
		this.activePromptSessionId = params.sessionId

		// A session can be cancelled while queued behind another session's prompt.
		// Do not begin task initialization once it reaches the front of that queue.
		if ((sessionState.status as AcpSessionStatus) === AcpSessionStatus.Cancelled) {
			this.activePromptOverrides.delete(params.sessionId)
			releasePrompt()
			sessionState.status = AcpSessionStatus.Idle
			this.activePromptSessionId = undefined
			return this.bridgeForSession(params.sessionId).promptResponse("cancelled")
		}

		// Clear only this session's delta and tool-call tracking state.
		const bridge = this.bridgeForSession(params.sessionId)
		bridge.clearPromptState()

		// Track cleanup functions for subscriptions
		const cleanupFunctions: (() => void)[] = []

		// Promise that settles when the task completes, is cancelled, needs input,
		// or encounters an internal failure.
		let resolvePrompt: (response: acp.PromptResponse) => void
		let rejectPrompt: (error: Error) => void
		const promptPromise = new Promise<acp.PromptResponse>((resolve, reject) => {
			resolvePrompt = resolve
			rejectPrompt = reject
		})

		// Track if we've already resolved/rejected (object for pass-by-reference)
		const promptResolved = { value: false }

		// Register the resolver so cancel() can resolve the in-flight prompt with
		// `stopReason: "cancelled"`. Cleared in the finally block.
		this.pendingPromptResolvers.set(params.sessionId, {
			resolve: resolvePrompt!,
			resolved: promptResolved,
		})

		let subscribedTask: object | undefined
		const subscribeToCurrentTask = () => {
			const task = controller.task
			if (!task || subscribedTask === task) return
			bridge.subscribeToTaskMessages(
				controller,
				params.sessionId,
				sessionState,
				resolvePrompt!,
				rejectPrompt!,
				promptResolved,
				cleanupFunctions,
				controller.taskRunPromise,
			)
			subscribedTask = task
		}
		const removeTaskReplacementListener = controller.onTaskReplaced(async (taskId) => {
			await bridge.cancelInFlightToolCalls(params.sessionId, sessionState)
			await recordTaskForSession(params.sessionId, taskId)
			session.taskId = taskId
			this.persistSessionOverrides(params.sessionId)
			subscribedTask = undefined
			const replacementTask = controller.task
			if (!replacementTask) return
			await this.bindPromptTask(params.sessionId, replacementTask)
			const replayEndIndex = replacementTask.messageStateHandler.getDiracMessages().length
			subscribeToCurrentTask()
			await bridge.replayTaskMessages(
				controller,
				params.sessionId,
				sessionState,
				resolvePrompt!,
				rejectPrompt!,
				promptResolved,
				0,
				replayEndIndex,
			)
		})
		cleanupFunctions.push(removeTaskReplacementListener)

		try {
			// Extract text content from prompt
			const { textContent, imageContent, fileResources } = parsePromptContent(params.prompt)

			// Command availability may depend on skills and workflows added after the
			// session was created. Republish the complete current set before each turn.
			await this.sendAvailableCommands(params.sessionId, controller)
			await this.setSessionTitleFromFirstExchange(session, textContent)

			const interceptedReviewResponse =
				imageContent.length === 0 && fileResources.length === 0
					? await handleAcpReviewCommand({
						commandText: textContent,
						controller,
						sessionId: params.sessionId,
						cwd: session.cwd,
						emitSessionUpdate: this.emitSessionUpdate.bind(this),
					})
					: null

			if (interceptedReviewResponse) {
				return {
					...interceptedReviewResponse,
					...bridge.promptResponse(interceptedReviewResponse.stopReason),
				}
			}

			// Determine if this is a new task, continuation, or loaded session resume
			const hasActiveTask = controller.task !== undefined
			const isLoadedSession = session.isLoadedFromHistory === true

			if (session.awaitingCancelledTaskResume && hasActiveTask && controller.task) {
				// cancelTask() reinitializes persisted history and leaves its replacement task
				// waiting in resumeTaskFromHistory(). ACP has no historical resume-card
				// requirement, so wake that flow directly rather than replacing the task.
				Logger.debug("[DiracAgent] Resuming task reinitialized after cancellation:", controller.task.taskId)
				subscribeToCurrentTask()
				await this.bindPromptTask(params.sessionId, controller.task)
				await controller.task.submitCardResponse("", DiracAskResponse.MESSAGE, textContent, imageContent, fileResources)
				session.awaitingCancelledTaskResume = false
			} else if (isLoadedSession) {
				// Reinitialization returns only once the persisted conversation is restored.
				const taskIdToResume = session.loadedTaskId!
				await controller.reinitExistingTaskFromId(
					taskIdToResume,
					this.activePromptInitializationOptions(params.sessionId),
				)
				const task = controller.task!
				subscribeToCurrentTask()
				await this.bindPromptTask(params.sessionId, task)
				await task.submitCardResponse("", DiracAskResponse.MESSAGE, textContent, imageContent, fileResources)
			} else if (hasActiveTask && controller.task) {
				// Continue existing task - respond to pending ask
				Logger.debug("[DiracAgent] Continuing existing task:", controller.task.taskId)

				const waitingCardId = controller.task.taskState.lastWaitingCardId
				const waitingCard = waitingCardId
					? controller.task.messageStateHandler
						.getDiracMessages()
						.find(
							(message) =>
								message.content.type === DiracMessageType.CARD &&
								message.content.card.id === waitingCardId &&
								message.content.card.status === CardStatus.WAITING_FOR_INPUT,
						)
					: undefined

				if (waitingCard) {
					subscribeToCurrentTask()
					await controller.task.submitCardResponse(
						waitingCardId!,
						DiracAskResponse.MESSAGE,
						textContent,
						imageContent,
						fileResources,
					)
				} else {
					// Restoration can clear the live task on failure; retain its ID for the next prompt's retry.
					session.isLoadedFromHistory = true
					session.loadedTaskId = controller.task.taskId
					const task = await controller.prepareTaskForFollowUp(this.activePromptInitializationOptions(params.sessionId))
					subscribeToCurrentTask()
					await this.bindPromptTask(params.sessionId, task)
					await task.submitCardResponse("", DiracAskResponse.MESSAGE, textContent, imageContent, fileResources)
				}
			} else {
				// The ACP session ID is the stable conversation ULID, not the backing task ID.
				Logger.debug("[DiracAgent] Starting new task")
				await controller.initTask(
					textContent,
					imageContent,
					fileResources,
					undefined,
					undefined,
					params.sessionId,
					undefined,
					this.activePromptInitializationOptions(params.sessionId),
				)
				session.taskId = controller.task?.taskId
				this.persistSessionOverrides(params.sessionId)
			}
			session.isLoadedFromHistory = false
			session.loadedTaskId = undefined

			if (controller.task && !subscribedTask) {
				const replayEndIndex = controller.task.messageStateHandler.getDiracMessages().length
				subscribeToCurrentTask()
				await bridge.replayTaskMessages(
					controller,
					params.sessionId,
					sessionState,
					resolvePrompt!,
					rejectPrompt!,
					promptResolved,
					0,
					replayEndIndex,
				)
			}

			// Existing continuations subscribe before waking the task; newly created
			// tasks subscribe and replay the messages emitted during initialization.
			subscribeToCurrentTask()

			// Pins were installed during task construction. This preserves the observer
			// for task implementations that do not consume initialization options.

			// Return the promise that will resolve when task completes
			return await promptPromise
		} catch (error) {
			if (!promptResolved.value) {
				promptResolved.value = true
				const internalError = error instanceof Error ? error : new Error(String(error))
				try {
					await this.emitSessionUpdate(params.sessionId, {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: `Error: ${internalError.message}`,
						},
					})
				} catch (emitError) {
					Logger.error("[DiracAgent] Failed to emit internal prompt error:", emitError)
				}
				throw internalError
			}
			throw error
		} finally {
			this.activePromptOverrides.delete(params.sessionId)
			releasePrompt()
			this.activePromptSessionId = undefined

			// Clean up subscriptions
			for (const cleanup of cleanupFunctions) {
				try {
					cleanup()
				} catch (error) {
					Logger.debug("[DiracAgent] Error during cleanup:", error)
				}
			}
			this.pendingPromptResolvers.delete(params.sessionId)
			this.unbindPromptTask(params.sessionId)

			// Task-owned steering remains in the transcript. Pre-task guidance remains session-owned until a task binds.
			sessionState.status = AcpSessionStatus.Idle
		}
	}

	/**
	 * Cancel the current operation in a session.
	 *
	 * This is a notification (no response expected). The agent should
	 * stop any ongoing processing for the specified session.
	 */
	async cancel(params: acp.CancelNotification): Promise<void> {
		const session = this.sessions.get(params.sessionId)
		if (!session) {
			Logger.debug("[DiracAgent] cancel called for non-existent session:", params.sessionId)
			return
		}
		const sessionState = this.sessionStates.get(params.sessionId)

		Logger.debug("[DiracAgent] cancel called:", {
			sessionId: params.sessionId,
			status: sessionState?.status,
		})

		if (sessionState) {
			sessionState.status = AcpSessionStatus.Cancelled

			// Claim the prompt-resolver slot BEFORE any await so the idle watchdog
			// cannot steal it while we're awaiting cancelTask(). The ACP spec
			// (prompt-turn.mdx) requires the agent to respond with stopReason:
			// "cancelled" once the task is aborted; claiming here ensures that even
			// if the watchdog timer fires and its callback runs during the cancelTask()
			// await, the watchdog sees the flag and returns without emitting a phantom
			// "Agent stalled" tool_call or resolving with "end_turn".
			const pending = this.pendingPromptResolvers.get(params.sessionId)
			const cancelClaimed = pending != null && !pending.resolved.value
			if (cancelClaimed) {
				pending!.resolved.value = true
				// Actual resolve() call is deferred until after cancelTask() so the
				// response goes out once the task is truly stopped (see below).
			}

			// Abort a permission request that is currently waiting on the client. Its
			// normal response path turns this into a rejected Dirac card response.
			this.pendingPermissionResolvers.get(params.sessionId)?.({
				outcome: { outcome: "cancelled" },
			})

			const bridge = this.bridgeForSession(params.sessionId)
			bridge.invalidatePendingInteractions()
			this.pendingElicitationResolvers.get(params.sessionId)?.({
				action: "cancel",
			})

			try {
				// If we have an active controller task, cancel it before resolving prompt.
				const controller = this.#sessionControllers.get(session)
				if (controller?.task) {
					try {
						await controller.cancelTask()

						// TaskController.cancelTask() recreates persisted tasks and starts their
						// resume flow. Mark that handoff explicitly so the next ACP prompt can
						// submit to it without depending on a historical card.
						if (controller.task) {
							session.taskId = controller.task.taskId
							session.awaitingCancelledTaskResume = true
						}
					} catch (error) {
						Logger.debug("[DiracAgent] Error cancelling task:", error)
					}

					await bridge.waitForMessageWork()
				}

				// ACP clients retain tool calls until a terminal update arrives. Close
				// every outstanding call, including one awaiting permission, before the
				// cancelled prompt response is emitted.
				await bridge.cancelInFlightToolCalls(params.sessionId, sessionState)
			} catch (error) {
				Logger.error("[DiracAgent] Error finalizing ACP cancellation:", error)
			} finally {
				// Cancellation owns this resolver once claimed. Cleanup failures must not
				// strand the original session/prompt request.
				if (cancelClaimed) {
					pending!.resolve(bridge.promptResponse("cancelled"))
				}
			}
		}
	}

	/** Set the mutually exclusive Plan/Act session mode without changing approval qualifiers. */
	async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
		await this.releaseSessionResources(params.sessionId)
		return {}
	}

	async deleteSession(params: acp.DeleteSessionRequest): Promise<acp.DeleteSessionResponse> {
		await this.deleteSessionResources(params.sessionId)
		return {}
	}

	async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
		Logger.debug("[DiracAgent] setSessionMode called:", {
			sessionId: params.sessionId,
			modeId: params.modeId,
		})
		await this.applySessionMode(params.sessionId, params.modeId)
		return {}
	}

	private async applySessionMode(sessionId: string, modeId: string): Promise<acp.SessionConfigOption[]> {
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error(`Session not found: ${sessionId}`)
		const validModes: AcpModeId[] = ["plan", "act"]
		if (!validModes.includes(modeId as AcpModeId)) {
			throw new Error(`Invalid mode: ${modeId}. Valid modes are: ${validModes.join(", ")}`)
		}

		return this.runSessionRuntimeMutation(sessionId, async () => {
			const currentOverrides = this.acpSessionOverrides.get(sessionId)
			if (!currentOverrides) throw new Error(`Session runtime configuration not found: ${sessionId}`)
			const nextOverrides = copyTaskRuntimeSettings(currentOverrides)
			nextOverrides.mode = modeId as AcpModeId

			const configOptions = await this.sessionConfig.getSessionConfigOptions(session, nextOverrides)
			await this.commitClientSessionRuntime(session, nextOverrides)
			session.lastActivityAt = Date.now()
			await this.emitCurrentModeUpdate(sessionId)
			await this.emitSessionUpdate(sessionId, { sessionUpdate: "config_option_update", configOptions })
			return configOptions
		})
	}

	private async switchSessionToActMode(sessionId: string): Promise<boolean> {
		return this.runSessionRuntimeMutation(sessionId, async () => {
			const session = this.sessions.get(sessionId)
			if (!session) throw new Error(`Session not found: ${sessionId}`)
			const currentOverrides = this.acpSessionOverrides.get(sessionId)
			if (!currentOverrides) throw new Error(`Session runtime configuration not found: ${sessionId}`)
			const activeOverrides = this.activePromptOverrides.get(sessionId)
			if ((activeOverrides?.mode ?? session.mode) === "act") {
				return this.#sessionControllers.get(session)?.task !== undefined
			}

			const nextOverrides = copyTaskRuntimeSettings(currentOverrides)
			nextOverrides.mode = "act"
			const configOptions = await this.sessionConfig.getSessionConfigOptions(session, nextOverrides)
			await this.commitClientSessionRuntime(session, nextOverrides)

			session.lastActivityAt = Date.now()
			await this.emitCurrentModeUpdate(sessionId)
			await this.emitSessionUpdate(sessionId, { sessionUpdate: "config_option_update", configOptions })
			return this.#sessionControllers.get(session)?.task !== undefined
		})
	}

	async listProviders(): Promise<acp.ListProvidersResponse> {
		return this.providerConfiguration.listProviders()
	}

	async setProvider(params: acp.SetProviderRequest): Promise<void> {
		await this.providerConfiguration.setProvider(params)
		await this.publishProviderConfigChanges()
	}

	async disableProvider(params: acp.DisableProviderRequest): Promise<void> {
		await this.providerConfiguration.disableProvider(params)
		await this.publishProviderConfigChanges()
	}

	async unstable_listProviders(params: acp.ListProvidersRequest): Promise<acp.ListProvidersResponse> {
		void params
		return this.listProviders()
	}

	async unstable_setProvider(params: acp.SetProviderRequest): Promise<void> {
		return this.setProvider(params)
	}

	async unstable_disableProvider(params: acp.DisableProviderRequest): Promise<void> {
		return this.disableProvider(params)
	}

	private async publishProviderConfigChanges(): Promise<void> {
		await Promise.all([...this.sessions.keys()].map((sessionId) => this.emitConfigOptionsUpdate(sessionId, true)))
	}

	async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
		const response = await this.authentication.authenticate(params)
		await this.publishProviderConfigChanges()
		return response
	}

	async logout(): Promise<void> {
		await this.authentication.logout()
		await this.publishProviderConfigChanges()
	}

	private async emitCurrentModeUpdate(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`)
		}
		const sessionOverrides = this.acpSessionOverrides.get(sessionId)
		if (!sessionOverrides) throw new Error(`Session runtime configuration not found: ${sessionId}`)

		await this.emitSessionUpdate(sessionId, {
			sessionUpdate: "current_mode_update",
			currentModeId: this.sessionConfig.computeCurrentAcpModeId(session.mode, sessionOverrides),
		})
	}

	private async persistAndSendSessionUpdate(
		connection: acp.AgentSideConnection,
		sessionId: string,
		update: acp.SessionUpdate,
	): Promise<void> {
		const persistedUpdate = this.persistSessionUpdate(sessionId, update)
		await connection.sessionUpdate({ sessionId, update: persistedUpdate })
	}

	private async emitSessionUpdate(sessionId: string, update: acp.SessionUpdate): Promise<void> {
		const emitter = this.emitterForSession(sessionId)
		const persistedUpdate = this.persistSessionUpdate(sessionId, update)

		try {
			emitter.emit(persistedUpdate.sessionUpdate, persistedUpdate)
		} catch (error) {
			Logger.debug("[DiracAgent] Error emitting session update:", error)
			emitter.emit("error", error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Persist a session update, falling back to an ephemeral, in-process sequence
	 * when the journal cannot be written. A persistence failure must not take down
	 * the live ACP session, so the caller can still emit the update to the client.
	 *
	 * NOTE: the fallback sequence is a best-effort degradation, not durable
	 * ordering. It is only seeded from a successful write, so when persistence
	 * fails from the very first call (e.g. an already over-cap journal) it starts
	 * at 1 and counts up in memory — colliding with the sequence numbers already
	 * persisted in the journal, and resetting on process restart. Acceptable as an
	 * immediate unblock; Step 2 (append-only journal) removes this entirely.
	 */
	private persistSessionUpdate(sessionId: string, update: acp.SessionUpdate): ReturnType<typeof recordSessionUpdate> {
		try {
			const persisted = recordSessionUpdate(sessionId, update)
			const sequence = persisted._meta?.[SEQUENCE_META_KEY]
			if (typeof sequence === "number") {
				this.lastJournalSequence.set(sessionId, sequence)
			}
			return persisted
		} catch (error) {
			Logger.error("[DiracAgent] ACP journal persistence failed; emitting session update ephemerally:", error)
			const sequence = (this.lastJournalSequence.get(sessionId) ?? 0) + 1
			this.lastJournalSequence.set(sessionId, sequence)
			return {
				...update,
				_meta: {
					...(update as acp.SessionUpdate & { _meta?: Record<string, unknown> })._meta,
					[SEQUENCE_META_KEY]: sequence,
				},
			}
		}
	}

	private async getNormalizedConfigOptions(session: DiracAcpSession): Promise<acp.SessionConfigOption[]> {
		const currentOverrides = this.acpSessionOverrides.get(session.sessionId)
		if (!currentOverrides) throw new Error(`Session runtime configuration not found: ${session.sessionId}`)
		const nextOverrides = copyTaskRuntimeSettings(currentOverrides)
		const configOptions = await this.sessionConfig.getSessionConfigOptions(session, nextOverrides)
		await this.commitClientSessionRuntime(session, nextOverrides)
		return configOptions
	}

	private async emitConfigOptionsUpdate(sessionId: string, refreshProviderRuntime = false): Promise<void> {
		if (!this.sessionStates.has(sessionId)) return
		await this.runSessionRuntimeMutation(sessionId, async () => {
			const session = this.sessions.get(sessionId)
			if (!session) throw new Error(`Session not found: ${sessionId}`)
			const configOptions = await this.getNormalizedConfigOptions(session)
			if (refreshProviderRuntime) await this.refreshSessionProviderRuntime(session)
			await this.emitSessionUpdate(sessionId, { sessionUpdate: "config_option_update", configOptions })
		})
	}

	/**
	 * Replay the historical messages for a loaded session as ACP sessionUpdate events.
	 * Called by AcpAgent after subscribing to session events, so the events reach the client.
	 */
	async replayLoadedSessionHistory(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) return

		const controller = this.#sessionControllers.get(session)
		if (!controller) return

		const taskId = session.loadedTaskId ?? controller.task?.taskId
		if (!taskId) return
		let uiMessages: DiracMessage[]
		try {
			await controller.getTaskWithId(taskId)
			uiMessages = await getSavedDiracMessages(taskId)
		} catch (error) {
			Logger.debug("[DiracAgent] replayLoadedSessionHistory: could not read ui_messages:", error)
			return
		}

		const bridge = this.bridgeForSession(sessionId)
		const persistedUpdates = getSessionUpdates(sessionId)
		if (persistedUpdates.length > 0) {
			const emitter = this.emitterForSession(sessionId)
			for (const persistedUpdate of persistedUpdates) {
				if (persistedUpdate.kind === "session_update") {
					emitter.emit(persistedUpdate.update.sessionUpdate, persistedUpdate.update)
				} else if (persistedUpdate.kind === "client_annotation") {
					emitter.emit("client_annotation", persistedUpdate.annotation)
				}
			}

			const hasPersistedUsageUpdate = persistedUpdates.some(
				(persistedUpdate) =>
					persistedUpdate.kind === "session_update" && persistedUpdate.update.sessionUpdate === "usage_update",
			)
			await bridge.restoreUsage(sessionId, uiMessages, !hasPersistedUsageUpdate)
			await this.emitPinnedMessagesUpdate(sessionId, "compacted")
			return
		}

		// Use a fresh session state for replay — don't pollute the live session's tool call tracking
		const replayState: AcpSessionState = {
			sessionId,
			status: AcpSessionStatus.Idle,
			pendingToolCalls: new Map(),
		}

		for (const message of uiMessages) {
			try {
				// User-facing input messages that translateMessage skips — emit as user_message_chunk
				if (
					message.content.type === DiracMessageType.MARKDOWN &&
					message.content.role === "user" &&
					message.content.content
				) {
					await this.emitSessionUpdate(sessionId, {
						sessionUpdate: "user_message_chunk",
						content: { type: "text", text: message.content.content },
					} as acp.SessionUpdate)
					continue
				}

				await this.emitPlanFromMessage(sessionId, message)
				const result = translateMessage(message, replayState, {
					clientCapabilities: this.clientCapabilities,
				})
				for (const update of result.updates) {
					await this.emitSessionUpdate(sessionId, update)
				}
			} catch (error) {
				Logger.debug("[DiracAgent] replayLoadedSessionHistory: error translating message:", error)
			}
		}
		await bridge.restoreUsage(sessionId, uiMessages, true)
	}

	private async emitPlanFromMessage(sessionId: string, message: DiracMessage): Promise<void> {
		const plan = this.planFromMessage(message)
		if (!plan) return

		await this.emitSessionUpdate(sessionId, { sessionUpdate: "plan", ...plan })
	}

	private planFromMessage(message: DiracMessage): acp.Plan | undefined {
		if (message.content.type !== DiracMessageType.CARD || !isPlanResponseCard(message.content.card)) {
			return undefined
		}

		const body = message.content.card.body
		if (!body) return undefined

		const planText = this.planTextFromCard(body).trim()
		const numberedItems = planText
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => /^[-*]\s+|^\d+[.)]\s+/.test(line))
			.map((line) => line.replace(/^[-*]\s+|^\d+[.)]\s+/, "").trim())
			.filter(Boolean)
		const planItems = numberedItems.length > 0 ? numberedItems : planText ? [planText] : []
		const status = this.planStatusFromCard(message.content.card.status)
		const entries: acp.PlanEntry[] = planItems.map((content, index) => ({
			content,
			priority: index === 0 ? "high" : "medium",
			status,
		}))

		return entries.length > 0 ? { entries } : undefined
	}

	private planStatusFromCard(status: CardStatus): acp.PlanEntryStatus {
		if (status === CardStatus.SUCCESS) return "completed"
		if (status === CardStatus.RUNNING || status === CardStatus.BUILDING) return "in_progress"
		return "pending"
	}

	private planTextFromCard(body: string): string {
		try {
			const parsed = JSON.parse(body) as { response?: unknown }
			return typeof parsed.response === "string" ? parsed.response : body
		} catch {
			return body
		}
	}

	private async sendAvailableCommands(sessionId: string, controller: Controller): Promise<void> {
		try {
			// Get all available commands from Dirac
			const response = await getAvailableSlashCommands(controller, {})

			// Filter out CLI-only and VS Code-only commands
			const cliOnlyNames = new Set(CLI_ONLY_COMMANDS.map((c) => c.name))
			const vscodeOnlyNames = new Set(VSCODE_ONLY_COMMANDS.map((c) => c.name))

			const filteredCommands = response.commands.filter(
				(cmd) => cmd.cliCompatible && !cliOnlyNames.has(cmd.name) && !vscodeOnlyNames.has(cmd.name),
			)

			// Convert to ACP AvailableCommand format
			const availableCommands: acp.AvailableCommand[] = filteredCommands.map((cmd) => ({
				name: cmd.name,
				description: cmd.description,
				input: {
					hint: cmd.description,
				},
			}))

			for (const reviewCommand of ACP_REVIEW_COMMANDS) {
				if (!availableCommands.some((cmd) => cmd.name === reviewCommand.name)) {
					availableCommands.push(reviewCommand)
				}
			}

			// Send the available_commands_update notification
			await this.emitSessionUpdate(sessionId, {
				sessionUpdate: "available_commands_update",
				availableCommands,
			})

			Logger.debug("[DiracAgent] Sent available commands:", {
				sessionId,
				commandCount: availableCommands.length,
				commands: availableCommands.map((c) => c.name),
			})
		} catch (error) {
			Logger.debug("[DiracAgent] Error sending available commands:", error)
		}
	}

	private async setSessionTitleFromFirstExchange(session: DiracAcpSession, promptText: string): Promise<void> {
		if (session.title || !promptText.trim()) {
			return
		}

		session.title = summarizeSessionTitle(promptText)
		await this.emitSessionInfoUpdate(session)
	}

	private async emitSessionInfoUpdate(session: DiracAcpSession): Promise<void> {
		await this.emitSessionUpdate(session.sessionId, {
			sessionUpdate: "session_info_update",
			title: session.title ?? null,
			updatedAt: new Date(session.lastActivityAt).toISOString(),
		})
	}

	async unstable_listSessions(params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
		return this.unstable_listSessions_internal(params)
	}

	private async unstable_listSessions_internal(params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
		const persistedSessions = listLatestConversationHistoryItems(params.cwd, this.options.cwd).map((historyItem) =>
			historyItemToSessionInfo(historyItem, params.cwd, this.options.cwd),
		)
		const persistedSessionIds = new Set(persistedSessions.map((session) => session.sessionId))
		const activeOnlySessions = [...this.sessions.values()]
			.filter((session) => !persistedSessionIds.has(session.sessionId))
			.filter((session) => !params.cwd || session.cwd === params.cwd)
			.map((session) => ({
				sessionId: session.sessionId,
				cwd: session.cwd,
				title: session.title ?? null,
				updatedAt: new Date(session.lastActivityAt).toISOString(),
			}))
			.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))

		return {
			sessions: [...persistedSessions, ...activeOnlySessions].sort((left, right) =>
				(right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
			),
		}
	}

	/**
	 * Restore a checkpoint in a session.
	 *
	 * Cancels any active task, finds the message matching the checkpoint
	 * ID (DiracMessage.id / toolCallId), and delegates to the controller's
	 */
	async checkpointRestore(sessionId: string, checkpointId: string, restoreType: string, offset?: number): Promise<void> {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`)
		}

		const controller = this.#sessionControllers.get(session)
		if (!controller) {
			throw new Error(`Controller not found for session: ${sessionId}`)
		}

		// Cancel active task — cannot alter message history while task is running
		await controller.cancelTask()

		// Wait for the task to be fully re-initialized after cancellation.
		// cancelTask() re-initializes the task asynchronously, and we must
		// wait for it to be ready before accessing its message handler.
		await pWaitFor(() => controller.task?.taskState.isInitialized === true, {
			timeout: 3_000,
		}).catch((error) => {
			Logger.error("[DiracAgent.checkpointRestore] Failed to wait for task initialization:", error)
			throw error
		})

		// Find the message matching the checkpoint ID (DiracMessage.id / toolCallId)
		const message = controller.task?.messageStateHandler.getMessageById(checkpointId)

		if (message && controller.task?.checkpointManager) {
			await controller.task.checkpointManager.restoreCheckpoint(message.id, restoreType as any, offset)
		} else {
			throw new Error(`Checkpoint not found for id: ${checkpointId}`)
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/acp/AcpTerminalManager.ts (lines 390-1065)
```
export class AcpTerminalManager implements ITerminalManager {
	private readonly connection: acp.AgentSideConnection
	private readonly clientCapabilities: acp.ClientCapabilities | undefined
	private readonly sessionIdResolver: ActiveAcpSessionIdResolver

	/** Active terminals indexed by their string ID */
	private readonly terminals: Map<string, ManagedTerminal> = new Map()

	/** Map from numeric ID to string ID for ITerminalManager compatibility */
	private readonly numericIdToStringId: Map<number, string> = new Map()

	/** Next numeric ID to assign */
	private nextNumericId = 1

	/** Active processes indexed by numeric terminal ID */
	private readonly processes: Map<number, AcpTerminalProcess> = new Map()

	/** TerminalInfo wrappers indexed by numeric ID */
	private readonly terminalInfos: Map<number, TerminalInfo> = new Map()

	// Configuration options for ITerminalManager
	private terminalReuseEnabled = true
	private terminalOutputLineLimit: number = DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT

	/**
	 * Creates a new AcpTerminalManager.
	 *
	 * @param connection - The ACP agent-side connection
	 * @param clientCapabilities - The client's advertised capabilities
	 * @param sessionIdResolver - The current session ID
	 */
	constructor(
		connection: acp.AgentSideConnection,
		clientCapabilities: acp.ClientCapabilities | undefined,
		sessionIdResolver: ActiveAcpSessionIdResolver,
	) {
		this.connection = connection
		this.clientCapabilities = clientCapabilities
		this.sessionIdResolver = sessionIdResolver
	}

	// =========================================================================
	// ITerminalManager Implementation
	// =========================================================================

	/**
	 * Run a command in the specified terminal.
	 * @param terminalInfo The terminal to run the command in
	 * @param command The command to execute
	 * @returns A promise-like object that emits events and resolves on completion
	 */
	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		const terminal = terminalInfo.terminal as AcpTerminal
		const managedTerminal = terminal._managedTerminal

		// Update state
		terminalInfo.busy = true
		terminalInfo.lastCommand = command
		terminalInfo.lastActive = Date.now()
		managedTerminal.busy = true
		managedTerminal.lastCommand = command

		// Create the process - will be updated with actual terminal ID after creation
		const process = new AcpTerminalProcess(this, managedTerminal.id)
		this.processes.set(managedTerminal.numericId, process)

		// Set up completion handlers
		process.once("completed", () => {
			terminalInfo.busy = false
			managedTerminal.busy = false
		})

		process.once("error", (_error: Error) => {
			terminalInfo.busy = false
			managedTerminal.busy = false
		})

		// Create promise for the process
		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => resolve())
			process.once("completed", () => resolve())
			process.once("error", (error: Error) => reject(error))
		})

		// For ACP, we need to create a new terminal with the command
		// since ACP terminals are command-based, not interactive
		this.runCommandInternal(managedTerminal, command, process)

		return mergePromise(process, promise)
	}

	/**
	 * Internal method to run a command via ACP.
	 */
	private async runCommandInternal(
		managedTerminal: ManagedTerminal,
		command: string,
		process: AcpTerminalProcess,
	): Promise<void> {
		try {
			// Create a new ACP terminal with the command
			const request: acp.CreateTerminalRequest = {
				sessionId: this.getSessionId(),
				command: command,
				cwd: managedTerminal.cwd,
			}

			const handle = await this.connection.createTerminal(request)

			// Remove old terminal entry if it exists
			if (managedTerminal.id && this.terminals.has(managedTerminal.id)) {
				this.terminals.delete(managedTerminal.id)
			}

			// Update the managed terminal with the new handle
			managedTerminal.handle = handle
			managedTerminal.id = handle.id

			// Update the ID mappings
			this.terminals.set(handle.id, managedTerminal)
			this.numericIdToStringId.set(managedTerminal.numericId, handle.id)

			// Update the process with the new terminal ID
			process.updateTerminalId(handle.id)

			// Start the process polling
			process.run(command)
		} catch (error) {
			process.emit("error", error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Get or create a terminal for the specified working directory.
	 * @param cwd The working directory for the terminal
	 * @returns The terminal info for an available terminal
	 */
	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		// Find an available terminal with matching CWD
		for (const [_numericId, terminalInfo] of this.terminalInfos) {
			if (!terminalInfo.busy) {
				const terminal = terminalInfo.terminal as AcpTerminal
				if (terminal._cwd === cwd) {
					return terminalInfo
				}
			}
		}

		// Find any available terminal if reuse is enabled
		if (this.terminalReuseEnabled) {
			for (const [_numericId, terminalInfo] of this.terminalInfos) {
				if (!terminalInfo.busy) {
					// Update the CWD
					const terminal = terminalInfo.terminal as AcpTerminal
					terminal._cwd = cwd
					if (terminal.shellIntegration?.cwd) {
						terminal.shellIntegration.cwd.fsPath = cwd
					}
					terminal._managedTerminal.cwd = cwd
					return terminalInfo
				}
			}
		}

		// Create a new terminal
		const numericId = this.nextNumericId++
		const placeholderId = `pending-${numericId}`

		const managedTerminal: ManagedTerminal = {
			id: placeholderId, // Will be updated when command runs
			numericId,
			handle: null as unknown as TerminalHandle, // Will be set when command runs
			command: "",
			cwd,
			createdAt: Date.now(),
			released: false,
			busy: false,
			lastCommand: "",
		}

		const acpTerminal = new AcpTerminal(managedTerminal, this)

		const terminalInfo: TerminalInfo = {
			id: numericId,
			terminal: acpTerminal,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
		}

		this.terminals.set(managedTerminal.id, managedTerminal)
		this.numericIdToStringId.set(numericId, managedTerminal.id)
		this.terminalInfos.set(numericId, terminalInfo)

		Logger.debug("[AcpTerminalManager] Created terminal:", { numericId, cwd })

		return terminalInfo
	}

	/**
	 * Get terminals filtered by busy state.
	 * @param busy Whether to get busy or idle terminals
	 * @returns Array of terminal info with id and last command
	 */
	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		const result: { id: number; lastCommand: string }[] = []

		for (const [numericId, terminalInfo] of this.terminalInfos) {
			if (terminalInfo.busy === busy) {
				result.push({
					id: numericId,
					lastCommand: terminalInfo.lastCommand,
				})
			}
		}

		return result
	}

	/**
	 * Get output that hasn't been retrieved yet from a terminal.
	 * @param terminalId The terminal ID (numeric)
	 * @returns The unretrieved output string
	 */
	getUnretrievedOutput(terminalId: number): string {
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	/**
	 * Check if a terminal's process is actively outputting.
	 * @param terminalId The terminal ID (numeric)
	 * @returns Whether the process is hot
	 */
	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	/**
	 * Dispose of all terminals and clean up resources.
	 */
	disposeAll(): void {
		// Release all terminals
		this.releaseAll().catch((err) => {
			Logger.debug("[AcpTerminalManager] Error releasing terminals:", err)
		})

		// Clear all tracking
		this.terminals.clear()
		this.numericIdToStringId.clear()
		this.processes.clear()
		this.terminalInfos.clear()

		Logger.debug("[AcpTerminalManager] disposeAll complete")
	}

	/**
	 * Set the timeout for waiting for shell integration.
	 * @param timeout Timeout in milliseconds
	 */
	setShellIntegrationTimeout(_timeout: number): void {
		// no-op
	}

	/**
	 * Enable or disable terminal reuse.
	 * @param enabled Whether to enable terminal reuse
	 */
	setTerminalReuseEnabled(enabled: boolean): void {
		this.terminalReuseEnabled = enabled
	}

	/**
	 * Set the maximum number of output lines to keep.
	 * @param limit Maximum number of lines
	 */
	setTerminalOutputLineLimit(limit: number): void {
		this.terminalOutputLineLimit = limit
	}

	/**
	 * Set the default terminal profile.
	 * @param profile The profile identifier
	 * @returns Info about closed and busy terminals (no-op in ACP, always empty)
	 */
	setDefaultTerminalProfile(_profile: string): TerminalProfileChangeResult {
		return { closedCount: 0, busyTerminals: [] }
	}

	/**
	 * Process output lines, potentially truncating if over limit.
	 * @param outputLines Array of output lines
	 * @param overrideLimit Optional limit override
	 * @returns Processed output string
	 */
	processOutput(outputLines: string[], overrideLimit?: number): string {
		const limit = overrideLimit !== undefined ? overrideLimit : this.terminalOutputLineLimit

		if (outputLines.length > limit) {
			const halfLimit = Math.floor(limit / 2)
			const start = outputLines.slice(0, halfLimit)
			const end = outputLines.slice(outputLines.length - halfLimit)
			return `${start.join("\n")}\n... (output truncated) ...\n${end.join("\n")}`.trim()
		}
		return outputLines.join("\n").trim()
	}

	// =========================================================================
	// ACP-specific Methods (original interface)
	// =========================================================================

	/**
	 * Check if the client supports terminal operations.
	 */
	canUseTerminal(): boolean {
		return this.clientCapabilities?.terminal === true
	}

	/**
	 * Create a new terminal and execute a command.
	 *
	 * @param options - Terminal creation options
	 * @returns The managed terminal instance or an error when the capability is absent
	 */
	async createTerminal(options: CreateTerminalOptions): Promise<ManagedTerminal | { error: string }> {
		if (!this.canUseTerminal()) {
			return { error: "Client does not support terminal capability" }
		}

		Logger.debug("[AcpTerminalManager] createTerminal:", options)
		const request: acp.CreateTerminalRequest = {
			sessionId: this.getSessionId(),
			command: options.command,
		}

		if (options.args !== undefined && options.args.length > 0) {
			request.args = options.args
		}
		if (options.cwd !== undefined) {
			request.cwd = options.cwd
		}
		if (options.env !== undefined && options.env.length > 0) {
			request.env = options.env.map((entry) => ({ name: entry.name, value: entry.value }))
		}
		if (options.outputByteLimit !== undefined) {
			request.outputByteLimit = Number(options.outputByteLimit)
		}

		const handle = await this.connection.createTerminal(request)
		const numericId = this.nextNumericId++
		const managedTerminal: ManagedTerminal = {
			id: handle.id,
			numericId,
			handle,
			command: options.command,
			args: options.args,
			cwd: options.cwd,
			createdAt: Date.now(),
			released: false,
			busy: true,
			lastCommand: options.command,
		}

		this.terminals.set(handle.id, managedTerminal)
		this.numericIdToStringId.set(numericId, handle.id)
		Logger.debug("[AcpTerminalManager] createTerminal success:", { id: handle.id, numericId })
		return managedTerminal
	}

	/**
	 * Get the current output of a terminal without waiting for it to exit.
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The current output or an error
	 */
	async getOutput(terminalId: string): Promise<TerminalOutputResult> {
		const terminal = this.terminals.get(terminalId)

		if (!terminal) {
			return {
				output: "",
				truncated: false,
				success: false,
				error: `Terminal not found: ${terminalId}`,
			}
		}

		if (terminal.released) {
			return {
				output: "",
				truncated: false,
				success: false,
				error: `Terminal has been released: ${terminalId}`,
			}
		}

		Logger.debug("[AcpTerminalManager] getOutput:", { terminalId })

		try {
			const response = await terminal.handle.currentOutput()

			const result: TerminalOutputResult = {
				output: response.output,
				truncated: response.truncated,
				success: true,
			}

			if (response.exitStatus) {
				result.exitStatus = {
					exitCode: response.exitStatus.exitCode ?? undefined,
					signal: response.exitStatus.signal ?? undefined,
				}
			}

			Logger.debug("[AcpTerminalManager] getOutput response:", {
				outputLength: response.output.length,
				truncated: response.truncated,
				hasExitStatus: !!response.exitStatus,
			})

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] getOutput error:", errorMessage)

			return {
				output: "",
				truncated: false,
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Wait for a terminal command to exit and return its exit status.
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The exit status or an error
	 */
	async waitForExit(terminalId: string): Promise<TerminalWaitResult> {
		const terminal = this.terminals.get(terminalId)

		if (!terminal) {
			return {
				success: false,
				error: `Terminal not found: ${terminalId}`,
			}
		}

		if (terminal.released) {
			return {
				success: false,
				error: `Terminal has been released: ${terminalId}`,
			}
		}

		Logger.debug("[AcpTerminalManager] waitForExit:", { terminalId })

		try {
			const response = await terminal.handle.waitForExit()

			Logger.debug("[AcpTerminalManager] waitForExit response:", response)

			return {
				exitCode: response.exitCode ?? undefined,
				signal: response.signal ?? undefined,
				success: true,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] waitForExit error:", errorMessage)

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Kill a terminal command without releasing the terminal.
	 *
	 * The terminal remains valid after killing, allowing you to:
	 * - Get the final output with getOutput()
	 * - Check the exit status
	 * - Release the terminal when done
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The operation result
	 */
	async kill(terminalId: string): Promise<TerminalOperationResult> {
		const terminal = this.terminals.get(terminalId)

		if (!terminal) {
			return {
				success: false,
				error: `Terminal not found: ${terminalId}`,
			}
		}

		if (terminal.released) {
			return {
				success: false,
				error: `Terminal has been released: ${terminalId}`,
			}
		}

		Logger.debug("[AcpTerminalManager] kill:", { terminalId })

		try {
			await terminal.handle.kill()

			Logger.debug("[AcpTerminalManager] kill success")

			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] kill error:", errorMessage)

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Release a terminal and free all associated resources.
	 *
	 * If the command is still running, it will be killed.
	 * After release, the terminal ID becomes invalid and cannot be used
	 * with other terminal methods.
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The operation result
	 */
	async release(terminalId: string): Promise<TerminalOperationResult> {
		const terminal = this.terminals.get(terminalId)

		if (!terminal) {
			return {
				success: false,
				error: `Terminal not found: ${terminalId}`,
			}
		}

		if (terminal.released) {
			// Already released, consider it a success
			return { success: true }
		}

		Logger.debug("[AcpTerminalManager] release:", { terminalId })

		try {
			await terminal.handle.release()
			terminal.released = true

			Logger.debug("[AcpTerminalManager] release success")

			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] release error:", errorMessage)

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Get a managed terminal by its string ID.
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The managed terminal or undefined
	 */
	getTerminal(terminalId: string): ManagedTerminal | undefined {
		return this.terminals.get(terminalId)
	}

	/**
	 * Get all active (non-released) terminals.
	 */
	getActiveTerminals(): ManagedTerminal[] {
		return Array.from(this.terminals.values()).filter((t) => !t.released)
	}

	/**
	 * Get the count of active terminals.
	 */
	getActiveTerminalCount(): number {
		return this.getActiveTerminals().length
	}

	/**
	 * Release all active terminals.
	 *
	 * This is useful for cleanup when a session ends.
	 */
	async releaseAll(): Promise<void> {
		const activeTerminals = this.getActiveTerminals()

		Logger.debug("[AcpTerminalManager] releaseAll:", { count: activeTerminals.length })

		const releasePromises = activeTerminals.map((terminal) => this.release(terminal.id))
		await Promise.allSettled(releasePromises)

		Logger.debug("[AcpTerminalManager] releaseAll complete")
	}

	/**
	 * Execute a command and wait for it to complete.
	 *
	 * This is a convenience method that creates a terminal, waits for exit,
	 * gets the output, and releases the terminal.
	 *
	 * @param options - Terminal creation options
	 * @returns The output and exit status
	 */
	async executeCommand(
		options: CreateTerminalOptions,
	): Promise<{ output: string; exitCode?: number; signal?: string; success: boolean; error?: string }> {
		const terminalResult = await this.createTerminal(options)

		if ("error" in terminalResult) {
			return {
				output: "",
				success: false,
				error: terminalResult.error,
			}
		}

		const terminal = terminalResult

		try {
			// Wait for the command to exit
			const exitResult = await this.waitForExit(terminal.id)

			if (!exitResult.success) {
				return {
					output: "",
					success: false,
					error: exitResult.error,
				}
			}

			// Get the final output
			const outputResult = await this.getOutput(terminal.id)

			return {
				output: outputResult.output,
				exitCode: exitResult.exitCode,
				signal: exitResult.signal,
				success: true,
			}
		} finally {
			// Always release the terminal
			await this.release(terminal.id)
		}
	}

	/**
	 * Get the current session ID.
	 * @throws Error if no ACP session is active
	 */
	private getSessionId(): string {
		return requireActiveAcpSessionId(this.sessionIdResolver, "creating a terminal")
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/index.ts (lines 623-645)
```
export function buildApiHandler(configuration: ApiConfiguration, mode: Mode): ApiHandler {
	const { planModeApiProvider, actModeApiProvider, apiProvider: fallbackProvider, ...options } = configuration
	const apiProvider = (mode === "plan" ? planModeApiProvider : actModeApiProvider) ?? fallbackProvider
	const handler = createHandlerForProvider(apiProvider, options, mode)
	const { thinkingBudgetTokens } = resolveModeConfig(options, mode)
	if (!thinkingBudgetTokens || thinkingBudgetTokens <= 0) return handler

	const modelInfo = handler.getModel().info
	const maxBudget = modelInfo.thinkingConfig?.maxBudget
	const isAnthropicFamily = apiProvider === "anthropic" || apiProvider === "vertex" || apiProvider === "bedrock"
	const effectiveCap =
		maxBudget ?? (modelInfo.maxTokens ? (isAnthropicFamily ? modelInfo.maxTokens - 1 : modelInfo.maxTokens) : undefined)

	if (!effectiveCap || thinkingBudgetTokens <= effectiveCap) {
		return handler
	}

	const clippedOptions = {
		...options,
		[mode === "plan" ? "planModeThinkingBudgetTokens" : "actModeThinkingBudgetTokens"]: effectiveCap,
	}
	return createHandlerForProvider(apiProvider, clippedOptions, mode)
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/providers/unbiased.ts (lines 21-108)
```
export class UnbiasedHandler implements ApiHandler {
	private client: OpenAI | undefined
	private abortController: AbortController | undefined
	private readonly isSubscription: boolean

	constructor(private readonly options: UnbiasedHandlerOptions) {
		// Bind pricing to this handler's key so later default-account changes cannot alter an in-flight request.
		this.isSubscription =
			StateManager.isInitialized() &&
			isUnbiasedOAuthApiKey(options.unbiasedApiKey, StateManager.get().getGlobalStateKey("unbiasedOAuthApiKeyHash"))
	}

	private ensureClient(): OpenAI {
		if (!this.options.unbiasedApiKey) throw new Error("Unbiased API key is required. Sign in or enter a key in settings.")
		this.client ??= createOpenAIClient({
			baseURL: "https://api.unbiased.ai/v1",
			apiKey: this.options.unbiasedApiKey,
		})
		return this.client
	}

	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const abortController = new AbortController()
		this.abortController = abortController
		try {
			yield* this.createMessageWithRetry(systemPrompt, messages, tools, abortController.signal)
		} finally {
			if (this.abortController === abortController) this.abortController = undefined
		}
	}

	@withRetry()
	private async *createMessageWithRetry(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools: OpenAITool[] | undefined,
		signal: AbortSignal,
	): ApiStream {
		signal.throwIfAborted()
		const model = this.getModel()
		const stream = await this.ensureClient().chat.completions.create(
			{
				model: model.id,
				max_tokens: model.info.maxTokens,
				messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages, undefined, true)],
				stream: true,
				stream_options: { include_usage: true },
				...getOpenAIToolParams(tools),
			},
			{ signal },
		)
		const toolCallProcessor = new ToolCallProcessor()
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) yield { type: "text", text: delta.content }
			if (delta?.tool_calls) yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			if (chunk.usage) {
				const usage = formatOpenAiCompatibleUsage(chunk.usage, model.info)
				// A provider-reported API value is not an incremental charge on the monthly plan.
				if (this.isSubscription) usage.totalCost = 0
				yield usage
			}
		}
	}

	abort(): void {
		this.abortController?.abort()
	}

	getModel(): { id: string; info: ModelInfo } {
		const models = getCachedUnbiasedModels(
			this.options.unbiasedApiKey,
			StateManager.isInitialized() ? StateManager.get() : undefined,
		)
		const configuredId = this.options.apiModelId
		// Ignore an unrelated provider's shared mode ID, but retain Pareto versions across cache expiry/restarts.
		const id =
			configuredId && (models?.[configuredId] || configuredId === "pareto" || configuredId.startsWith("pareto-"))
				? configuredId
				: unbiasedDefaultModelId
		const modelInfo: ModelInfo =
			models?.[id] || (id === unbiasedDefaultModelId ? unbiasedModels.pareto : { supportsPromptCache: false })
		const info = this.isSubscription
			? { ...modelInfo, inputPrice: 0, outputPrice: 0, cacheReadsPrice: 0, cacheWritesPrice: 0 }
			: modelInfo
		return { id, info }
	}
}
```


## Source Files:

- `cli/acp-spawn-debug.mjs`
- `cli/scripts/acp-probe.mts`
- `cli/scripts/update-brew-formula.mts`
- `cli/src/acp/ACPHostBridgeClientProvider.ts`
- `cli/src/acp/ACPTextFileAccess.ts`
- `cli/src/acp/AcpAgent.ts`
- `cli/src/acp/AcpTerminalManager.ts`
- `cli/src/acp/acp-session-pins.ts`
- `cli/src/acp/acp-session-runtime-config.ts`
- `cli/src/acp/acp-session-tasks.ts`
- `cli/src/acp/acp-session-updates.ts`
- `cli/src/acp/acp-session-worktrees.ts`
- `cli/src/acp/active-session.ts`
- `cli/src/acp/detachedServer.ts`
- `cli/src/acp/index.ts`
- `cli/src/acp/streamUtils.ts`
- `cli/src/agent/AcpAuthenticationManager.ts`
- `cli/src/agent/AcpProviderSetup.ts`
- `cli/src/agent/DiracAgent.ts`
- `cli/src/agent/DiracSessionEmitter.ts`
- `cli/src/agent/browserActionTranslator.ts`
- `cli/src/agent/diffUtils.ts`
- `cli/src/agent/messageTranslator.ts`
- `cli/src/agent/permissionHandler.ts`
- `cli/src/agent/promptContent.ts`
- `cli/src/agent/providerConfiguration.ts`
- `cli/src/agent/public-types.ts`
- `cli/src/agent/questionCard.ts`
- `cli/src/agent/review.ts`
- `cli/src/agent/sessionConfig.ts`
- `cli/src/agent/sessionHistory.ts`
- `cli/src/agent/taskMessageBridge.ts`
- `cli/src/commands/auth.ts`
- `cli/src/commands/config.ts`
- `cli/src/commands/history.ts`
- `cli/src/commands/kanban.ts`
- `cli/src/commands/resume.ts`
- `cli/src/commands/task.ts`
- `cli/src/commands/tools.ts`
- `cli/src/commands/welcome.ts`
- `cli/src/components/ActionButtons.tsx`
- `cli/src/components/AgentPanelContent.tsx`
- `cli/src/components/ApiKeyInput.tsx`
- `cli/src/components/App.tsx`
- `cli/src/components/AsciiMotionCli.tsx`
- `cli/src/components/AuthView.tsx`
- `cli/src/components/BedrockCustomModelFlow.tsx`
- `cli/src/components/BedrockSetup.tsx`
- `cli/src/components/ChatFooter.tsx`
- `cli/src/components/ChatHeader.tsx`
- `cli/src/components/ChatInputBar.tsx`
- `cli/src/components/ChatMessage.tsx`
- `cli/src/components/ChatView.tsx`
- `cli/src/components/Checkbox.tsx`
- `cli/src/components/ConfigView.tsx`
- `cli/src/components/ConfigViewComponents.tsx`
- `cli/src/components/ConfigViewWrapper.tsx`
- `cli/src/components/ErrorBoundary.tsx`
- `cli/src/components/FileMentionMenu.tsx`
- `cli/src/components/GithubAuthView.tsx`
- `cli/src/components/GoalSummary.tsx`
- `cli/src/components/HelpPanelContent.tsx`
- `cli/src/components/HighlightedInput.tsx`
- `cli/src/components/HistoryPanelContent.tsx`
- `cli/src/components/HistoryView.tsx`
- `cli/src/components/ImportView.tsx`
- `cli/src/components/LanguagePicker.tsx`
- `cli/src/components/ModelPicker.tsx`
- `cli/src/components/OpenAiCodexAuthView.tsx`
- `cli/src/components/OpenAiCodexUsagePanel.tsx`
- `cli/src/components/Panel.tsx`
- `cli/src/components/PermissionModal.tsx`
- `cli/src/components/ProviderPicker.tsx`
- `cli/src/components/SearchableList.tsx`
- `cli/src/components/SkillsPanelContent.tsx`
- `cli/src/components/SlashCommandMenu.tsx`
- `cli/src/components/Spinner.tsx`
- `cli/src/components/ThinkingIndicator.tsx`
- `cli/src/components/UnbiasedAuthView.tsx`
- `cli/src/components/modular-ui/CardBody.tsx`
- `cli/src/components/modular-ui/CardHeader.tsx`
- `cli/src/components/modular-ui/CardInteractions.tsx`
- `cli/src/components/modular-ui/Diff.tsx`
- `cli/src/components/modular-ui/Markdown.tsx`
- `cli/src/components/modular-ui/ModularCard.tsx`
- `cli/src/components/modular-ui/TaskCompletionCard.tsx`
- `cli/src/components/modular-ui/TaskStatusIndicator.tsx`
- `cli/src/components/settings/SettingsHomeView.tsx`
- `cli/src/components/settings/SettingsListView.tsx`
- `cli/src/components/settings/SettingsPanelContent.tsx`
- `cli/src/components/settings/SettingsSearchView.tsx`
- `cli/src/components/settings/UserApprovedCommandsPage.tsx`
- `cli/src/components/settings/constants.ts`
- `cli/src/components/settings/hooks/useAuthStatus.ts`
- `cli/src/components/settings/hooks/useSettingsActions.ts`
- `cli/src/components/settings/hooks/useSettingsItems.ts`
- `cli/src/components/settings/navigation.ts`
- `cli/src/components/settings/settingsTransaction.ts`
- `cli/src/components/settings/subpages/AuthPages.tsx`
- `cli/src/components/settings/subpages/EditPages.tsx`
- `cli/src/components/settings/subpages/OpenRouterRoutingPage.tsx`
- `cli/src/components/settings/subpages/PickerPages.tsx`
- `cli/src/components/settings/subpages/SetupPages.tsx`
- `cli/src/components/settings/types.ts`
- `cli/src/components/settings/utils.ts`
- `cli/src/constants/colors.ts`
- `cli/src/constants/logo.ts`
- `cli/src/constants/theme.ts`
- `cli/src/context/StdinContext.tsx`
- `cli/src/context/TaskContext.tsx`
- `cli/src/controllers/CliCommentReviewController.ts`
- `cli/src/controllers/CliWebviewProvider.ts`
- `cli/src/controllers/index.ts`
- `cli/src/hooks/useChatFooterStatus.ts`
- `cli/src/hooks/useChatInputHandler.ts`
- `cli/src/hooks/useChatMessages.ts`
- `cli/src/hooks/useChatTask.ts`
- `cli/src/hooks/useChatTimeline.ts`
- `cli/src/hooks/useComposer.ts`
- `cli/src/hooks/useHomeEndKeys.ts`
- `cli/src/hooks/useOcaAuth.ts`
- `cli/src/hooks/usePromptHistory.ts`
- `cli/src/hooks/useRawBackspaceKeys.ts`
- `cli/src/hooks/useScrollableList.ts`
- `cli/src/hooks/useTerminalSize.ts`
- `cli/src/hooks/useTextInput.ts`
- `cli/src/hooks/useTranscriptPartition.ts`
- `cli/src/hooks/useVimInput.ts`
- `cli/src/index.ts`
- `cli/src/init.ts`
- `cli/src/initCoreServices.ts`
- `cli/src/types.ts`
- `cli/src/utils/DiffComputer.ts`
- `cli/src/utils/acp-file-logger.ts`
- `cli/src/utils/action-buttons.ts`
- `cli/src/utils/auth.ts`
- `cli/src/utils/browser.ts`
- `cli/src/utils/card-body.ts`
- `cli/src/utils/chat-layout.ts`
- `cli/src/utils/chat.ts`
- `cli/src/utils/cleanup.ts`
- `cli/src/utils/clipboard-image.ts`
- `cli/src/utils/color.ts`
- `cli/src/utils/command-parsers.ts`
- `cli/src/utils/console.ts`
- `cli/src/utils/cursor.ts`
- `cli/src/utils/diff-layout.ts`
- `cli/src/utils/display.ts`
- `cli/src/utils/errors.ts`
- `cli/src/utils/file-search.ts`
- `cli/src/utils/fuzzy-search.ts`
- `cli/src/utils/git.ts`
- `cli/src/utils/goals.ts`
- `cli/src/utils/icon-mapping.ts`
- `cli/src/utils/import-configs.ts`
- `cli/src/utils/ink.ts`
- `cli/src/utils/input-layout.ts`
- `cli/src/utils/input-viewport.ts`
- `cli/src/utils/input.ts`
- `cli/src/utils/markdown.ts`
- `cli/src/utils/mode-selection.ts`
- `cli/src/utils/mode.ts`
- `cli/src/utils/model-metadata.ts`
- `cli/src/utils/model-selection.ts`
- `cli/src/utils/openrouter-models.ts`
- `cli/src/utils/options.ts`
- `cli/src/utils/output-channel.ts`
- `cli/src/utils/parser.ts`
- `cli/src/utils/path.ts`
- `cli/src/utils/piped.ts`
- `cli/src/utils/plain-text-task.ts`
- `cli/src/utils/provider-config.ts`
- `cli/src/utils/providers.ts`
- `cli/src/utils/quiet-mode.ts`
- `cli/src/utils/shutdown.ts`
- `cli/src/utils/slash-commands.ts`
- `cli/src/utils/spinner-activity.ts`
- `cli/src/utils/standalone-card-policy.ts`
- `cli/src/utils/state.ts`
- `cli/src/utils/task-history.ts`
- `cli/src/utils/task-start-output.ts`
- `cli/src/utils/task-timeout.ts`
- `cli/src/utils/terminal-link.ts`
- `cli/src/utils/text-clipping.ts`
- `cli/src/utils/timeline-rows.ts`
- `cli/src/utils/tool-options.ts`
- `cli/src/utils/update.ts`
- `cli/src/utils/vim-editor.ts`
- `cli/src/vscode-context.ts`
- `private/plans/scc-prototype.mjs`
- `src/core/api/index.ts`
- `src/core/api/providers/unbiased.ts`
- `src/core/api/unbiased/unbiased-models.ts`
- `src/core/controller/models/authenticateUnbiased.ts`
- `src/core/controller/models/refreshUnbiasedModelsRpc.ts`
- `src/core/controller/models/signOutUnbiased.ts`
- `src/core/controller/state/checkCliInstallation.ts`
- `src/core/controller/state/installDiracCli.ts`
- `src/core/controller/state/settingsCli.ts`
- `src/core/controller/state/settingsMode.ts`
- `src/core/controller/state/settingsTelemetry.ts`
- `src/core/controller/state/updateCliBannerVersion.ts`
- `src/core/controller/state/updateSettingsCli.ts`
- `src/core/task/utils.ts`
- `src/integrations/unbiased/device-auth.ts`
- `src/integrations/unbiased/oauth-account.ts`
- `src/utils/cli-detector.ts`

