---
component_id: 6.2
component_name: Workspace Search, Indexing & Fingerprinting Services
---

# Workspace Search, Indexing & Fingerprinting Services

## Component Description

Provides workspace-level services for multi-root file searching, symbol indexing, workspace fingerprinting, and telemetry.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/workspace/WorkspaceFingerprint.ts (lines 74-87)
```
export async function fingerprintWorkspaceRoots(workspaceRoots: readonly string[]): Promise<string> {
	const roots = [...new Set(workspaceRoots.map((root) => path.resolve(root)))].sort(compareNames)
	if (roots.length === 0) throw new Error("No workspace roots are available for completion verification.")

	const hash = createHash("sha256")
	for (let index = 0; index < roots.length; index += 1) {
		const root = roots[index]
		const stats = await lstat(root)
		if (!stats.isDirectory()) throw new Error(`Completion verification workspace root is not a directory: ${root}`)
		hash.update(JSON.stringify(["root", index, path.basename(root)]))
		await appendDirectoryFingerprint(hash, root, "")
	}
	return hash.digest("hex")
}
```

### /Users/highlands/pools/Development/dirac/src/services/search/file-search.ts (lines 214-294)
```
export async function searchWorkspaceFilesMultiroot(
	query: string,
	workspaceManager: WorkspaceRootManager,
	limit = 20,
	selectedType?: "file" | "folder",
	workspaceHint?: string,
): Promise<{ path: string; type: "file" | "folder"; label?: string; workspaceName?: string }[]> {
	try {
		const workspaceRoots = workspaceManager?.getRoots?.() || []

		if (workspaceRoots.length === 0) {
			return []
		}

		let workspacesToSearch: WorkspaceRoot[] = []

		// Search only the user-specified workspace (Ex input: @frontend:/query)
		if (workspaceHint) {
			const targetWorkspace = workspaceRoots.find((root: WorkspaceRoot) => root.name === workspaceHint)
			if (targetWorkspace) {
				workspacesToSearch = [targetWorkspace]
			} else {
				return []
			}
		} else {
			// Search all workspaces if no hint provided
			workspacesToSearch = workspaceRoots
		}

		// Execute parallel searches across workspaces
		const searchPromises = workspacesToSearch.map(async (workspace) => {
			try {
				const results = await searchWorkspaceFiles(query, workspace.path, limit, selectedType, workspace.name)
				return results
			} catch (error) {
				Logger.error(`[searchWorkspaceFilesMultiroot] Error searching workspace ${workspace.name}:`, error)
				return []
			}
		})

		// Wait for all searches to finish, fatten, add workspace prefixes if needed
		const allResults = await Promise.all(searchPromises)
		let flatResults = allResults.flat()
		if (workspacesToSearch.length > 1) {
			const pathCounts = new Map<string, number>()
			for (const result of flatResults) {
				pathCounts.set(result.path, (pathCounts.get(result.path) || 0) + 1)
			}

			flatResults = flatResults.map((result) => {
				if (pathCounts.get(result.path)! > 1 && result.workspaceName) {
					return {
						...result,
						label: `${result.workspaceName}:/${result.path}`,
					}
				}
				return result
			})
		}

		// Apply fuzzy matching across all results if needed
		if (query.trim() && flatResults.length > limit) {
			const fzfModule = await import("fzf")
			const fzf = new fzfModule.Fzf(flatResults, {
				selector: (item: { label?: string; path: string }) => `${item.label || ""} ${item.label || ""} ${item.path}`,
				tiebreakers: [OrderbyMatchScore, fzfModule.byLengthAsc],
			})
			flatResults = fzf
				.find(query)
				.slice(0, limit)
				.map((result) => result.item)
		} else {
			flatResults = flatResults.slice(0, limit)
		}

		return flatResults
	} catch (error) {
		Logger.error("[searchWorkspaceFilesMultiroot] Error in multiroot search:", error)
		return []
	}
}
```


## Source Files:

- `src/services/search/file-search.ts`
- `src/services/symbol-index/SymbolIndexEligibility.ts`
- `src/services/symbol-index/SymbolIndexRuntime.ts`
- `src/services/telemetry/WorkspaceTelemetry.ts`
- `src/services/workspace/WorkspaceFingerprint.ts`

