---
component_id: 6.1.1
component_name: Task Tool Environment & Subagent Runner
---

# Task Tool Environment & Subagent Runner

## Component Description

Manages task execution environments, tool discovery and registry refreshes, command and search tools, and subagent context and execution.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/task/EnvironmentManager.ts (lines 85-277)
```
export class EnvironmentManager {
	private dependencies: EnvironmentManagerDependencies

	constructor(dependencies: EnvironmentManagerDependencies) {
		this.dependencies = dependencies
	}

	setApi(api: ApiHandler): void {
		this.dependencies.api = api
	}

	private get cwd() {
		return this.dependencies.cwd
	}
	private get terminalManager() {
		return this.dependencies.terminalManager
	}
	private get taskState() {
		return this.dependencies.taskState
	}
	private get fileContextTracker() {
		return this.dependencies.fileContextTracker
	}
	private get api() {
		return this.dependencies.api
	}
	private get messageStateHandler() {
		return this.dependencies.messageStateHandler
	}
	private get workspaceManager() {
		return this.dependencies.workspaceManager
	}

	async getEnvironmentDetails(includeFileDetails = false): Promise<string> {
		let details = ""

		// Workspace roots (multi-root)
		details += this.formatWorkspaceRootsSection()

		if (includeFileDetails) {
			const MAX_RECENT_FILES = 10

			// Merge hardcoded ignores with .gitignore entries so we skip generated/vendor dirs
			const gitIgnoredNames = await this.getGitIgnoredNames()
			const ignoredDirs = new Set([...ALWAYS_IGNORED_DIRS, ...gitIgnoredNames])

			const fileStats: { relativePath: string; mtime: Date }[] = []
			for await (const absPath of this.walkCodeFiles(this.cwd, ignoredDirs)) {
				if (this.dependencies.diracIgnoreController?.validateAccess(absPath) === false) continue
				try {
					const stat = await fs.stat(absPath)
					fileStats.push({
						relativePath: path.relative(this.cwd, absPath),
						mtime: stat.mtime,
					})
				} catch {
					// File removed between walk and stat — skip
				}
			}

			fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
			const recent = fileStats.slice(0, MAX_RECENT_FILES)

			if (recent.length > 0) {
				details += `\n\n# Latest ${MAX_RECENT_FILES} edited files in this workspace`
				for (const { relativePath, mtime } of recent) {
					details += `\n${relativePath.toPosix()}  ${EnvironmentManager.relativeTime(mtime)}`
				}
			}
		}

		const requestRuntime = this.dependencies.getRequestRuntime()
		const mode = (requestRuntime?.workingConfiguration ?? this.dependencies.getWorkingConfiguration()).settings.mode
		const modeNotice = this.taskState.pendingModeNotice
		if (modeNotice?.mode === mode) {
			if (requestRuntime) modeNotice.includedInRequestId = requestRuntime.requestId
			details += "\n\n# Current Mode"
			if (mode === "plan") {
				details += `\nPLAN MODE\n${formatResponse.planModeInstructions()}`
			} else {
				details += `\nACT MODE\n${getEditingFilesInstructions()}`
			}
		}

		const content = details.trim()
		if (!content) return ""
		return `<environment_details>\n${content}\n</environment_details>`
	}

	private formatWorkspaceRootsSection(): string {
		const multiRootEnabled =
			(this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration()).executionOptions.multiRootEnabled
		const hasWorkspaceManager = !!this.workspaceManager
		const roots = hasWorkspaceManager ? this.workspaceManager!.getRoots() : []

		// Only show workspace roots if multi-root is enabled and there are multiple roots
		if (!multiRootEnabled || roots.length <= 1) {
			return ""
		}

		let section = "\n\n# Workspace Roots"

		// Format each root with its name, path, and VCS info
		for (const root of roots) {
			const name = root.name || path.basename(root.path)
			const vcs = root.vcs ? ` (${String(root.vcs)})` : ""
			section += `\n- ${name}: ${root.path}${vcs}`
		}

		// Add primary workspace information
		const primary = this.workspaceManager!.getPrimaryRoot()
		const primaryName = this.getPrimaryWorkspaceName(primary)
		section += `\n\nPrimary workspace: ${primaryName}`

		return section
	}

	private getPrimaryWorkspaceName(primary?: ReturnType<WorkspaceRootManager["getRoots"]>[0]): string {
		if (primary?.name) {
			return primary.name
		}
		if (primary?.path) {
			return path.basename(primary.path)
		}
		return path.basename(this.cwd)
	}

	private async getGitIgnoredNames(): Promise<Set<string>> {
		const ignored = new Set<string>()
		try {
			const content = await fs.readFile(path.join(this.cwd, ".gitignore"), "utf8")
			for (const raw of content.split("\n")) {
				const line = raw.trim()
				// Skip comments, empty lines, and negation patterns
				if (!line || line.startsWith("#") || line.startsWith("!")) {
					continue
				}
				// Extract the leading path segment: "dist/", "/build", "packages/generated" → "dist", "build", "packages"
				const name = line.replace(/^\//, "").split("/")[0].replace(/\/$/, "")
				if (name && !name.includes("*") && !name.includes("?")) {
					ignored.add(name)
				}
			}
		} catch {
			// .gitignore absent or unreadable — no-op
		}
		return ignored
	}

	private async *walkCodeFiles(
		root: string,
		ignoredDirs: Set<string>,
		maxEntries = MAX_WALK_ENTRIES,
	): AsyncGenerator<string> {
		const queue: string[] = [root]
		let inspected = 0

		while (queue.length > 0 && !this.taskState.abort) {
			const dir = queue.shift()!
			const entries = await readDirEntries(dir)

			for (const entry of entries) {
				if (this.taskState.abort || ++inspected > maxEntries) {
					return
				}
				if (entry.name.startsWith(".")) {
					continue
				}

				const fullPath = path.join(dir, entry.name)
				if (entry.isDirectory() && !ignoredDirs.has(entry.name)) {
					queue.push(fullPath)
				} else if (entry.isFile() && isCodeFile(entry.name)) {
					yield fullPath
				}
			}
		}
	}

	private static relativeTime(date: Date): string {
		const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
		if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""} ago`
		const minutes = Math.floor(seconds / 60)
		if (minutes < 60) return `${minutes} min${minutes !== 1 ? "s" : ""} ago`
		const hours = Math.floor(minutes / 60)
		if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`
		const days = Math.floor(hours / 24)
		if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`
		const months = Math.floor(days / 30)
		if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`
		return `${Math.floor(months / 12)} year${Math.floor(months / 12) !== 1 ? "s" : ""} ago`
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/context/MentionContextLoader.ts (lines 17-119)
```
export class MentionContextLoader {
	constructor(
		private dependencies: ContextLoaderDependencies,
		private fileContextLoader: FileContextLoader,
	) { }

	// Parse mentions and slash commands, then optionally enrich with file/symbol context
	async enrichContext(
		text: string,
		cwd: string,
		localWorkflowToggles: any,
		globalWorkflowToggles: any,
		ulid: string,
		providerInfo: any,
		includePathContext: boolean,
		availableSkills: SkillMetadata[],
		conversationCondensationAvailable: boolean,
		taskHandoffCondensationAvailable: boolean,
	): Promise<EnrichContextResult> {
		const parsedText = await parseMentions(text, cwd, this.urlContentFetcher, this.fileContextTracker, this.workspaceManager)
		const { processedText, needsDiracrulesFileCheck, isDirectResponse, directResponseText, directAction } =
			await parseSlashCommands(
				parsedText,
				localWorkflowToggles,
				globalWorkflowToggles,
				ulid,
				providerInfo,
				availableSkills,
				this.dependencies.commandPermissionController,
				this.dependencies.extensionPath,
				this.dependencies.sourceDir,
				conversationCondensationAvailable,
				taskHandoffCondensationAvailable,
			)

		// Handle /reloadtools direct response: trigger tool registry refresh
		if (isDirectResponse && directResponseText === "__RELOAD_TOOLS__") return await this.handleReloadTools()

		// Skip automatic path and symbol detection for subsequent turns or very long prompts
		if (!includePathContext || text.length > 1000)
			return { enrichedText: processedText, needsDiracrulesFileCheck, isDirectResponse, directResponseText, directAction }

		const { filePaths, directoryPaths, symbols } = await this.fileContextLoader.extractContext(text, cwd)
		const { skeletons, directoryLists } = await this.fileContextLoader.getPathContext(filePaths, directoryPaths, cwd)
		const symbolDefinitions = await this.fileContextLoader.getSymbolContext(symbols, cwd)

		const additionalContext = [...skeletons, ...directoryLists, ...symbolDefinitions]
		if (additionalContext.length > 0) {
			return {
				enrichedText: `${processedText}\n\n${additionalContext.join("\n\n")}`,
				needsDiracrulesFileCheck,
				isDirectResponse,
				directResponseText,
				directAction,
			}
		}
		return { enrichedText: processedText, needsDiracrulesFileCheck, isDirectResponse, directResponseText, directAction }
	}

	// Refresh tool registry and build a summary response for /reloadtools
	private async handleReloadTools(): Promise<EnrichContextResult> {
		const primaryRootPath = this.workspaceManager?.getPrimaryRoot()?.path
		await refreshToolRegistryForWorkspace({
			workspaceRoot: primaryRootPath,
			includeUserTools: true,
			forceRefresh: true,
		})
		const reloadResponse = await ToolRegistry.withExclusiveAccess((registry) => {
			const allTools = registry.getAllTools()
			const userTools = allTools.filter((tool) => tool.source !== "builtin")
			const enabledTools = registry.getEnabledTools()
			const userToolSummary =
				userTools.length > 0
					? userTools
						.map(
							(tool) =>
								`  - ${tool.id} (${tool.source}) — ${enabledTools.some((enabled) => enabled.id === tool.id) ? "enabled" : "disabled"}`,
						)
						.join("\n")
					: "  (none found)"
			return [
				`Tools reloaded. Found ${allTools.length} total tools (${userTools.length} user tools).`,
				"",
				"User tools:",
				userToolSummary,
				"",
				"Note: User tools are disabled by default. Enable them in Settings → Tools or by toggling the switch.",
			].join("\n")
		})
		await this.dependencies.postStateToWebview()
		return { enrichedText: "", needsDiracrulesFileCheck: false, isDirectResponse: true, directResponseText: reloadResponse }
	}

	private get urlContentFetcher() {
		return this.dependencies.urlContentFetcher
	}
	private get fileContextTracker() {
		return this.dependencies.fileContextTracker
	}
	private get workspaceManager() {
		return this.dependencies.workspaceManager
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


## Source Files:

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

