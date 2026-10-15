---
component_id: 6.1.2
component_name: Multi-Root Workspace & Code Approval Management
---

# Multi-Root Workspace & Code Approval Management

## Component Description

Provides multi-root workspace resolution, path adaptation, root management, and workspace code execution approval.

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

### /Users/highlands/pools/Development/dirac/src/core/workspace/setup.ts (lines 20-108)
```
export async function setupWorkspaceManager({
	stateManager,
	detectRoots,
}: {
	stateManager: StateManager
	historyItem?: HistoryItem
	detectRoots: DetectRoots
}): Promise<WorkspaceRootManager> {
	const cwd = await getCwd(getDesktopDir())
	const startTime = performance.now()
	const multiRootEnabled = isMultiRootEnabled(stateManager)
	try {
		let manager: WorkspaceRootManager
		// Multi-root mode condition - requires both feature flag and user setting to be enabled
		if (multiRootEnabled) {
			// Multi-root: detect workspace folders
			const roots = await detectRoots()
			manager = new WorkspaceRootManager(roots, 0)
			Logger.log(`[WorkspaceManager] Multi-root mode: ${roots.length} roots detected`)

			// Telemetry
			telemetryService.captureWorkspaceInitialized(
				roots.length,
				roots.map((r) => r.vcs.toString()),
				performance.now() - startTime,
				true,
			)

			// Persist
			stateManager.setGlobalState("workspaceRoots", manager.getRoots())
			stateManager.setGlobalState("primaryRootIndex", manager.getPrimaryIndex())
			return manager
		}

		// Single-root mode code for when we actually start using workspacerootmanager
		// if (historyItem) {
		// 	const savedRoots = stateManager.getWorkspaceRoots()
		// 	if (savedRoots && savedRoots.length > 0) {
		// 		const primaryIndex = stateManager.getPrimaryRootIndex()
		// 		manager = new WorkspaceRootManager(savedRoots, primaryIndex)
		// 		Logger.log(`[WorkspaceManager] Restored ${savedRoots.length} roots from state`)
		// 		telemetryService.captureWorkspaceInitialized(
		// 			savedRoots.length,
		// 			savedRoots.map((r) => r.vcs.toString()),
		// 			performance.now() - startTime,
		// 			false,
		// 		)
		// 	} else {
		// 		manager = await WorkspaceRootManager.fromLegacyCwd(cwd)
		// 		telemetryService.captureWorkspaceInitialized(
		// 			1,
		// 			[manager.getRoots()[0].vcs.toString()],
		// 			performance.now() - startTime,
		// 			false,
		// 		)
		// 	}
		// }

		manager = await WorkspaceRootManager.fromLegacyCwd(cwd)
		telemetryService.captureWorkspaceInitialized(
			1,
			[manager.getRoots()[0].vcs.toString()],
			performance.now() - startTime,
			false,
		)

		Logger.log(`[WorkspaceManager] Single-root mode: ${cwd}`)
		const roots = manager.getRoots()
		stateManager.setGlobalState("workspaceRoots", roots)
		stateManager.setGlobalState("primaryRootIndex", manager.getPrimaryIndex())
		return manager
	} catch (error) {
		// Telemetry + graceful fallback to single-root from cwd
		const workspaceCount = (await HostProvider.workspace.getWorkspacePaths({})).paths?.length
		telemetryService.captureWorkspaceInitError(error as Error, true, workspaceCount)

		Logger.error("[WorkspaceManager] Initialization failed:", error)
		const manager = await WorkspaceRootManager.fromLegacyCwd(cwd)
		const roots = manager.getRoots()
		stateManager.setGlobalState("workspaceRoots", roots)
		stateManager.setGlobalState("primaryRootIndex", manager.getPrimaryIndex())

		HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: "Failed to initialize workspace. Using single folder mode.",
		})
		return manager
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/security/WorkspaceCodeApproval.ts (lines 66-100)
```
export async function approvedWorkspaceCode(
	workspaceRoot: string,
	entrypoint: string,
	manifest?: string,
	prompt = false,
): Promise<WorkspaceCodeSnapshot | undefined> {
	return approvalMutex.withLock(async () => {
		const { key, snapshot } = await fingerprint(workspaceRoot, entrypoint, manifest)
		const file = await grantsPath()
		const grants = await readGrants(file)
		if (!HostProvider.get().isWorkspaceTrusted()) return undefined
		if (grants.includes(key)) return snapshot
		if (!prompt || HostProvider.get().diracType !== "extension") return undefined
		const [root, relative, target, digest] = JSON.parse(key) as string[]
		const decision = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `Trust workspace code: ${relative}?`,
			options: {
				modal: true,
				items: [REVIEW, APPROVE],
				detail: `Workspace: ${root}\nResolved target: ${target}\nSHA-256: ${digest}\nOnly these exact file contents will be trusted. Review the code before approving.`,
			},
		})
		if (decision.selectedOption === REVIEW) {
			await HostProvider.window.showTextDocument({ path: target })
			return undefined
		}
		if (decision.selectedOption !== APPROVE) return undefined
		// A checkout may have changed while the modal was open. Never grant approval for unseen bytes.
		const current = await fingerprint(workspaceRoot, entrypoint, manifest)
		if (current.key !== key) return undefined
		await atomicWriteFile(file, JSON.stringify([...grants, key]))
		return current.snapshot
	})
}
```


## Source Files:

- `src/core/security/WorkspaceCodeApproval.ts`
- `src/core/workspace/MigrationReporter.ts`
- `src/core/workspace/WorkspacePathAdapter.ts`
- `src/core/workspace/WorkspaceResolver.ts`
- `src/core/workspace/WorkspaceRootManager.ts`
- `src/core/workspace/detection.ts`
- `src/core/workspace/multi-root-utils.ts`
- `src/core/workspace/setup.ts`
- `src/core/workspace/utils/parseWorkspaceInlinePath.ts`
- `src/core/workspace/utils/workspace-detection.ts`

