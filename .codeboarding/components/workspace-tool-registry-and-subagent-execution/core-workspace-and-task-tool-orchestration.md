---
component_id: 6.1
component_name: Core Workspace & Task Tool Orchestration
---

# Core Workspace & Task Tool Orchestration

## Component Description

Orchestrates core workspace root resolution, context and mention loading, hook discovery, tool registry lifecycle, and subagent execution within task workflows.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/workspace/WorkspaceRootManager.ts (lines 17-249)
```
export class WorkspaceRootManager {
	private roots: WorkspaceRoot[] = []
	private primaryIndex = 0

	constructor(roots: WorkspaceRoot[] = [], primaryIndex = 0) {
		this.roots = roots
		this.primaryIndex = Math.min(primaryIndex, Math.max(0, roots.length - 1))
	}

	/**
	 * Initialize from a single cwd for backward compatibility
	 */
	static async fromLegacyCwd(cwd: string): Promise<WorkspaceRootManager> {
		const vcs = await WorkspaceRootManager.detectVcs(cwd)
		const gitHash = vcs === VcsType.Git ? await getLatestGitCommitHash(cwd) : null
		const commitHash = gitHash === null ? undefined : gitHash

		const root: WorkspaceRoot = {
			path: cwd,
			name: path.basename(cwd),
			vcs,
			commitHash,
		}

		return new WorkspaceRootManager([root], 0)
	}

	/**
	 * Detect version control system for a directory
	 */
	private static async detectVcs(dirPath: string): Promise<VcsType> {
		try {
			// Check for Git
			await execa("git", ["rev-parse", "--git-dir"], { cwd: dirPath })
			return VcsType.Git
		} catch {
			// Not a git repo
		}

		try {
			// Check for Mercurial
			await execa("hg", ["root"], { cwd: dirPath })
			return VcsType.Mercurial
		} catch {
			// Not a mercurial repo
		}

		return VcsType.None
	}

	/**
	 * Get all workspace roots
	 */
	getRoots(): WorkspaceRoot[] {
		return [...this.roots]
	}

	/**
	 * Get the primary workspace root
	 */
	getPrimaryRoot(): WorkspaceRoot | undefined {
		return this.roots[this.primaryIndex]
	}

	/**
	 * Get the primary workspace root index
	 */
	getPrimaryIndex(): number {
		return this.primaryIndex
	}

	/**
	 * Set the primary workspace root by index
	 */
	setPrimaryIndex(index: number): void {
		if (index >= 0 && index < this.roots.length) {
			this.primaryIndex = index
		}
	}

	/**
	 * Find the workspace root that contains the given absolute path
	 */
	resolvePathToRoot(absolutePath: string): WorkspaceRoot | undefined {
		// Sort roots by path length (longest first) to handle nested workspaces
		const sortedRoots = [...this.roots].sort((a, b) => b.path.length - a.path.length)

		for (const root of sortedRoots) {
			if (absolutePath.startsWith(root.path)) {
				return root
			}
		}

		return undefined
	}

	/**
	 * Find workspace root by name
	 */
	getRootByName(name: string): WorkspaceRoot | undefined {
		return this.roots.find((r) => r.name === name)
	}

	/**
	 * Get workspace root by index
	 */
	getRootByIndex(index: number): WorkspaceRoot | undefined {
		return this.roots[index]
	}

	/**
	 * Check if a path is within any workspace root
	 */
	isPathInWorkspace(absolutePath: string): boolean {
		return this.resolvePathToRoot(absolutePath) !== undefined
	}

	/**
	 * Get relative path from workspace root
	 */
	getRelativePathFromRoot(absolutePath: string, root?: WorkspaceRoot): string | undefined {
		const targetRoot = root || this.resolvePathToRoot(absolutePath)
		if (!targetRoot) {
			return undefined
		}

		return path.relative(targetRoot.path, absolutePath)
	}

	/**
	 * Create workspace context for tool execution
	 */
	createContext(currentRoot?: WorkspaceRoot): WorkspaceContext {
		return {
			workspaceRoots: this.getRoots(),
			primaryRoot: this.getPrimaryRoot()!,
			currentRoot: currentRoot || this.getPrimaryRoot(),
		}
	}

	/**
	 * Serialize for storage
	 */
	toJSON(): { roots: WorkspaceRoot[]; primaryIndex: number } {
		return {
			roots: this.roots,
			primaryIndex: this.primaryIndex,
		}
	}

	/**
	 * Deserialize from storage
	 */
	static fromJSON(data: { roots: WorkspaceRoot[]; primaryIndex: number }): WorkspaceRootManager {
		return new WorkspaceRootManager(data.roots, data.primaryIndex)
	}

	/**
	 * Get a summary string for display
	 */
	getSummary(): string {
		if (this.roots.length === 0) {
			return "No workspace roots configured"
		}

		if (this.roots.length === 1) {
			return `Single workspace: ${this.roots[0].name || this.roots[0].path}`
		}

		const primary = this.getPrimaryRoot()
		return `Multi-workspace (${this.roots.length} roots)\nPrimary: ${primary?.name || primary?.path}\nAdditional: ${this.roots
			.filter((_, i) => i !== this.primaryIndex)
			.map((r) => r.name || path.basename(r.path))
			.join(", ")}`
	}

	/**
	 * Check if this is a single-root workspace (for backward compatibility)
	 */
	isSingleRoot(): boolean {
		return this.roots.length === 1
	}

	/**
	 * Get the single root if this is a single-root workspace
	 * Throws if multiple roots exist
	 */
	getSingleRoot(): WorkspaceRoot {
		if (this.roots.length !== 1) {
			throw new Error(`Expected single root, but found ${this.roots.length} roots`)
		}
		return this.roots[0]
	}

	/**
	 * Update commit hashes for all Git repositories
	 */
	async updateCommitHashes(): Promise<void> {
		for (const root of this.roots) {
			if (root.vcs === VcsType.Git) {
				const gitHash = await getLatestGitCommitHash(root.path)
				root.commitHash = gitHash === null ? undefined : gitHash
			}
		}
	}

	/**
	 * Build workspaces JSON structure for environment details
	 */
	async buildWorkspacesJson(): Promise<string | null> {
		const workspaces: Record<string, { hint: string; associatedRemoteUrls?: string[]; latestGitCommitHash?: string }> = {}

		// Process all workspace roots
		for (const root of this.roots) {
			const hint = root.name || path.basename(root.path)
			const gitRemotes = await getGitRemoteUrls(root.path)
			const gitCommitHash = await getLatestGitCommitHash(root.path)

			workspaces[root.path] = {
				hint,
				...(gitRemotes.length > 0 && { associatedRemoteUrls: gitRemotes }),
				...(gitCommitHash && { latestGitCommitHash: gitCommitHash }),
			}
		}

		// Only return JSON if there's content to feed the env details
		if (Object.keys(workspaces).length === 0) {
			return null
		}

		return JSON.stringify({ workspaces }, null, 2)
	}
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

### /Users/highlands/pools/Development/dirac/src/core/context/context-tracking/FileContextTracker.ts (lines 32-321)
```
export class FileContextTracker {
	private stateStore: FileContextStateStore
	readonly taskId: string

	// File tracking and watching
	private fileWatchers = new Map<string, FSWatcher>()
	private readonly watcherCloser = new ChokidarWatcherCloser()
	private recentlyModifiedFiles = new Set<string>()
	private recentlyEditedByDirac = new Set<string>()

	constructor(
		stateStore: FileContextStateStore,
		taskId: string,
		private watcherFactory: WatcherFactory = chokidar.watch,
	) {
		this.stateStore = stateStore
		this.taskId = taskId
	}

	/**
	 * File watchers are set up for each file that is tracked in the task metadata.
	 */
	async setupFileWatcher(filePath: string) {
		await this.watcherCloser.closeAll()
		if (this.fileWatchers.has(filePath)) return

		const cwd = await getCwd()
		if (!cwd) {
			Logger.info("No workspace folder available - cannot determine current working directory")
			return
		}

		const resolvedFilePath = path.resolve(cwd, filePath)
		try {
			const watcher = this.watcherFactory(resolvedFilePath, {
				persistent: true,
				ignoreInitial: true,
				atomic: true,
				awaitWriteFinish: {
					stabilityThreshold: 100,
					pollInterval: 100,
				},
			})
			this.fileWatchers.set(filePath, watcher)
			watcher.on("error", (error) => {
				if (this.fileWatchers.get(filePath) !== watcher) return
				this.fileWatchers.delete(filePath)
				Logger.error(`File context live tracking is disabled for ${filePath} after watcher failure:`, error)
				void this.watcherCloser
					.close(watcher)
					.catch((closeError) =>
						Logger.error(`Failed to close disabled file context watcher for ${filePath}:`, closeError),
					)
			})
			watcher.on("change", () => {
				if (this.fileWatchers.get(filePath) !== watcher) return
				const isDiracEdit = this.recentlyEditedByDirac.has(filePath)
				if (isDiracEdit) {
					this.recentlyEditedByDirac.delete(filePath)
				} else {
					this.recentlyModifiedFiles.add(filePath)
					void this.trackFileContext(filePath, "user_edited")
				}
			})
		} catch (error) {
			this.fileWatchers.delete(filePath)
			Logger.error(`File context live tracking could not start and is disabled for ${filePath}:`, error)
		}
	}

	/**
	 * Tracks a file operation in metadata and sets up a watcher for the file
	 * This is the main entry point for FileContextTracker and is called when a file is passed to Dirac via a tool, mention, or edit.
	 */
	async trackFileContext(filePath: string, operation: "read_tool" | "user_edited" | "dirac_edited" | "file_mentioned") {
		try {
			const cwd = await getCwd()
			if (!cwd) {
				Logger.info("No workspace folder available - cannot determine current working directory")
				return
			}

			// Add file to metadata
			await this.addFileToFileContextTracker(this.taskId, filePath, operation)

			// Set up file watcher for this file
			await this.setupFileWatcher(filePath)
		} catch (error) {
			Logger.error("Failed to track file operation:", error)
		}
	}

	/**
	 * Adds a file to the metadata tracker
	 * This handles the business logic of determining if the file is new, stale, or active.
	 * It also updates the metadata with the latest read/edit dates.
	 */
	async addFileToFileContextTracker(taskId: string, filePath: string, source: FileMetadataEntry["record_source"]) {
		try {
			await updateTaskMetadata(taskId, (metadata) => {
				const now = Date.now()

				metadata.files_in_context.forEach((entry) => {
					if (entry.path === filePath && entry.record_state === "active") entry.record_state = "stale"
				})

				const getLatestDateForField = (path: string, field: keyof FileMetadataEntry): number | null => {
					const relevantEntries = metadata.files_in_context
						.filter((entry) => entry.path === path && entry[field])
						.sort((a, b) => (b[field] as number) - (a[field] as number))
					return relevantEntries.length > 0 ? (relevantEntries[0][field] as number) : null
				}

				const newEntry: FileMetadataEntry = {
					path: filePath,
					record_state: "active",
					record_source: source,
					dirac_read_date: getLatestDateForField(filePath, "dirac_read_date"),
					dirac_edit_date: getLatestDateForField(filePath, "dirac_edit_date"),
					user_edit_date: getLatestDateForField(filePath, "user_edit_date"),
				}

				switch (source) {
					case "user_edited":
						newEntry.user_edit_date = now
						this.recentlyModifiedFiles.add(filePath)
						break
					case "dirac_edited":
						newEntry.dirac_read_date = now
						newEntry.dirac_edit_date = now
						break
					case "read_tool":
					case "file_mentioned":
						newEntry.dirac_read_date = now
						break
				}

				metadata.files_in_context.push(newEntry)
			})
		} catch (error) {
			Logger.error("Failed to add file to metadata:", error)
		}
	}

	/**
	 * Returns (and then clears) the set of recently modified files
	 */
	getAndClearRecentlyModifiedFiles(): string[] {
		const files = Array.from(this.recentlyModifiedFiles)
		this.recentlyModifiedFiles.clear()
		return files
	}

	/**
	 * Marks a file as edited by Dirac to prevent false positives in file watchers
	 */
	markFileAsEditedByDirac(filePath: string): void {
		this.recentlyEditedByDirac.add(filePath)
	}

	/**
	 * Disposes all file watchers
	 */
	async dispose(): Promise<void> {
		const watchers = Array.from(this.fileWatchers.values())
		this.fileWatchers.clear()
		await this.watcherCloser.closeAll(watchers)
	}

	/**
	 * Detects files that were edited by Dirac or users after a specific message timestamp
	 * This is used when restoring checkpoints to warn about potential file content mismatches
	 */
	async detectFilesEditedAfterMessage(messageTs: number, deletedMessages: DiracMessage[]): Promise<string[]> {
		const editedFiles: string[] = []

		try {
			// Check task metadata for files that were edited by Dirac or users after the message timestamp
			const taskMetadata = await getTaskMetadata(this.taskId)

			if (taskMetadata?.files_in_context) {
				for (const fileEntry of taskMetadata.files_in_context) {
					const diracEditedAfter = fileEntry.dirac_edit_date && fileEntry.dirac_edit_date > messageTs
					const userEditedAfter = fileEntry.user_edit_date && fileEntry.user_edit_date > messageTs

					if (diracEditedAfter || userEditedAfter) {
						editedFiles.push(fileEntry.path)
					}
				}
			}
		} catch (error) {
			Logger.error("Error checking file context metadata:", error)
		}

		// Also check deleted task messages for file operations
		for (const message of deletedMessages) {
			if (message.content.type === DiracMessageType.CARD && message.content.card.body) {
				try {
					const toolData = JSON.parse(message.content.card.body)
					// Legacy camelCase card `tool` values from persisted history — current producers emit snake_case tool ids.
					if ((toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") && toolData.path) {
						if (!editedFiles.includes(toolData.path)) {
							editedFiles.push(toolData.path)
						}
					}
				} catch (error) {
					Logger.error("Error checking task messages:", error)
				}
			}
		}
		return [...new Set(editedFiles)]
	}

	/**
	 * Stores pending file context warning in workspace state so it persists across task reinitialization
	 */
	async storePendingFileContextWarning(files: string[]): Promise<void> {
		try {
			const key = `pendingFileContextWarning_${this.taskId}`
			this.stateStore.setWorkspaceState(key, files)
		} catch (error) {
			Logger.error("Error storing pending file context warning:", error)
		}
	}

	/**
	 * Retrieves pending file context warning from workspace state (without clearing it)
	 */
	async retrievePendingFileContextWarning(): Promise<string[] | undefined> {
		try {
			const key = `pendingFileContextWarning_${this.taskId}`
			const files = this.stateStore.getWorkspaceStateKey(key) as string[] | undefined
			return files
		} catch (error) {
			Logger.error("Error retrieving pending file context warning:", error)
		}
		return undefined
	}

	/**
	 * Retrieves and clears pending file context warning from workspace state
	 */
	async retrieveAndClearPendingFileContextWarning(): Promise<string[] | undefined> {
		try {
			const files = await this.retrievePendingFileContextWarning()
			if (files) {
				this.stateStore.setWorkspaceState(`pendingFileContextWarning_${this.taskId}`, undefined)
				return files
			}
		} catch (error) {
			Logger.error("Error retrieving pending file context warning:", error)
		}
		return undefined
	}

	/**
	 * Static method to clean up orphaned pending file context warnings at startup
	 * This removes warnings for tasks that may no longer exist
	 */
	static async cleanupOrphanedWarnings(stateStore: FileContextStateStore): Promise<void> {
		const startTime = Date.now()
		try {
			const taskHistory = await readTaskHistoryFromState()
			const existingTaskIds = new Set(taskHistory.map((task) => task.id))
			const allStateKeys = Object.keys(stateStore.getAllWorkspaceStateEntries())
			const pendingWarningKeys = allStateKeys.filter((key) => key.startsWith("pendingFileContextWarning_"))

			const orphanedPendingContextTasks: string[] = []
			for (const key of pendingWarningKeys) {
				const taskId = key.replace("pendingFileContextWarning_", "")
				if (!existingTaskIds.has(taskId)) {
					orphanedPendingContextTasks.push(key)
				}
			}

			if (orphanedPendingContextTasks.length > 0) {
				for (const key of orphanedPendingContextTasks) {
					await stateStore.setWorkspaceState(key, undefined)
				}
			}

			const duration = Date.now() - startTime
			Logger.log(
				`FileContextTracker: Processed ${existingTaskIds.size} tasks, found ${pendingWarningKeys.length} pending warnings, ${orphanedPendingContextTasks.length} orphaned, deleted ${orphanedPendingContextTasks.length}, took ${duration}ms`,
			)
		} catch (error) {
			Logger.error("[FileContextTracker] Error cleaning up orphaned file context warnings:", error)
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/tools/adapters/traits/WorkspaceTraitBuilder.ts (lines 36-39)
```
		fingerprintWorkspace: async () => {
			const workspaceRoots = config.workspaceManager?.getRoots().map((root) => root.path) ?? [config.cwd]
			return await fingerprintWorkspaceRoots(workspaceRoots)
		},
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

