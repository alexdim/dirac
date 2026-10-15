---
component_id: 6
component_name: Workspace, Tool Registry & Subagent Execution
---

# Workspace, Tool Registry & Subagent Execution

## Component Description

Manages multi-root workspace resolution, file context tracking, task controller dispatch, tool registry lifecycle, and subagent execution.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/task/TaskController.ts (lines 64-495)
```
export class TaskController {
	private _task?: Task
	private _workspaceManager?: WorkspaceRootManager
	private _backgroundCommandRunning = false
	private _backgroundCommandTaskId?: string
	private cancelInProgress = false
	private _taskRunPromise?: Promise<void>
	private readonly taskReplacementListeners = new Set<(taskId: string) => void | Promise<void>>()
	private currentConversationUlid?: string
	private currentInitializationOptions?: TaskInitializationOptions

	// Promise for the in-flight task run; consumed via Controller.taskRunPromise (from main).
	get taskRunPromise(): Promise<void> | undefined {
		return this._taskRunPromise
	}

	constructor(
		private readonly deps: ITaskControllerDependencies,
		private readonly acquireTaskLockFn: typeof acquireTaskLock = acquireTaskLock,
		private readonly setupWorkspaceManagerFn: typeof setupWorkspaceManager = setupWorkspaceManager,
		private readonly detectRootsFn: typeof detectWorkspaceRoots = detectWorkspaceRoots,
		private readonly getCwdFn: (defaultDir: string) => Promise<string> = getCwd,
		private readonly getDesktopDirFn: () => string = getDesktopDir,
		private readonly cleanupLegacyCheckpointsFn: () => Promise<void> = cleanupLegacyCheckpoints,
		private readonly cancelBackgroundCommandFn: () => Promise<boolean>,
	) {
		this._task = deps.task
		this._workspaceManager = deps.workspaceManager
	}

	get task(): Task | undefined {
		return this._task
	}

	set task(value: Task | undefined) {
		this._task = value
	}

	get workspaceManager(): WorkspaceRootManager | undefined {
		return this._workspaceManager
	}

	set workspaceManager(value: WorkspaceRootManager | undefined) {
		this._workspaceManager = value
	}

	get backgroundCommandRunning() {
		return this._backgroundCommandRunning
	}

	get backgroundCommandTaskId() {
		return this._backgroundCommandTaskId
	}

	onTaskReplaced(listener: (taskId: string) => void | Promise<void>): () => void {
		this.taskReplacementListeners.add(listener)
		return () => this.taskReplacementListeners.delete(listener)
	}

	/** Return a live task ready for follow-up input, restoring ended runs without losing their conversation. */
	async prepareTaskForFollowUp(initializationOptions?: TaskInitializationOptions): Promise<Task> {
		const task = this._task
		if (!task) throw new Error("No task available for follow-up")

		// Completion output can reach the client before the loop clears its previous response.
		if (task.stateView.didAttemptCompletion && !task.stateView.runOutcome) {
			await pWaitFor(
				() =>
					this._task !== task ||
					task.stateView.runOutcome !== undefined ||
					task.stateView.status === TaskStatus.COMPLETED ||
					task.stateView.status === TaskStatus.AWAITING_USER_INPUT,
				{ interval: 10 },
			)
		}
		if (this._task !== task) throw new Error(`Task ${task.taskId} changed while preparing a follow-up`)

		const waitingForInput =
			task.stateView.status === TaskStatus.COMPLETED ||
			task.stateView.status === TaskStatus.CANCELLED ||
			task.stateView.status === TaskStatus.AWAITING_USER_INPUT
		if (!task.stateView.runOutcome && waitingForInput) return task

		await this.reinitExistingTaskFromId(task.taskId, initializationOptions)
		if (!this._task) throw new Error(`Task ${task.taskId} was not restored for follow-up`)
		return this._task
	}

	private reconstructionInitializationOptions(task: Task): TaskInitializationOptions {
		const {
			runtimeConfigurationOverrides: _runtimeOverrides,
			workingConfiguration: _workingConfiguration,
			...callbacks
		} = this.currentInitializationOptions ?? {}
		return {
			...callbacks,
			workingConfiguration: task.getWorkingConfiguration(),
		}
	}

	private async runTaskWithReplacement(task: Task, run: Promise<TaskRunOutcome>): Promise<void> {
		let runFailure: { error: unknown } | undefined
		try {
			await run
		} catch (error) {
			runFailure = { error }
		}

		const replacement = task.stateView.pendingTaskReplacement
		if (this._task !== task || !replacement) {
			if (runFailure) throw runFailure.error
			return
		}

		if (runFailure) {
			Logger.warn("Old task run failed while starting an approved replacement", runFailure.error)
		}

		const taskId = await this.initTask(
			replacement.context,
			replacement.images,
			replacement.files,
			undefined,
			undefined,
			this.currentConversationUlid,
			undefined,
			this.reconstructionInitializationOptions(task),
		)
		task.taskState.pendingTaskReplacement = undefined
		await Promise.all([...this.taskReplacementListeners].map((listener) => listener(taskId)))
		await this._taskRunPromise
	}

	private trackTaskRun(run: Promise<void>): void {
		this._taskRunPromise = run
		void run.catch((error) => Logger.error("Task run failed", error))
	}

	private async startHistoricalTaskAndWaitForRestore(task: Task): Promise<void> {
		let didRestore = false
		let resolveRestore!: () => void
		let rejectRestore!: (reason?: unknown) => void
		const restored = new Promise<void>((resolve, reject) => {
			resolveRestore = resolve
			rejectRestore = reject
		})

		const taskRun = task.resumeTaskFromHistory(() => {
			didRestore = true
			resolveRestore()
		})
		const run = this.runTaskWithReplacement(task, taskRun)
		this.trackTaskRun(run)
		void taskRun.then(
			(outcome) => {
				if (didRestore) return
				if (outcome.kind === "failed") {
					rejectRestore(deserializeTaskError(outcome.error))
					return
				}
				rejectRestore(new Error(`Task ${task.taskId} ended before its history was restored`))
			},
			(error) => rejectRestore(error),
		)

		try {
			await pTimeout(restored, {
				milliseconds: HISTORICAL_TASK_RESTORE_TIMEOUT_MS,
				message: `Task ${task.taskId} history restoration timed out after ${HISTORICAL_TASK_RESTORE_TIMEOUT_MS / 1_000} seconds`,
			})
			if (this._task !== task) {
				throw new Error(`Task ${task.taskId} was replaced before its history finished restoring`)
			}
		} catch (error) {
			if (this._task === task) {
				const abort = task.abortTask()
				void abort.catch((abortError) =>
					Logger.error(`Failed to abort task ${task.taskId} after history restoration failed`, abortError),
				)
				try {
					await pTimeout(this.clearTask(), {
						milliseconds: HISTORICAL_TASK_CLEANUP_TIMEOUT_MS,
						message: `Timed out while clearing task ${task.taskId} after history restoration failed`,
					})
				} catch (cleanupError) {
					Logger.error(`Failed to clear task ${task.taskId} after history restoration failed`, cleanupError)
					if (this._task === task) this._task = undefined
				}
			}
			throw error
		}
	}

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
		conversationUlid?: string,
		_watcherFactory?: any,
		initializationOptions?: TaskInitializationOptions,
	): Promise<string> {
		if (!this.deps.controller) {
			throw new Error("TaskController.initTask requires a Controller instance")
		}
		const controller = this.deps.controller
		const taskId = historyItem?.id || Date.now().toString()
		// Same-ID reconstruction must retire our current writer before reacquiring ownership.
		if (this._task?.taskId === taskId) await this.clearTask()
		const releaseTaskLock = await this.acquireTaskLockFn(getTaskDirectoryPath(taskId))

		try {
			await this.clearTask()
			this.currentConversationUlid = conversationUlid
			this.currentInitializationOptions = initializationOptions
			this.deps.stateManager.refreshModelProviderPresetsFromDisk()

			const isNewUser = this.deps.stateManager.getGlobalStateKey("isNewUser")
			const taskHistory = this.deps.stateManager.getGlobalStateKey("taskHistory")
			const NEW_USER_TASK_COUNT_THRESHOLD = 10
			if (isNewUser && !historyItem && taskHistory && taskHistory.length >= NEW_USER_TASK_COUNT_THRESHOLD) {
				this.deps.stateManager.setGlobalState("isNewUser", false)
				await this.deps.postStateToWebview()
			}

			this._workspaceManager = this.deps.workspaceCwd
				? await controller.ensureWorkspaceManager()
				: await this.setupWorkspaceManagerFn({
						stateManager: this.deps.stateManager,
						detectRoots: this.detectRootsFn,
					})
			if (!this._workspaceManager) {
				throw new Error("TaskController.initTask could not initialize a workspace manager")
			}
			const cwd = this._workspaceManager.getPrimaryRoot()?.path || (await this.getCwdFn(this.getDesktopDirFn()))
			await this.deps.stateManager.loadTaskSettings(taskId)
			if (taskSettings) {
				this.deps.stateManager.setTaskSettingsBatch(taskId, taskSettings)
			}

			const suppliedWorkingConfiguration = initializationOptions?.workingConfiguration
			const workingConfiguration: TaskWorkingConfiguration = suppliedWorkingConfiguration
				? createTaskWorkingConfiguration({
						revision: suppliedWorkingConfiguration.revision,
						settings: suppliedWorkingConfiguration.settings as Settings,
						apiConfiguration: structuredClone(
							suppliedWorkingConfiguration.apiConfiguration,
						) as TaskWorkingConfigurationInput["apiConfiguration"],
						workspaceConfiguration: structuredClone(
							suppliedWorkingConfiguration.workspaceConfiguration,
						) as TaskWorkingConfigurationInput["workspaceConfiguration"],
						executionOptions: structuredClone(
							suppliedWorkingConfiguration.executionOptions,
						) as TaskWorkingConfigurationInput["executionOptions"],
					})
				: this.deps.stateManager.captureEffectiveTaskConfiguration(initializationOptions?.runtimeConfigurationOverrides)
			const { settings, executionOptions } = workingConfiguration

			this._task = new Task({
				controller,
				updateTaskHistory: (historyItem) => this.deps.updateTaskHistory(historyItem),
				postStateToWebview: () => this.deps.postStateToWebview(),
				postPresentationToWebview: () => (this.deps.postPresentationToWebview ?? this.deps.postStateToWebview)(),
				reinitExistingTaskFromId: (taskId) => this.reinitExistingTaskFromId(taskId),
				cancelTask: () => this.cancelTask(),
				shellIntegrationTimeout: settings.shellIntegrationTimeout,
				terminalReuseEnabled: executionOptions.terminalReuseEnabled,
				terminalOutputLineLimit: settings.terminalOutputLineLimit,
				defaultTerminalProfile: settings.defaultTerminalProfile,
				vscodeTerminalExecutionMode: executionOptions.vscodeTerminalExecutionMode,
				cwd,
				stateManager: this.deps.stateManager,
				workingConfiguration,
				workspaceManager: this._workspaceManager,
				task,
				images,
				files,
				historyItem,
				taskId,
				conversationUlid,
				releaseTaskLock,
				pinnedContext: initializationOptions?.pinnedContext,
				onContextCompacted: initializationOptions?.onContextCompacted,
				switchToActMode: initializationOptions?.switchToActMode,
				toolSelectionPolicy: initializationOptions?.toolSelectionPolicy,
				enqueuePreRequestSteeringMessages: async () => initializationOptions?.enqueueSteeringMessages?.(this._task!),
			})
		} catch (error) {
			await releaseTaskLock()
			throw error
		}

		this.currentConversationUlid = this._task.ulid
		if (historyItem) {
			await this.startHistoricalTaskAndWaitForRestore(this._task)
		} else if (task || images || files) {
			this.trackTaskRun(this.runTaskWithReplacement(this._task, this._task.startTask(task, images, files)))
		} else {
			this._taskRunPromise = undefined
		}
		return this._task.taskId
	}

	async reinitExistingTaskFromId(taskId: string, initializationOptions?: TaskInitializationOptions) {
		const effectiveInitializationOptions =
			initializationOptions ??
			(this._task ? this.reconstructionInitializationOptions(this._task) : this.currentInitializationOptions)
		const history = await this.deps.getTaskWithId(taskId)
		if (history) {
			await this.initTask(
				undefined,
				undefined,
				undefined,
				history.historyItem,
				undefined,
				this.currentConversationUlid,
				undefined,
				effectiveInitializationOptions,
			)
		}
	}

	async cancelTask() {
		if (this.cancelInProgress) {
			Logger.log(`[Controller.cancelTask] Cancellation already in progress, ignoring duplicate request`)
			return
		}

		if (!this._task) {
			return
		}
		const task = this._task

		this.cancelInProgress = true

		try {
			this.updateBackgroundCommandState(false)

			try {
				await task.abortTask()
			} catch (error) {
				Logger.error("Failed to abort task", error)
			}
			if (this._task !== task) return

			await pWaitFor(
				() =>
					task.stateView.isApiRequestActive === false ||
					task.stateView.didFinishAbortingStream ||
					task.stateView.isWaitingForFirstChunk,
				{
					timeout: 3_000,
				},
			).catch(() => {
				Logger.error("Failed to abort task")
			})
			if (this._task !== task) return

			task.taskState.abandoned = true

			let historyItem: HistoryItem | undefined
			try {
				const result = await this.deps.getTaskWithId(task.taskId)
				historyItem = result.historyItem
			} catch (error) {
				Logger.log(`[Controller.cancelTask] Task not found in history: ${error}`)
			}
			if (this._task !== task) return

			if (historyItem) {
				await this.initTask(
					undefined,
					undefined,
					undefined,
					historyItem,
					undefined,
					this.currentConversationUlid,
					undefined,
					this.reconstructionInitializationOptions(task),
				)
			} else {
				await this.clearTask()
			}

			await this.deps.postStateToWebview()
		} finally {
			this.cancelInProgress = false
		}
	}

	updateBackgroundCommandState(running: boolean, taskId?: string) {
		const nextTaskId = running ? taskId : undefined
		if (this._backgroundCommandRunning === running && this._backgroundCommandTaskId === nextTaskId) {
			return
		}
		this._backgroundCommandRunning = running
		this._backgroundCommandTaskId = nextTaskId
		void this.deps.postStateToWebview()
	}

	async cancelBackgroundCommand(): Promise<void> {
		// Prefer the live task's executor; the injected fn is an init-time no-op placeholder.
		const didCancel = (await this._task?.cancelBackgroundCommand()) ?? (await this.cancelBackgroundCommandFn())
		if (!didCancel) {
			this.updateBackgroundCommandState(false)
		}
	}

	async clearTask() {
		const task = this._task
		if (task) {
			await this.deps.clearTaskSettings()
			let abortFailure: unknown
			try {
				await task.abortTask()
			} catch (error) {
				abortFailure = error
			}
			try {
				await task.retirePersistence()
			} catch (error) {
				if (abortFailure) throw new AggregateError([abortFailure, error], "Task abort and persistence retirement failed")
				throw error
			}
			if (abortFailure) throw abortFailure
		}
		if (this._task === task) {
			this._task = undefined
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/tools/registry/ToolRegistry.ts (lines 71-680)
```
export class ToolRegistry {
	private static readonly accessMutex = new Mutex()
	private static instance: ToolRegistry | undefined
	private builtinTools: Map<string, DiscoveredTool> = new Map()
	private userTools: Map<string, DiscoveredTool> = new Map()
	private workspaceToolsByRoot: Map<string, Map<string, DiscoveredTool>> = new Map()
	private taskToolsByOwner: Map<string, Map<string, DiscoveredTool>> = new Map()
	private defaultWorkspaceKey = ""
	private enabledOverrides: Map<string, boolean> = new Map()
	private _version = 0

	static getInstance(): ToolRegistry {
		if (!this.instance) {
			this.instance = new ToolRegistry()
		}
		return this.instance
	}

	/** Serialize every production mutation and Task inventory capture of the process-global registry. */
	static async withExclusiveAccess<T>(operation: (registry: ToolRegistry) => T | Promise<T>): Promise<T> {
		return this.accessMutex.withLock(async () => operation(this.getInstance()))
	}

	/** Reset singleton (for testing) */
	static resetInstance(): void {
		this.instance = undefined
	}

	register(tool: DiscoveredTool): void {
		if (tool.source === "builtin") {
			this.registerBuiltin(tool)
			return
		}
		this.registerUserTool(tool)
	}

	getVersion(): number {
		return this._version
	}

	registerBuiltin(tool: DiscoveredTool): void {
		this.builtinTools.set(tool.id, tool)
	}

	registerUserTool(tool: DiscoveredTool, workspaceRoot?: string): boolean {
		if (tool.source === "task") {
			if (!tool.ownerTaskId) throw new Error(`Task tool '${tool.id}' is missing its owner Task id.`)
			return this.registerTaskTool(tool.ownerTaskId, tool)
		}
		if (tool.source === "workspace") {
			const tools = workspaceRoot === undefined ? this.workspaceToolsForModule(tool.modulePath) : this.workspaceToolsForRoot(workspaceRoot)
			return this.registerSharedUserTool(tools, tool)
		}
		return this.registerSharedUserTool(this.userTools, tool)
	}

	/**
	 * Atomically adds or replaces the effective user tool. Existing toggle state
	 * is preserved on replacement; enableIfNew applies only when no tool exists.
	 */
	replaceUserTool(tool: DiscoveredTool, enableIfNew = false, workspaceRoot?: string): boolean {
		return this.replaceUserToolWithResult(tool, enableIfNew, workspaceRoot).replaced
	}

	/** Replace a user tool and report whether this operation enabled a newly inserted shared tool. */
	replaceUserToolWithResult(
		tool: DiscoveredTool,
		enableIfNew = false,
		workspaceRoot?: string,
	): UserToolReplacementResult {
		if (tool.source === "task") {
			if (!tool.ownerTaskId) throw new Error(`Task tool '${tool.id}' is missing its owner Task id.`)
			const ownerTools = this.taskToolsByOwner.get(tool.ownerTaskId)
			const previousTool = ownerTools ? this.findToolByCollision(ownerTools.values(), tool) : undefined
			return {
				replaced: this.replaceTaskTool(tool.ownerTaskId, tool),
				enabledNewTool: false,
				previousTool,
			}
		}
		const tools =
			tool.source === "workspace"
				? workspaceRoot === undefined
					? this.workspaceToolsForModule(tool.modulePath)
					: this.workspaceToolsForRoot(workspaceRoot)
				: this.userTools
		return this.replaceSharedUserTool(tools, tool, enableIfNew)
	}

	/** Reconcile global and one workspace's tools without replacing another workspace's inventory. */
	reconcileWorkspaceUserTools(
		discoveredTools: DiscoveredTool[],
		forceVersionBump = false,
		workspaceRoot?: string,
	): boolean {
		const nextGlobalTools = new Map<string, DiscoveredTool>()
		const nextWorkspaceTools = new Map<string, DiscoveredTool>()
		for (const tool of discoveredTools) {
			this.registerUserToolInto(tool.source === "workspace" ? nextWorkspaceTools : nextGlobalTools, tool)
		}

		const workspaceKey = this.workspaceKey(workspaceRoot)
		this.defaultWorkspaceKey = workspaceKey
		const currentWorkspaceTools = this.workspaceToolsByRoot.get(workspaceKey) ?? new Map<string, DiscoveredTool>()
		const changed =
			!this.sameToolInventory(this.userTools, nextGlobalTools) ||
			!this.sameToolInventory(currentWorkspaceTools, nextWorkspaceTools)
		if (!changed) {
			if (forceVersionBump) this._version++
			return forceVersionBump
		}

		this.userTools = nextGlobalTools
		if (nextWorkspaceTools.size === 0) this.workspaceToolsByRoot.delete(workspaceKey)
		else this.workspaceToolsByRoot.set(workspaceKey, nextWorkspaceTools)
		this._version++
		return true
	}

	reconcileTaskTools(ownerTaskId: string, discoveredTools: DiscoveredTool[]): string[] {
		const nextTools = new Map<string, DiscoveredTool>()
		for (const tool of discoveredTools) {
			if (tool.ownerTaskId !== ownerTaskId) throw new Error(`Task tool '${tool.id}' has the wrong owner Task id.`)
			if (this.collidesWithBuiltin(tool)) continue
			if (this.findToolByCollision(nextTools.values(), tool)) continue
			nextTools.set(tool.id, tool)
		}
		const currentTools = this.taskToolsByOwner.get(ownerTaskId) ?? new Map<string, DiscoveredTool>()
		if (!this.sameToolInventory(currentTools, nextTools)) {
			if (nextTools.size === 0) this.taskToolsByOwner.delete(ownerTaskId)
			else this.taskToolsByOwner.set(ownerTaskId, nextTools)
			this._version++
		}
		return [...nextTools.keys()]
	}

	hasBuiltinTools(): boolean {
		return this.builtinTools.size > 0
	}

	enable(toolId: string): void {
		this.assertConfigurable(toolId)
		this.enabledOverrides.set(toolId, true)
	}

	disable(toolId: string): void {
		this.assertConfigurable(toolId)
		this.enabledOverrides.set(toolId, false)
	}

	isEnabled(toolId: string): boolean {
		const tool = this.getTool(toolId)
		if (!tool || tool.executable === false || tool.exposure.kind === "skill_only") return false

		const override = this.enabledOverrides.get(toolId)
		if (override !== undefined) {
			return override
		}
		return tool.source === "builtin"
	}

	getEnabledTools(ownerTaskId?: string, workspaceRoot?: string): DiscoveredTool[] {
		const tools = arguments.length >= 2 ? this.getAllTools(ownerTaskId, workspaceRoot) : this.getAllTools(ownerTaskId)
		return tools.filter((tool) => this.isEnabledTool(tool))
	}

	getEnabledSpecs(context: SystemPromptContext): DiracToolSpec[] {
		return this.getEnabledTools()
			.map((t) => t.spec)
			.filter((spec) => !spec.contextRequirements || spec.contextRequirements(context))
	}

	getEnabledSpecsForSubagent(context: SystemPromptContext, allowed: string[]): DiracToolSpec[] {
		return this.getEnabledTools()
			.map((tool) => this.scopeToolForSubagent(tool, allowed))
			.filter((tool): tool is DiscoveredTool => Boolean(tool))
			.map((tool) => tool.spec)
			.filter((spec) => !spec.contextRequirements || spec.contextRequirements(context))
	}

	getAllTools(ownerTaskId?: string, workspaceRoot?: string): DiscoveredTool[] {
		const globalTools = [...this.builtinTools.values(), ...this.userTools.values()]
		const workspaceKey = arguments.length >= 2 ? this.workspaceKey(workspaceRoot) : this.defaultWorkspaceKey
		const workspaceTools = this.workspaceToolsByRoot.get(workspaceKey)?.values() ?? []
		const sharedTools = this.overlayTaskTools(globalTools, workspaceTools)
		if (!ownerTaskId) return sharedTools
		return this.overlayTaskTools(sharedTools, this.taskToolsByOwner.get(ownerTaskId)?.values() ?? [])
	}

	getKnownUserToolIds(): string[] {
		const ids = new Set(this.userTools.keys())
		for (const tools of this.workspaceToolsByRoot.values()) {
			for (const id of tools.keys()) ids.add(id)
		}
		for (const tools of this.taskToolsByOwner.values()) {
			for (const id of tools.keys()) ids.add(id)
		}
		return [...ids]
	}

	getConfigurableTools(ownerTaskId?: string, workspaceRoot?: string): DiscoveredTool[] {
		const tools =
			arguments.length >= 2 ? this.getAllTools(ownerTaskId, workspaceRoot) : this.getAllTools(ownerTaskId)
		return tools.filter((tool) => tool.exposure.kind === "configurable")
	}

	resolveSkillDependencyTools(
		activeSkills: readonly SkillMetadata[],
		ownerTaskId?: string,
		workspaceRoot?: string,
	): DiscoveredTool[] {
		const resolved = new Map<string, DiscoveredTool>()
		const scopedTools = this.getAllTools(ownerTaskId, workspaceRoot)

		for (const skill of activeSkills) {
			if (skill.source !== "builtin") continue
			for (const toolId of skill.toolDependencies ?? []) {
				const tool = scopedTools.find(
					(candidate) =>
						candidate.id === toolId || candidate.name === toolId || candidate.spec.name === toolId,
				)
				if (!tool) throw new Error(`Built-in skill '${skill.name}' depends on missing tool '${toolId}'.`)
				if (tool.exposure.kind !== "skill_only") {
					throw new Error(`Built-in skill '${skill.name}' declares non-skill-only dependency '${toolId}'.`)
				}
				if (!tool.exposure.authorizedSkillIds.includes(skill.name)) {
					throw new Error(`Skill '${skill.name}' is not authorized to activate tool '${toolId}'.`)
				}
				resolved.set(tool.id, tool)
			}
		}

		return [...resolved.values()]
	}

	getToolsBySource(source: ToolSource): DiscoveredTool[] {
		return this.getAllTools().filter((t) => t.source === source)
	}

	createEnabledTools(config: TaskConfig): IDiracTool[] {
		return this.getEnabledTools().map((t) => t.factory(config))
	}

	createEnabledToolsForSubagent(config: TaskConfig, allowed: string[]): IDiracTool[] {
		return this.getEnabledTools()
			.map((tool) => this.scopeToolForSubagent(tool, allowed))
			.filter((tool): tool is DiscoveredTool => Boolean(tool))
			.map((tool) => tool.factory(config))
	}

	/** Restore the registry entry replaced by an upsert, or remove a newly inserted entry. */
	rollbackUserToolReplacement(
		tool: DiscoveredTool,
		previousTool: DiscoveredTool | undefined,
		disableNewTool: boolean,
		workspaceRoot?: string,
	): void {
		if (previousTool) {
			this.replaceUserTool(previousTool, false, workspaceRoot)
			return
		}
		if (tool.source === "task") {
			if (!tool.ownerTaskId) throw new Error(`Task tool '${tool.id}' is missing its owner Task id.`)
			const ownerTools = this.taskToolsByOwner.get(tool.ownerTaskId)
			if (!ownerTools?.delete(tool.id)) return
			if (ownerTools.size === 0) this.taskToolsByOwner.delete(tool.ownerTaskId)
			this._version++
			return
		}
		const tools = tool.source === "workspace" ? this.workspaceToolsForRoot(workspaceRoot) : this.userTools
		if (!tools.delete(tool.id)) return
		if (disableNewTool) this.enabledOverrides.delete(tool.id)
		this._version++
	}

	isToolAllowed(toolName: string, allowed: string[], operation?: string): boolean {
		const tool = this.findToolByIdOrName(toolName)
		if (!tool) {
			return allowed.includes(toolName)
		}
		if (!this.isEnabled(tool.id)) {
			return false
		}
		const authorization = resolveToolAuthorization(tool, allowed)
		return (
			authorization.allowed &&
			(!authorization.operations || (typeof operation === "string" && authorization.operations.includes(operation)))
		)
	}

	scopeToolForSubagent(tool: DiscoveredTool, allowed: readonly string[]): DiscoveredTool | undefined {
		if (tool.exposure.kind === "profile_only") return undefined
		const authorization = resolveToolAuthorization(tool, allowed)
		if (!authorization.allowed) {
			return undefined
		}
		if (!authorization.operations) {
			return tool
		}

		const operations = authorization.operations
		const spec = scopeToolSpec(tool.spec, operations)
		return {
			...tool,
			spec,
			factory: (config?: any) => {
				const original = tool.factory(config)
				const scopedTool: IDiracTool & { bufferPartialToolUse?: (...args: any[]) => Promise<void> } = {
					spec: () => spec,
					supportedSurfaces: () => original.supportedSurfaces(),
					processCall: async (args: any, env: any) => {
						const operation = args?.[ResponseParameter.OPERATION]
						if (typeof operation !== "string" || !operations.includes(operation)) {
							throw new Error(
								`Operation '${typeof operation === "string" ? operation : "<missing>"}' is not authorized for tool '${spec.name}' in this subagent. Allowed operations: ${operations.join(", ")}.`,
							)
						}
						return original.processCall(args, env)
					},
				}
				if ("bufferPartialToolUse" in original && typeof (original as any).bufferPartialToolUse === "function") {
					scopedTool.bufferPartialToolUse = (...args: any[]) => (original as any).bufferPartialToolUse(...args)
				}
				return scopedTool
			},
		}
	}

	loadToggles(toggles: Record<string, boolean>): void {
		const migrated = { ...toggles }
		const legacyNames = Object.keys(LEGACY_RESPONSE_TOOLS)
		if (!(RESPOND_TOOL_NAME in migrated) && legacyNames.some((name) => name in migrated)) {
			migrated[RESPOND_TOOL_NAME] = legacyNames.every((name) => migrated[name] ?? true)
		}
		for (const name of legacyNames) delete migrated[name]
		this.enabledOverrides = new Map(
			Object.entries(migrated).filter(([toolId]) => this.getTool(toolId)?.exposure.kind === "configurable"),
		)
	}

	getToggles(): Record<string, boolean> {
		const result: Record<string, boolean> = {}
		for (const [id, enabled] of this.enabledOverrides) {
			result[id] = enabled
		}
		return result
	}

	/**
	 * Remove non-task user tools from the registry.
	 * Task-scoped tools are runtime state and must survive workspace rescans.
	 * Built-ins are kept in a separate map and cannot be removed here.
	 */
	clearUserTools(): void {
		this.userTools.clear()
		this.workspaceToolsByRoot.clear()
	}

	/** Remove a single shared user tool by id. Task tools are removed by owner. */
	removeUserTool(toolId: string): boolean {
		let removed = this.userTools.delete(toolId)
		for (const [workspaceKey, tools] of this.workspaceToolsByRoot) {
			if (tools.delete(toolId)) removed = true
			if (tools.size === 0) this.workspaceToolsByRoot.delete(workspaceKey)
		}
		if (!removed) return false
		this.enabledOverrides.delete(toolId)
		this._version++
		return true
	}

	removeTaskTools(ownerTaskId: string): boolean {
		if (!this.taskToolsByOwner.delete(ownerTaskId)) return false
		this._version++
		return true
	}

	/** Enable or disable a tool and persist the toggle state to settings. */
	toggleAndPersist(toolId: string, enabled: boolean): void {
		if (enabled) {
			this.enable(toolId)
		} else {
			this.disable(toolId)
		}
		StateManager.get().setGlobalState("toolToggles", this.getToggles())
	}

	private registerSharedUserTool(tools: Map<string, DiscoveredTool>, tool: DiscoveredTool): boolean {
		if (this.collidesWithBuiltin(tool)) {
			Logger.warn(`[ToolRegistry] User tool '${tool.id}' conflicts with built-in tool id/name. Skipping.`)
			return false
		}
		const existing = this.findToolByCollision(tools.values(), tool)
		if (!existing) {
			tools.set(tool.id, tool)
			this._version++
			return true
		}
		if (existing.source === tool.source) return false
		if ((SOURCE_PRIORITY[tool.source] ?? 0) <= (SOURCE_PRIORITY[existing.source] ?? 0)) {
			Logger.warn(
				`[ToolRegistry] User tool '${tool.id}' conflicts with existing tool '${existing.id}' (source: ${existing.source}). Keeping existing.`,
			)
			return false
		}
		tools.delete(existing.id)
		tools.set(tool.id, tool)
		this._version++
		return true
	}

	private replaceSharedUserTool(
		tools: Map<string, DiscoveredTool>,
		tool: DiscoveredTool,
		enableIfNew: boolean,
	): UserToolReplacementResult {
		if (this.collidesWithBuiltin(tool)) {
			Logger.warn(`[ToolRegistry] User tool '${tool.id}' conflicts with built-in tool id/name. Skipping.`)
			return { replaced: false, enabledNewTool: false }
		}
		const existing = this.findToolByCollision(tools.values(), tool)
		if (!existing) {
			tools.set(tool.id, tool)
			if (enableIfNew) this.enabledOverrides.set(tool.id, true)
			this._version++
			return { replaced: true, enabledNewTool: enableIfNew }
		}
		if (existing.source !== tool.source && (SOURCE_PRIORITY[tool.source] ?? 0) <= (SOURCE_PRIORITY[existing.source] ?? 0)) {
			Logger.warn(
				`[ToolRegistry] User tool '${tool.id}' conflicts with existing tool '${existing.id}' (source: ${existing.source}). Keeping existing.`,
			)
			return { replaced: false, enabledNewTool: false }
		}
		const enabledOverride = this.enabledOverrides.get(existing.id)
		tools.delete(existing.id)
		tools.set(tool.id, tool)
		if (existing.id !== tool.id) this.enabledOverrides.delete(existing.id)
		if (enabledOverride !== undefined) this.enabledOverrides.set(tool.id, enabledOverride)
		this._version++
		return { replaced: true, enabledNewTool: false, previousTool: existing }
	}

	private workspaceToolsForRoot(workspaceRoot?: string): Map<string, DiscoveredTool> {
		const key = this.workspaceKey(workspaceRoot)
		this.defaultWorkspaceKey = key
		const tools = this.workspaceToolsByRoot.get(key) ?? new Map<string, DiscoveredTool>()
		this.workspaceToolsByRoot.set(key, tools)
		return tools
	}

	private workspaceToolsForModule(modulePath: string): Map<string, DiscoveredTool> {
		const normalized = path.resolve(modulePath)
		const marker = `${path.sep}.dirac${path.sep}tools${path.sep}`
		const markerIndex = normalized.lastIndexOf(marker)
		const workspaceRoot = markerIndex >= 0 ? normalized.slice(0, markerIndex) : undefined
		return this.workspaceToolsForRoot(workspaceRoot)
	}

	private workspaceKey(workspaceRoot?: string): string {
		return workspaceRoot ? path.resolve(workspaceRoot) : ""
	}

	private registerTaskTool(ownerTaskId: string, tool: DiscoveredTool): boolean {
		if (this.collidesWithBuiltin(tool)) {
			Logger.warn(`[ToolRegistry] Task tool '${tool.id}' conflicts with built-in tool id/name. Skipping.`)
			return false
		}
		const ownerTools = this.taskToolsByOwner.get(ownerTaskId) ?? new Map<string, DiscoveredTool>()
		if (this.findToolByCollision(ownerTools.values(), tool)) return false
		ownerTools.set(tool.id, tool)
		this.taskToolsByOwner.set(ownerTaskId, ownerTools)
		this._version++
		return true
	}

	private replaceTaskTool(ownerTaskId: string, tool: DiscoveredTool): boolean {
		if (this.collidesWithBuiltin(tool)) {
			Logger.warn(`[ToolRegistry] Task tool '${tool.id}' conflicts with built-in tool id/name. Skipping.`)
			return false
		}
		const ownerTools = this.taskToolsByOwner.get(ownerTaskId) ?? new Map<string, DiscoveredTool>()
		const existing = this.findToolByCollision(ownerTools.values(), tool)
		if (existing) ownerTools.delete(existing.id)
		ownerTools.set(tool.id, tool)
		this.taskToolsByOwner.set(ownerTaskId, ownerTools)
		this._version++
		return true
	}

	private overlayTaskTools(sharedTools: DiscoveredTool[], taskTools: Iterable<DiscoveredTool>): DiscoveredTool[] {
		const tools = new Map(sharedTools.map((tool) => [tool.id, tool]))
		for (const taskTool of taskTools) {
			const existing = this.findToolByCollision(tools.values(), taskTool)
			if (existing) tools.delete(existing.id)
			tools.set(taskTool.id, taskTool)
		}
		return [...tools.values()]
	}

	private isEnabledTool(tool: DiscoveredTool): boolean {
		if (tool.exposure.kind === "skill_only") return false
		if (tool.executable === false) return false
		if (tool.exposure.kind === "profile_only") return tool.source === "builtin"
		if (tool.source === "task") return true
		const override = this.enabledOverrides.get(tool.id)
		return override ?? tool.source === "builtin"
	}

	private findToolByCollision(tools: Iterable<DiscoveredTool>, tool: DiscoveredTool): DiscoveredTool | undefined {
		return Array.from(tools).find((candidate) => this.toolsCollide(candidate, tool))
	}

	private registerUserToolInto(tools: Map<string, DiscoveredTool>, tool: DiscoveredTool): boolean {
		if (this.collidesWithBuiltin(tool)) {
			return false
		}

		const existing = Array.from(tools.values()).find((candidate) => this.toolsCollide(candidate, tool))
		if (!existing) {
			tools.set(tool.id, tool)
			return true
		}

		if (existing.source === tool.source) {
			return false
		}

		const existingPriority = SOURCE_PRIORITY[existing.source] ?? 0
		const newPriority = SOURCE_PRIORITY[tool.source] ?? 0
		if (newPriority <= existingPriority) {
			return false
		}

		tools.delete(existing.id)
		tools.set(tool.id, tool)
		return true
	}


	private sameToolInventory(currentTools: Map<string, DiscoveredTool>, nextTools: Map<string, DiscoveredTool>): boolean {
		if (currentTools.size !== nextTools.size) return false
		for (const [id, currentTool] of currentTools) {
			const nextTool = nextTools.get(id)
			if (!nextTool || !this.sameDiscoveredTool(currentTool, nextTool)) return false
		}
		return true
	}

	private sameDiscoveredTool(current: DiscoveredTool, next: DiscoveredTool): boolean {
		if (
			current.id !== next.id ||
			current.name !== next.name ||
			current.source !== next.source ||
			current.modulePath !== next.modulePath ||
			JSON.stringify(current.exposure) !== JSON.stringify(next.exposure) ||
			current.executable !== next.executable
		) {
			return false
		}

		if (current.sourceHash !== undefined || next.sourceHash !== undefined) {
			return current.sourceHash === next.sourceHash
		}

		return current.factory === next.factory && current.spec === next.spec
	}

	private getTool(toolId: string): DiscoveredTool | undefined {
		const defaultWorkspaceTool = this.workspaceToolsByRoot.get(this.defaultWorkspaceKey)?.get(toolId)
		if (defaultWorkspaceTool) return defaultWorkspaceTool
		const globalTool = this.builtinTools.get(toolId) ?? this.userTools.get(toolId)
		if (globalTool) return globalTool
		for (const tools of this.workspaceToolsByRoot.values()) {
			const tool = tools.get(toolId)
			if (tool) return tool
		}
		return undefined
	}

	private assertConfigurable(toolId: string): void {
		const tool = this.getTool(toolId)
		if (!tool || tool.exposure.kind === "configurable") return
		throw new Error(
			`${tool.exposure.kind === "skill_only" ? "Skill-only" : "Profile-only"} tool '${toolId}' cannot be enabled or disabled directly.`,
		)
	}

	private findToolByIdOrName(toolName: string): DiscoveredTool | undefined {
		return this.getAllTools().find((tool) => tool.id === toolName || tool.name === toolName || tool.spec.name === toolName)
	}

	private collidesWithBuiltin(tool: DiscoveredTool): boolean {
		return (
			[...this.toolIdentifiers(tool)].some((id) => id in LEGACY_RESPONSE_TOOLS) ||
			Array.from(this.builtinTools.values()).some((builtin) => this.toolsCollide(builtin, tool))
		)
	}


	private toolIdentifiers(tool: DiscoveredTool): Set<string> {
		return new Set([tool.id, tool.name, tool.spec.name].filter(Boolean))
	}

	private toolsCollide(a: DiscoveredTool, b: DiscoveredTool): boolean {
		const aIds = this.toolIdentifiers(a)
		const bIds = this.toolIdentifiers(b)
		return [...aIds].some((id) => bIds.has(id))
	}

}
```

### /Users/highlands/pools/Development/dirac/src/core/task/tools/subagent/SubagentRunner.ts (lines 58-950)
```
export class SubagentRunner {
	private readonly agent: SubagentBuilder
	private readonly runtime: SubagentRuntime
	private readonly allowedTools: string[]
	private readonly contextBuilder: SubagentContextBuilder
	private readonly abortHandler: SubagentAbortHandler
	private readonly toolExecutor: SubagentToolExecutor
	private activeApiAbort: (() => void) | undefined
	private abortRequested = false
	private abortReason?: string
	private abortingCommands = false
	private activeTaskState?: TaskState
	private activeConversation: DiracStorageMessage[] = []
	private activeStats = createEmptySubagentRunStats()
	private readonly subagentName: string
	private wrapUpRequested = false
	private isWrappingUp = false

	constructor(
		private baseConfig: TaskConfig,
		subagentName = "subagent",
		private readonly options: SubagentBuilderOptions = {},
	) {
		this.agent = new SubagentBuilder(baseConfig, subagentName, options)
		this.subagentName = subagentName
		this.runtime = this.agent.getRuntime()
		this.allowedTools = this.agent.getAllowedTools()
		this.contextBuilder = new SubagentContextBuilder(baseConfig, this.agent, this.allowedTools, this.runtime)
		const logPrefix = `[SubagentRunner:${this.subagentName || "unnamed"}]`
		this.runProgress = new SubagentRunProgress(options.recorder, logPrefix)
		this.runState = new SubagentRunState(baseConfig, this.runProgress)
		this.abortHandler = new SubagentAbortHandler(() => this.abortReason, getBestEffortResult)
		this.toolExecutor = new SubagentToolExecutor(
			(state, coordinator) => this.createSubagentTaskConfig(state, coordinator),
			(name, snap) => this.isAllowedTool(name, snap),
			{
				recordToolCall: (call) =>
					this.runProgress.recordTranscript("tool_call", {
						toolUseId: call.toolUseId,
						id: call.id,
						callId: call.call_id,
						name: call.name,
						input: call.input,
						isNativeToolCall: call.isNativeToolCall,
					}),
				recordToolResult: (call, result) =>
					this.runProgress.recordTranscript("tool_result", {
						toolUseId: call.toolUseId,
						id: call.id,
						callId: call.call_id,
						name: call.name,
						result,
					}),
				recordProgress: (text) => this.runProgress.recordTranscript("progress", { text }),
				markActivity: (action) => this.runState.markActivity(action),
			},
		)
	}

	private getRuntimeProgress(): Pick<
		SubagentProgressUpdate,
		"phase" | "phaseStartedAt" | "lastActivityAt" | "isStalled" | "transcriptPath" | "diagnosticsPath"
	> {
		return this.runState.getRuntimeProgress()
	}

	private getDiagnosticDetails(details: Record<string, unknown> = {}): Record<string, unknown> {
		return this.runState.getDiagnosticDetails(details)
	}

	private enterPhase(phase: SubagentRunPhase, action: string, details: Record<string, unknown> = {}): void {
		this.runState.enterPhase(phase, action, details)
	}

	private markActivity(action: string): void {
		this.runState.markActivity(action)
	}

	private startHeartbeat(): void {
		this.runState.startHeartbeat()
	}

	private recordTranscript(type: SubagentTranscriptEvent["type"], details: Record<string, unknown>): void {
		this.runProgress.recordTranscript(type, details)
	}

	private recordDiagnostic(
		type: SubagentDiagnosticEvent["type"],
		phase: SubagentRunPhase,
		details: Record<string, unknown> = {},
	): void {
		this.runProgress.recordDiagnostic(type, phase, this.runState.getDiagnosticDetails(details))
	}

	private recordTerminal(result: SubagentRunResult): void {
		// Phase transition must happen before the terminal record so progress
		// reports a final "cancelled" (not "cancelling") on timeout/abort.
		this.enterPhase(this.phaseForStatus(result.status), "subagent run settled", { status: result.status })
		this.runProgress.recordTerminal(
			result,
			this.runState.getDiagnosticDetails({
				result: result.result,
				error: result.error,
				stats: result.stats,
				abortReason: this.abortReason,
			}),
		)
	}

	private isAllowedTool(toolName: string, requestSnapshot: ToolRequestSnapshot): boolean {
		return requestSnapshot.coordinator.has(toolName)
	}

	async abort(reason?: string): Promise<void> {
		this.abortRequested = true
		if (reason) {
			this.abortReason = reason
		}
		if (!this.abortReason && this.baseConfig.taskState.abort) {
			this.abortReason = "Subagent run cancelled because the parent task was cancelled."
		}
		this.enterPhase("cancelling", "abort requested", { reason: this.abortReason })
		this.recordDiagnostic("abort_requested", "cancelling", { reason: this.abortReason })
		if (this.activeTaskState) {
			this.activeTaskState.abort = true
		}
		await this.stopActiveWork()
	}

	private async requestWrapUp(): Promise<void> {
		if (this.wrapUpRequested || this.isWrappingUp || this.shouldAbort()) return
		this.wrapUpRequested = true
		this.enterPhase("wrapping_up", "execution deadline reached")
		this.recordTranscript("progress", { text: "Time limit reached. Wrapping up task results." })
		this.recordDiagnostic("abort_requested", "wrapping_up", { reason: "execution deadline reached" })
		this.runProgress.enqueueExecutionProgress({
			...this.getRuntimeProgress(),
			isWrappingUp: true,
			trajectoryEvent: { type: SubagentTrajectoryEventType.MESSAGE, text: "Time limit reached. Wrapping up task results." },
			stats: { ...this.activeStats },
		})
		await this.stopActiveWork()
	}

	private beginWrapUp(conversation: DiracStorageMessage[]): boolean {
		if (!this.wrapUpRequested || this.isWrappingUp) return false
		this.isWrappingUp = true
		this.markActivity("sent wrap-up prompt")
		conversation.push({
			role: "user",
			content: [{ type: "text", text: WRAP_UP_PROMPT } as DiracTextContentBlock],
		})
		return true
	}

	private async stopActiveWork(): Promise<void> {
		try {
			this.activeApiAbort?.()
		} catch (error) {
			Logger.error("[SubagentRunner] failed to abort active API stream", error)
		}

		if (
			this.runState.activeCommandExecutions > 0 &&
			!this.abortingCommands &&
			this.baseConfig.callbacks.cancelRunningCommandTool
		) {
			this.abortingCommands = true
			try {
				await this.baseConfig.callbacks.cancelRunningCommandTool()
			} catch (error) {
				Logger.error("[SubagentRunner] failed to cancel running command execution", error)
			} finally {
				this.abortingCommands = false
			}
		}
	}

	private phaseForStatus(status: SubagentRunStatus): SubagentRunPhase {
		return this.runState.phaseForStatus(status)
	}

	private shouldAbort(): boolean {
		return this.abortRequested || this.baseConfig.taskState.abort
	}

	private async getWorkspaceMetadataEnvironmentBlock(): Promise<string | null> {
		try {
			const workspacesJson =
				(await this.baseConfig.workspaceManager?.buildWorkspacesJson()) ??
				JSON.stringify(
					{
						workspaces: {
							[this.baseConfig.cwd]: {
								hint: path.basename(this.baseConfig.cwd) || this.baseConfig.cwd,
							},
						},
					},
					null,
					2,
				)

			return `<environment_details>\n# Workspace Configuration\n${workspacesJson}\n</environment_details>`
		} catch (error) {
			Logger.warn("[SubagentRunner] Failed to build workspace metadata block", error)
			return null
		}
	}

	async run(
		prompt: string,
		onProgress: (update: SubagentProgressUpdate) => void | Promise<void>,
		timeout?: number,
		includeHistory?: boolean,
	): Promise<SubagentRunResult> {
		// A cancellation received before run() must never be cleared by startup.
		if (this.abortRequested) {
			const result = this.abortHandler.buildAbortResult(this.activeConversation, this.activeStats)
			this.recordTerminal(result)
			void this.runProgress.flush()
			return result
		}

		const timeoutSeconds = resolveSubagentTimeoutSeconds(timeout)
		const logPrefix = `[SubagentRunner:${this.subagentName || "unnamed"}]`
		this.abortRequested = false
		this.abortReason = undefined
		this.wrapUpRequested = false
		this.isWrappingUp = false
		this.activeTaskState = undefined
		this.activeConversation = []
		this.activeStats = createEmptySubagentRunStats()
		this.runState.reset()
		this.runProgress.beginExecution(onProgress)
		this.enterPhase("starting", "subagent run dispatched", { timeoutSeconds, includeHistory: includeHistory === true })
		this.recordTranscript("progress", {
			message: "subagent run dispatched",
			timeoutSeconds,
			includeHistory: includeHistory === true,
		})
		this.startHeartbeat()

		let resolveTermination!: () => void
		const terminationPromise = new Promise<void>((resolve) => {
			resolveTermination = resolve
		})
		let terminationRequested = false
		const requestTermination = (reason: string) => {
			if (terminationRequested) return
			terminationRequested = true
			void this.abort(reason)
			resolveTermination()
		}
		let wrapUpTimeoutHandle: NodeJS.Timeout | undefined
		const scheduleWrapUp = () => {
			if (terminationRequested || this.wrapUpRequested || this.isWrappingUp) return
			void this.requestWrapUp()
			wrapUpTimeoutHandle = setTimeout(
				() =>
					requestTermination(
						`Subagent timed out after ${timeoutSeconds} seconds and could not finish wrapping up within ${WRAP_UP_TIMEOUT_SECONDS} seconds.`,
					),
				WRAP_UP_TIMEOUT_SECONDS * 1000,
			)
		}

		const timeoutHandle = setTimeout(scheduleWrapUp, timeoutSeconds * 1000)
		const parentAbortPoll = setInterval(() => {
			if (this.baseConfig.taskState.abort) {
				requestTermination("Subagent run cancelled because the parent task was cancelled.")
			}
		}, PARENT_ABORT_POLL_INTERVAL_MS)

		const executionPromise = this.executeRun(prompt, timeoutSeconds, includeHistory)
		void executionPromise.catch((error) => {
			if (terminationRequested) Logger.error(`${logPrefix} abandoned execution failed after termination`, error)
		})

		if (this.baseConfig.taskState.abort) {
			requestTermination("Subagent run cancelled because the parent task was cancelled.")
		}

		try {
			const outcome = await Promise.race([
				executionPromise.then((result) => ({ kind: "execution" as const, result })),
				terminationPromise.then(() => ({ kind: "termination" as const })),
			])

			if (outcome.kind === "execution") {
				this.recordTerminal(outcome.result)
				this.runProgress.stopAcceptingUpdates()
				const progressDrained = await this.drainProgressUpdates(undefined, logPrefix)
				if (!progressDrained) this.runProgress.discardQueuedUpdates()
				return outcome.result
			}

			this.runProgress.discardQueuedUpdates()
			const result = this.abortHandler.buildAbortResult(this.activeConversation, this.activeStats)
			this.recordTerminal(result)
			this.runProgress.stopAcceptingUpdates()
			await this.drainProgressUpdates(undefined, logPrefix)
			const terminalProgress = Promise.resolve()
				.then(() => onProgress(this.toTerminalProgressUpdate(result)))
				.catch((error) => Logger.error(`${logPrefix} terminal progress observer failed`, error))
			await this.drainProgressUpdates(terminalProgress, logPrefix)
			return result
		} finally {
			clearTimeout(timeoutHandle)
			if (wrapUpTimeoutHandle) clearTimeout(wrapUpTimeoutHandle)
			clearInterval(parentAbortPoll)
			this.runState.stopHeartbeat()
			this.runProgress.endExecution()
			// Fire-and-forget: recorder flush must not block terminal completion (matches pre-split behavior).
			void this.runProgress.flush()
		}
	}

	private async executeRun(prompt: string, timeout: number, includeHistory?: boolean): Promise<SubagentRunResult> {
		const state = new TaskState()
		state.abort = this.abortRequested
		state.activeSkillIds = [...this.baseConfig.taskState.activeSkillIds]
		state.availableSkills = this.baseConfig.taskState.availableSkills
		this.activeTaskState = state
		let emptyAssistantResponseRetries = 0
		const conversation = this.activeConversation
		const contextState: SubagentContextState = {}
		const contextManager = new ContextManager()
		const usageState: SubagentUsageState = {
			currentRequest: createEmptyRequestUsageState(),
		}
		const stats = this.activeStats

		const logPrefix = `[SubagentRunner:${this.subagentName || "unnamed"}]`
		const instrumentedOnProgress = (update: SubagentProgressUpdate) => {
			if (
				update.status === SubagentExecutionStatus.COMPLETED ||
				update.status === SubagentExecutionStatus.FAILED ||
				update.status === SubagentExecutionStatus.CANCELLED
			) {
				this.enterPhase(this.phaseForStatus(update.status), `reported ${update.status} status`, { status: update.status })
				Logger.info(`${logPrefix} ${update.status}: ${(update.result || update.error || "").substring(0, 200)}`)
			}
			this.runProgress.enqueueExecutionProgress({ ...this.getRuntimeProgress(), ...update })
		}

		instrumentedOnProgress({
			status: SubagentExecutionStatus.RUNNING,
			stats,
		})

		try {
			const runtime = this.runtime
			this.activeApiAbort = () => runtime.abort()

			this.enterPhase("building_initial_context", "building initial tool and provider context")
			const initialContext = await this.contextBuilder.buildContext()
			this.markActivity("initial context built")
			const context = initialContext.context
			state.availableSkills = context.skills ?? []
			let requestSnapshot = initialContext.requestSnapshot
			let useNativeToolCalls = initialContext.useNativeToolCalls
			stats.contextWindow = context.providerInfo.model.info.contextWindow || 0
			let systemPrompt = this.contextBuilder.appendExecutionDeadline(initialContext.systemPrompt, timeout)
			this.enterPhase("building_workspace_metadata", "building workspace metadata")
			const workspaceMetadataEnvironmentBlock = await this.getWorkspaceMetadataEnvironmentBlock()
			this.markActivity("workspace metadata built")

			if (this.shouldAbort()) {
				await this.abort()
				return this.reportAbortResult(conversation, stats, instrumentedOnProgress)
			}

			if (includeHistory) {
				conversation.push(...this.baseConfig.messageState.getApiConversationHistory())
				contextState.conversationHistoryDeletedRange = this.baseConfig.taskState.conversationHistoryDeletedRange
			}

			conversation.push({
				role: "user",
				content: [
					{
						type: "text",
						text: prompt,
					} as DiracTextContentBlock,
					// Server-side task loop checks require workspace metadata to be present in the
					// initial user message of subagent runs.
					...(workspaceMetadataEnvironmentBlock
						? [
							{
								type: "text",
								text: workspaceMetadataEnvironmentBlock,
							} as DiracTextContentBlock,
						]
						: []),
				],
			})
			while (true) {
				if (this.beginWrapUp(conversation)) {
					usageState.lastRequest = undefined
				}
				if (this.shouldAbort()) {
					await this.abort()
					return this.reportAbortResult(conversation, stats, instrumentedOnProgress)
				}

				if (
					!this.isWrappingUp &&
					usageState.lastRequest &&
					this.shouldCompactBeforeNextRequest(usageState.lastRequest.totalTokens, runtime.model.info.contextWindow)
				) {
					const compactResult = this.compactConversationForContextWindow(
						contextManager,
						conversation,
						contextState.conversationHistoryDeletedRange,
					)
					contextState.conversationHistoryDeletedRange = compactResult.conversationHistoryDeletedRange
					if (compactResult.didCompact) {
						Logger.warn("[SubagentRunner] Proactively compacted context before next subagent request.")
					}
					// Prevent repeated compaction attempts off the same token sample.
					usageState.lastRequest = undefined
				}

				const streamHandler = new StreamResponseHandler()
				const { toolUseHandler, reasonsHandler } = streamHandler.getHandlers()
				usageState.currentRequest = createEmptyRequestUsageState()
				const requestUsage = usageState.currentRequest
				const costBeforeRequest = stats.totalCost

				let assistantText = ""
				let assistantTextSignature: string | undefined
				let requestId: string | undefined

				const stream = this.createMessageWithInitialChunkRetry(
					runtime,
					systemPrompt,
					conversation,
					requestSnapshot.nativeTools,
					context.providerInfo.providerId,
					context.providerInfo.model.id,
					contextManager,
					contextState,
				)

				try {
					for await (const chunk of stream) {
						this.markActivity(`received provider ${chunk.type} chunk`)
						switch (chunk.type) {
							case "usage":
								requestId = requestId ?? chunk.id
								stats.inputTokens += chunk.inputTokens || 0
								stats.outputTokens += chunk.outputTokens || 0
								stats.cacheWriteTokens += chunk.cacheWriteTokens || 0
								stats.cacheReadTokens += chunk.cacheReadTokens || 0
								requestUsage.inputTokens += chunk.inputTokens || 0
								requestUsage.outputTokens += chunk.outputTokens || 0
								requestUsage.cacheWriteTokens += chunk.cacheWriteTokens || 0
								requestUsage.cacheReadTokens += chunk.cacheReadTokens || 0
								requestUsage.totalTokens =
									requestUsage.inputTokens +
									requestUsage.outputTokens +
									requestUsage.cacheWriteTokens +
									requestUsage.cacheReadTokens
								requestUsage.totalCost = chunk.totalCost ?? requestUsage.totalCost
								// Account as usage arrives so aborts, stream failures, and wrap-up retain billed usage.
								stats.totalCost = costBeforeRequest + (requestUsage.totalCost ?? calculateApiCostAnthropic(
									context.providerInfo.model.info,
									requestUsage.inputTokens,
									requestUsage.outputTokens,
									requestUsage.cacheWriteTokens,
									requestUsage.cacheReadTokens,
								) ?? 0)
								stats.contextTokens = requestUsage.totalTokens
								stats.contextUsagePercentage =
									stats.contextWindow > 0 ? (stats.contextTokens / stats.contextWindow) * 100 : 0
								this.recordTranscript("usage", {
									requestId: chunk.id,
									inputTokens: chunk.inputTokens,
									outputTokens: chunk.outputTokens,
									cacheWriteTokens: chunk.cacheWriteTokens,
									cacheReadTokens: chunk.cacheReadTokens,
									totalCost: chunk.totalCost,
								})
								instrumentedOnProgress({ stats: { ...stats } })
								break
							case "text":
								requestId = requestId ?? chunk.id
								assistantText += chunk.text || ""
								assistantTextSignature = chunk.signature || assistantTextSignature
								if (chunk.text) {
									this.recordTranscript("assistant_text", {
										requestId: chunk.id,
										text: chunk.text,
										signature: chunk.signature,
									})
									instrumentedOnProgress({ textChunk: chunk.text })
								}
								break
							case "tool_calls":
								requestId = requestId ?? chunk.id
								toolUseHandler.processToolUseDelta(
									{
										id: chunk.tool_call.function?.id,
										type: "tool_use",
										name: chunk.tool_call.function?.name,
										input: normalizeToolCallArguments(chunk.tool_call.function?.arguments),
										signature: chunk.signature,
									},
									chunk.tool_call.call_id,
								)
								break
							case "reasoning":
								requestId = requestId ?? chunk.id
								break
						}

						if (this.shouldAbort()) {
							await this.abort()
							return this.reportAbortResult(conversation, stats, instrumentedOnProgress)
						}
					}
				} catch (error) {
					if (this.wrapUpRequested && !this.shouldAbort()) {
						continue
					}
					throw error
				}

				usageState.lastRequest = { ...requestUsage }

				const nativeFinalizedToolCalls = toolUseHandler.getAllFinalizedToolUses().map((toolCall, index) => ({
					toolUseId: resolveToolUseId(toolCall, index),
					id: toolCall.id,
					call_id: toolCall.call_id,
					signature: toolCall.signature,
					name: toolCall.name,
					input: toolCall.input,
					isNativeToolCall: true,
				}))
				const parsedNonNativeToolCalls = parseNonNativeToolCalls(assistantText)
				const fallbackNonNativeToolCalls = nativeFinalizedToolCalls.map((toolCall) => ({
					...toolCall,
					isNativeToolCall: false,
				}))

				let finalizedToolCalls: SubagentToolCall[] = []
				if (useNativeToolCalls) {
					finalizedToolCalls = nativeFinalizedToolCalls
				} else if (parsedNonNativeToolCalls.length > 0) {
					finalizedToolCalls = parsedNonNativeToolCalls
				} else if (fallbackNonNativeToolCalls.length > 0) {
					// Defensive fallback: if non-native mode receives structured tool call chunks,
					// execute them but serialize results as plain text to avoid tool_result pairing mismatches.
					Logger.warn(
						"[SubagentRunner] Received structured tool_calls while native tool calling is disabled; falling back to non-native result serialization.",
					)
					finalizedToolCalls = fallbackNonNativeToolCalls
				}
				const assistantContent: DiracContent[] = []
				const thinkingBlock = reasonsHandler.getCurrentReasoning()
				if (thinkingBlock) {
					assistantContent.push({ ...thinkingBlock })
				}
				if (assistantText.trim().length > 0) {
					assistantContent.push({
						type: "text",
						text: assistantText,
						signature: assistantTextSignature,
					} satisfies DiracTextContentBlock)
				}
				if (useNativeToolCalls) {
					assistantContent.push(...finalizedToolCalls.map(toAssistantToolUseBlock))
				}

				if (assistantContent.length > 0) {
					conversation.push({
						role: "assistant",
						content: assistantContent,
						id: requestId,
					})
				}

				if (finalizedToolCalls.length === 0) {
					if (this.wrapUpRequested || this.isWrappingUp) {
						await sleep(0)
						continue
					}

					emptyAssistantResponseRetries += 1
					this.recordDiagnostic("retry", this.runState.currentPhase, {
						kind: "empty_assistant_response",
						attempt: emptyAssistantResponseRetries,
					})
					if (emptyAssistantResponseRetries > MAX_EMPTY_ASSISTANT_RETRIES) {
						const error = `Subagent did not call respond with operation "complete". Last response: "${excerpt(assistantText, 200)}"`
						instrumentedOnProgress({ status: SubagentExecutionStatus.FAILED, error, stats: { ...stats } })
						return { status: SubagentExecutionStatus.FAILED, error, stats }
					}

					// Mirror the main loop's no-tools-used nudge so empty/blank model turns
					// can recover without surfacing an immediate hard failure in subagent UI.
					if (assistantContent.length === 0) {
						conversation.push({
							role: "assistant",
							content: [
								{
									type: "text",
									text: "Failure: I did not provide a response.",
								},
							],
							id: requestId,
						})
					}
					conversation.push({
						role: "user",
						content: [
							{
								type: "text",
								text: formatResponse.noToolsUsed(useNativeToolCalls),
							},
						],
					})
					await sleep(0)
					continue
				}
				emptyAssistantResponseRetries = 0

				this.enterPhase("executing_tool", "executing finalized tool calls", {
					toolCalls: finalizedToolCalls.map((call) => ({ toolUseId: call.toolUseId, name: call.name })),
				})
				const toolExecResult = await this.toolExecutor.executeToolCalls(
					finalizedToolCalls,
					state,
					requestSnapshot,
					stats,
					instrumentedOnProgress,
					this.wrapUpRequested || this.isWrappingUp,
				)
				this.markActivity("finished finalized tool calls")
				this.baseConfig.taskState.activeSkillIds = [
					...new Set([...this.baseConfig.taskState.activeSkillIds, ...state.activeSkillIds]),
				]
				if (this.shouldAbort()) {
					await this.abort()
					return this.reportAbortResult(conversation, stats, instrumentedOnProgress)
				}
				if (toolExecResult.completed)
					return {
						status: SubagentExecutionStatus.COMPLETED,
						result: toolExecResult.completed.result,
						stats: toolExecResult.completed.stats,
					}

				conversation.push({ role: "user", content: toolExecResult.toolResultBlocks })
				if (this.wrapUpRequested || this.isWrappingUp) {
					await sleep(0)
					continue
				}

				this.enterPhase("refreshing_context", "refreshing tool and provider context")
				const refreshedContext = await this.contextBuilder.buildContext()
				state.availableSkills = refreshedContext.context.skills ?? []
				requestSnapshot = refreshedContext.requestSnapshot
				useNativeToolCalls = refreshedContext.useNativeToolCalls
				systemPrompt = this.contextBuilder.appendExecutionDeadline(refreshedContext.systemPrompt, timeout)
				this.markActivity("refreshed tool and provider context")

				await sleep(0)
			}
		} catch (error) {
			if (this.shouldAbort()) {
				return this.reportAbortResult(conversation, stats, instrumentedOnProgress)
			}

			const errorText = (error as Error).message || "Subagent execution failed."
			Logger.error("[SubagentRunner] run failed", error)
			instrumentedOnProgress({ status: SubagentExecutionStatus.FAILED, error: errorText, stats: { ...stats } })
			return { status: SubagentExecutionStatus.FAILED, error: errorText, stats }
		} finally {
			this.activeApiAbort = undefined
		}
	}

	private reportAbortResult(
		conversation: DiracStorageMessage[],
		stats: SubagentRunStats,
		onProgress: (update: SubagentProgressUpdate) => void,
	): SubagentRunResult {
		const result = this.abortHandler.buildAbortResult(conversation, stats)
		onProgress(this.toTerminalProgressUpdate(result))
		return result
	}

	private toTerminalProgressUpdate(result: SubagentRunResult): SubagentProgressUpdate {
		return this.runProgress.toTerminalProgressUpdate(result, this.runState.getRuntimeProgress())
	}

	private async drainProgressUpdates(progressUpdates?: Promise<void>, logPrefix?: string): Promise<boolean> {
		return this.runProgress.drainProgressUpdates(progressUpdates, logPrefix)
	}

	private createSubagentTaskConfig(state: TaskState, coordinator: ToolExecutorCoordinator): TaskConfig {
		const baseCallbacks = this.baseConfig.callbacks
		const currentPermissionDecisionBinding = () => this.baseConfig.permissionDecisionBinding

		return {
			...this.baseConfig,
			context: this.baseConfig.context,
			providerId: this.runtime.providerId,
			model: this.runtime.model,
			supportsNativeWebSearch: this.runtime.supportsNativeWebSearch,
			coordinator,
			taskState: state,
			isSubagentExecution: true,
			get permissionDecisionBinding() {
				return currentPermissionDecisionBinding()
			},
			agentIdentity: this.options.agentIdentity,
			vscodeTerminalExecutionMode: "backgroundExec",
			callbacks: {
				...baseCallbacks,
				executeCommandTool: async (command: string, timeoutSeconds: number | undefined) => {
					this.runState.activeCommandExecutions += 1
					this.markActivity("started command tool execution")
					try {
						return await baseCallbacks.executeCommandTool(command, timeoutSeconds, {
							useBackgroundExecution: true,
							suppressUserInteraction: true,
						})
					} finally {
						this.runState.activeCommandExecutions = Math.max(0, this.runState.activeCommandExecutions - 1)
						this.markActivity("finished command tool execution")
					}
				},
			},
		}
	}

	private shouldRetryInitialStreamError(error: unknown, providerId: string, modelId: string): boolean {
		// Mirror main loop behavior: do not auto-retry auth/balance failures.
		const parsedError = DiracError.transform(error, modelId, providerId)
		const isAuthError = parsedError.isErrorType(DiracErrorType.Auth)
		const isBalanceError = parsedError.isErrorType(DiracErrorType.Balance)
		const isPaymentError = parsedError.isErrorType(DiracErrorType.Payment)

		if (isAuthError || isBalanceError || isPaymentError) {
			return false
		}

		return true
	}

	private compactConversationForContextWindow(
		contextManager: ContextManager,
		conversation: DiracStorageMessage[],
		conversationHistoryDeletedRange: [number, number] | undefined,
	): {
		didCompact: boolean
		conversationHistoryDeletedRange: [number, number] | undefined
	} {
		let didCompact = false
		let updatedDeletedRange = conversationHistoryDeletedRange

		const deletedRange = contextManager.getNextTruncationRange(conversation, conversationHistoryDeletedRange, "quarter")
		if (deletedRange[1] < deletedRange[0]) {
			return {
				didCompact,
				conversationHistoryDeletedRange: updatedDeletedRange,
			}
		}

		if (
			conversationHistoryDeletedRange &&
			deletedRange[0] === conversationHistoryDeletedRange[0] &&
			deletedRange[1] === conversationHistoryDeletedRange[1]
		) {
			return {
				didCompact,
				conversationHistoryDeletedRange: updatedDeletedRange,
			}
		}

		updatedDeletedRange = deletedRange
		didCompact = true
		return {
			didCompact,
			conversationHistoryDeletedRange: updatedDeletedRange,
		}
	}

	private shouldCompactBeforeNextRequest(requestTotalTokens: number, configuredContextWindow?: number): boolean {
		const contextWindow = configuredContextWindow || 256_000
		const maxAllowedSize = Math.min(1_000_000, Math.max(contextWindow - 40_000, contextWindow * 0.8))
		const useAutoCondense = this.baseConfig.useAutoCondense
		if (useAutoCondense) {
			const autoCondenseThreshold = 0.75
			const roundedThreshold = Math.floor(contextWindow * autoCondenseThreshold)
			const thresholdTokens = Math.min(roundedThreshold, maxAllowedSize)
			return requestTotalTokens >= thresholdTokens
		}

		return requestTotalTokens >= maxAllowedSize
	}

	private async *createMessageWithInitialChunkRetry(
		runtime: SubagentRuntime,
		systemPrompt: string,
		fullConversation: DiracStorageMessage[],
		nativeTools: DiracTool[] | undefined,
		providerId: string,
		modelId: string,
		contextManager: ContextManager,
		contextState: SubagentContextState,
	) {
		for (let attempt = 1; attempt <= MAX_INITIAL_STREAM_ATTEMPTS; attempt += 1) {
			this.runState.currentAttempt = attempt
			const truncatedConversation = contextManager
				.getTruncatedMessages(fullConversation, contextState.conversationHistoryDeletedRange)
				.map((message) => message as DiracStorageMessage)
			const enableNativeWebSearch =
				runtime.supportsNativeWebSearch &&
				this.activeTaskState?.activeSkillIds.includes(NATIVE_WEB_SEARCH_SKILL_NAME) === true
			this.enterPhase("awaiting_first_provider_chunk", "starting provider request", {
				attempt,
				providerId,
				modelId,
				conversationMessageCount: truncatedConversation.length,
				enableNativeWebSearch,
			})

			let receivedChunk = false
			try {
				const stream = runtime.createMessage(systemPrompt, truncatedConversation, nativeTools, { enableNativeWebSearch })
				const iterator = stream[Symbol.asyncIterator]()
				const firstChunk = await iterator.next()
				this.enterPhase("streaming_provider_response", "received first provider chunk", { attempt, providerId, modelId })
				if (!firstChunk.done) {
					receivedChunk = true
					yield firstChunk.value
				}

				yield* iterator
				this.markActivity("provider stream completed")
				return
			} catch (error) {
				// Retrying a partially consumed stream merges distinct billed requests into one usage snapshot.
				if (receivedChunk) throw error
				if (checkContextWindowExceededError(error)) {
					const compactResult = this.compactConversationForContextWindow(
						contextManager,
						fullConversation,
						contextState.conversationHistoryDeletedRange,
					)
					contextState.conversationHistoryDeletedRange = compactResult.conversationHistoryDeletedRange
					if (!compactResult.didCompact || this.shouldAbort() || attempt >= MAX_INITIAL_STREAM_ATTEMPTS) {
						throw error
					}
					this.recordDiagnostic("retry", this.runState.currentPhase, {
						kind: "context_window_compaction",
						attempt,
						error,
					})
					Logger.warn(
						`[SubagentRunner] Context window exceeded on initial stream attempt ${attempt}; compacted conversation and retrying.`,
					)
					continue
				}

				const shouldRetry =
					!this.shouldAbort() &&
					attempt < MAX_INITIAL_STREAM_ATTEMPTS &&
					this.shouldRetryInitialStreamError(error, providerId, modelId)
				if (!shouldRetry) {
					throw error
				}

				const delayMs = INITIAL_STREAM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
				this.recordDiagnostic("retry", this.runState.currentPhase, {
					kind: "initial_stream_error",
					attempt,
					nextAttempt: attempt + 1,
					delayMs,
					error,
				})
				Logger.warn(`[SubagentRunner] Initial stream failed. Retrying attempt ${attempt + 1}.`, error)
				await sleep(delayMs)
			}
		}
	}

	private runState: SubagentRunState
	private runProgress: SubagentRunProgress
}
```

### /Users/highlands/pools/Development/dirac/src/core/workspace/WorkspaceResolver.ts (lines 23-256)
```
export class WorkspaceResolver {
	private usageMap = new Map<string, UsageStats>()
	private traceEnabled = isMultiRootTraceEnabled()
	private readonly migrationReporter: MigrationReporter

	constructor(migrationReporter: MigrationReporter = new MigrationReporter()) {
		this.migrationReporter = migrationReporter
	}

	/**
	 * Track usage statistics for a given context and path
	 * @param context - Component/handler name for tracking usage
	 * @param examplePath - The path to track as an example
	 */
	private trackUsage(context: string, examplePath: string): void {
		const stats = this.usageMap.get(context) || {
			count: 0,
			examples: [],
			lastUsed: new Date(),
		}

		stats.count++
		stats.lastUsed = new Date()

		// Keep up to MAX_EXAMPLE_PATHS example paths for debugging
		if (stats.examples.length < MAX_EXAMPLE_PATHS && !stats.examples.includes(examplePath)) {
			stats.examples.push(examplePath)
		}

		this.usageMap.set(context, stats)
	}

	/**
	 * Phase 0: Traces single-root path resolution for migration planning
	 * Phase 1+: Will resolve path against multiple workspace roots
	 *
	 * @param cwdOrRoots - Current working directory (Phase 0) or array of workspace roots (Phase 1+)
	 * @param relativePath - The relative path to resolve
	 * @param context - Component/handler name for tracking usage
	 * @returns Absolute path (Phase 0) or object with path and root (Phase 1+)
	 */
	resolveWorkspacePath(
		cwdOrRoots: string | WorkspaceRoot[],
		relativePath: string,
		context?: string,
	): string | { absolutePath: string; root: WorkspaceRoot } {
		// Phase 0: Single-root tracer mode
		if (typeof cwdOrRoots === "string") {
			return this.resolveSingleRootPath(cwdOrRoots, relativePath, context)
		}

		// Phase 1+: Multi-root resolution
		return this.resolveMultiRootPath(cwdOrRoots, relativePath)
	}

	/**
	 * Resolves a path against a single workspace root (Phase 0)
	 *
	 * @param cwd - Current working directory
	 * @param relativePath - The relative path to resolve
	 * @param context - Component/handler name for tracking usage
	 * @returns Absolute path
	 */
	private resolveSingleRootPath(cwd: string, relativePath: string, context?: string): string {
		// Track usage for migration planning
		if (context) {
			this.trackUsage(context, relativePath)

			if (this.traceEnabled) {
				Logger.debug(`[MULTI-ROOT-TRACE] ${context}: resolving "${relativePath}" against "${cwd}"`)
			}
		}

		return path.resolve(cwd, relativePath)
	}

	/**
	 * Resolves a path against multiple workspace roots (Phase 1+)
	 *
	 * @param workspaceRoots - Array of workspace roots
	 * @param relativePath - The relative path to resolve
	 * @returns Object with absolute path and matching root
	 */
	private resolveMultiRootPath(
		workspaceRoots: WorkspaceRoot[],
		relativePath: string,
	): { absolutePath: string; root: WorkspaceRoot } {
		// Handle absolute paths
		if (path.isAbsolute(relativePath)) {
			return this.resolveAbsolutePath(workspaceRoots, relativePath)
		}

		// Handle relative paths
		return this.resolveRelativePath(workspaceRoots, relativePath)
	}

	/**
	 * Resolves an absolute path against workspace roots
	 *
	 * @param workspaceRoots - Array of workspace roots
	 * @param absolutePath - The absolute path to resolve
	 * @returns Object with absolute path and matching root
	 */
	private resolveAbsolutePath(
		workspaceRoots: WorkspaceRoot[],
		absolutePath: string,
	): { absolutePath: string; root: WorkspaceRoot } {
		const matchingRoot = workspaceRoots.find((root) => absolutePath.startsWith(root.path))
		return {
			absolutePath,
			root: matchingRoot || workspaceRoots[0], // fallback to primary
		}
	}

	/**
	 * Resolves a relative path against workspace roots
	 *
	 * @param workspaceRoots - Array of workspace roots
	 * @param relativePath - The relative path to resolve
	 * @returns Object with absolute path and matching root
	 */
	private resolveRelativePath(
		workspaceRoots: WorkspaceRoot[],
		relativePath: string,
	): { absolutePath: string; root: WorkspaceRoot } {
		// Check which roots have this relative path
		const candidateRoots: WorkspaceRoot[] = []
		for (const root of workspaceRoots) {
			// const testPath = path.join(root.path, relativePath)
			// In Phase 1, check if path exists
			// For now, just add all roots as candidates
			candidateRoots.push(root)
		}

		return this.selectBestRoot(workspaceRoots, candidateRoots, relativePath)
	}

	/**
	 * Selects the best root from candidate roots using disambiguation logic
	 *
	 * @param workspaceRoots - All available workspace roots
	 * @param candidateRoots - Candidate roots that could contain the path
	 * @param relativePath - The relative path being resolved
	 * @returns Object with absolute path and selected root
	 */
	private selectBestRoot(
		workspaceRoots: WorkspaceRoot[],
		candidateRoots: WorkspaceRoot[],
		relativePath: string,
	): { absolutePath: string; root: WorkspaceRoot } {
		// Disambiguation logic (simplified for Phase 0)
		if (candidateRoots.length === 0) {
			// Path doesn't exist in any root, use primary
			return {
				absolutePath: path.resolve(workspaceRoots[0].path, relativePath),
				root: workspaceRoots[0],
			}
		}

		if (candidateRoots.length === 1) {
			// Unambiguous
			return {
				absolutePath: path.resolve(candidateRoots[0].path, relativePath),
				root: candidateRoots[0],
			}
		}

		// Multiple matches - need disambiguation
		// Phase 2: This will trigger UI picker
		// For now, use primary root if it's a candidate, otherwise first match
		const primaryRoot = workspaceRoots[0]
		const selectedRoot = candidateRoots.find((r) => r.path === primaryRoot.path) || candidateRoots[0]

		return {
			absolutePath: path.resolve(selectedRoot.path, relativePath),
			root: selectedRoot,
		}
	}

	/**
	 * Get migration report showing all single-root usage patterns
	 * Currently this function is mainly called by the vscode debugger
	 */
	getMigrationReport(): string {
		return this.migrationReporter.generateReport(this.usageMap, this.traceEnabled)
	}

	/**
	 * Get raw usage statistics for external analysis
	 * @returns Map of component names to their usage statistics
	 */
	getUsageStats(): Map<string, UsageStats> {
		return new Map(this.usageMap)
	}

	/**
	 * Clear usage statistics (useful for testing)
	 */
	clearUsageStats(): void {
		this.usageMap.clear()
	}

	/**
	 * Export usage data as JSON for analysis
	 */
	exportUsageData(): Record<string, UsageStats> {
		return Object.fromEntries(this.usageMap)
	}

	/**
	 * Phase 0: Instance method for getting basename with tracking
	 * Phase 1+: Will handle basename for multi-workspace paths
	 *
	 * @param filePath - The file path to get basename from
	 * @param context - Component/handler name for tracking usage
	 * @returns The basename of the path
	 */
	getBasename(filePath: string, context?: string): string {
		// Track usage for migration planning
		if (!context?.length) {
			return path.basename(filePath)
		}
		this.trackUsage(context, filePath)

		// Phase 0: Just wrap existing behavior
		const result = path.basename(filePath)

		if (this.traceEnabled) {
			Logger.debug(`[MULTI-ROOT-TRACE] ${context}: getting basename for "${filePath}"`)
		}

		return result
	}
}
```


## Source Files:

- `src/core/context/context-tracking/FileContextTracker.ts`
- `src/core/context/instructions/user-instructions/rule-conditionals.ts`
- `src/core/controller/historyItemWorkspace.ts`
- `src/core/controller/task/TaskController.ts`
- `src/core/controller/workspace/WorkspaceController.ts`
- `src/core/hooks/HookConfigBuilder.ts`
- `src/core/hooks/HookDiscoveryCache.ts`
- `src/core/hooks/hook-factory.ts`
- `src/core/hooks/utils.ts`
- `src/core/mentions/file-mention.ts`
- `src/core/mentions/keyword-mention.ts`
- `src/core/mentions/mention-parsers.ts`
- `src/core/security/WorkspaceCodeApproval.ts`
- `src/core/task/EnvironmentManager.ts`
- `src/core/task/context/MentionContextLoader.ts`
- `src/core/task/tools/adapters/traits/WorkspaceTraitBuilder.ts`
- `src/core/task/tools/autoApprove.ts`
- `src/core/task/tools/context/DiracContext.ts`
- `src/core/task/tools/discovery/ToolDiscoveryService.ts`
- `src/core/task/tools/interfaces/IToolEnvironment.ts`
- `src/core/task/tools/modules/execute_command/ExecuteCommandTool.ts`
- `src/core/task/tools/modules/search_files/index.ts`
- `src/core/task/tools/registry/ToolRegistry.ts`
- `src/core/task/tools/registry/refreshToolRegistry.ts`
- `src/core/task/tools/runtime/ToolSnapshotManager.ts`
- `src/core/task/tools/subagent/SubagentContextBuilder.ts`
- `src/core/task/tools/subagent/SubagentRunner.ts`
- `src/core/workspace/MigrationReporter.ts`
- `src/core/workspace/WorkspacePathAdapter.ts`
- `src/core/workspace/WorkspaceResolver.ts`
- `src/core/workspace/WorkspaceRootManager.ts`
- `src/core/workspace/detection.ts`
- `src/core/workspace/multi-root-utils.ts`
- `src/core/workspace/setup.ts`
- `src/core/workspace/utils/parseWorkspaceInlinePath.ts`
- `src/core/workspace/utils/workspace-detection.ts`
- `src/hosts/vscode/hostbridge/workspace/getDiagnostics.ts`
- `src/hosts/vscode/hostbridge/workspace/getWorkspacePaths.ts`
- `src/hosts/vscode/hostbridge/workspace/saveOpenDocumentIfDirty.ts`
- `src/services/search/file-search.ts`
- `src/services/symbol-index/SymbolIndexEligibility.ts`
- `src/services/symbol-index/SymbolIndexRuntime.ts`
- `src/services/telemetry/WorkspaceTelemetry.ts`
- `src/services/workspace/WorkspaceFingerprint.ts`
- `src/shared/multi-root/types.ts`
- `src/utils/path.ts`

