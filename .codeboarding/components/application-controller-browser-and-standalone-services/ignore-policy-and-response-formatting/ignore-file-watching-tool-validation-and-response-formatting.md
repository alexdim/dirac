---
component_id: 5.4.1
component_name: Ignore File Watching, Tool Validation & Response Formatting
---

# Ignore File Watching, Tool Validation & Response Formatting

## Component Description

Validates tool paths and command access, watches ignore files for changes, parses ignore patterns, and formats file lists and responses according to ignore rules.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/formatResponse.ts (lines 138-203)
```
	formatFilesList: (
		absolutePath: string,
		files: FileInfo[],
		didHitLimit: boolean,
		diracIgnoreController?: DiracIgnoreController,
	): string => {
		const pathMap = new Map<string, FileInfo>(files.map((f) => [f.path, f]))

		const sorted = files.sort((a, b) => {
			const aParts = a.path.split("/")
			const bParts = b.path.split("/")
			for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
				if (aParts[i] !== bParts[i]) {
					const aPathAtLevel = aParts.slice(0, i + 1).join("/") + (i + 1 < aParts.length ? "/" : "")
					const bPathAtLevel = bParts.slice(0, i + 1).join("/") + (i + 1 < bParts.length ? "/" : "")

					const aInfo = pathMap.get(aPathAtLevel)
					const bInfo = pathMap.get(bPathAtLevel)

					if (aInfo && bInfo) {
						if (bInfo.mtime !== aInfo.mtime) {
							return bInfo.mtime - aInfo.mtime // Newest first
						}
					}

					// Fallback to alphabetical
					return aParts[i].localeCompare(bParts[i], undefined, {
						numeric: true,
						sensitivity: "base",
					})
				}
			}
			return aParts.length - bParts.length
		})

		const filtered = diracIgnoreController ? sorted.filter((file) => diracIgnoreController.validateAccess(file.path)) : sorted

		const formatted = filtered.map((file) => {
			let relativePath = path.relative(absolutePath, file.path).toPosix()
			if (relativePath === "" && !file.isDirectory) {
				relativePath = path.basename(file.path)
			}
			const displayPath = file.isDirectory ? (relativePath.endsWith("/") ? relativePath : `${relativePath}/`) : relativePath
			const lineCountSuffix = file.lineCount !== undefined ? ` ${file.lineCount} lines` : ""
			return `${displayPath}${lineCountSuffix}`
		})

		const note = "[Note: Files are sorted by most recently modified first within each directory.]\n\n"

		if (formatted.length === 0 || (formatted.length === 1 && formatted[0] === "")) {
			return "No files found."
		}

		const totalCount = formatted.length
		const summary = didHitLimit
			? `${totalCount} elements listed below (limit reached):`
			: `${totalCount} out of ${totalCount} elements listed below:`

		if (didHitLimit) {
			return `${note}${summary}\n\n${formatted.join(
				"\n",
			)}\n\n(File list truncated. Use list_files on specific subdirectories if you need to explore further.)`
		}

		return `${note}${summary}\n\n${formatted.join("\n")}`
	},
```

### /Users/highlands/pools/Development/dirac/src/core/ignore/IgnoreFileWatcher.ts (lines 10-69)
```
export class IgnoreFileWatcher {
	private watcher?: ReturnType<WatcherFactory>
	private readonly watcherCloser = new ChokidarWatcherCloser()
	private disposed = false

	constructor(
		private readonly cwd: string,
		private readonly watcherFactory: WatcherFactory,
	) {}

	async start(onReload: () => Promise<void> | void): Promise<void> {
		await this.watcherCloser.closeAll()
		if (this.disposed) return
		const ignorePath = path.join(this.cwd, ".diracignore")
		try {
			const watcher = this.watcherFactory(ignorePath, {
				persistent: true, // Keep the process running as long as files are being watched
				ignoreInitial: true, // Don't fire 'add' events when discovering the file initially
				awaitWriteFinish: {
					// Wait for writes to finish before emitting events (handles chunked writes)
					stabilityThreshold: 100, // Wait 100ms for file size to remain constant
					pollInterval: 100, // Check file size every 100ms while waiting for stability
				},
				atomic: true, // Handle atomic writes where editors write to a temp file then rename
			})
			this.watcher = watcher
			const reload = () => {
				if (this.watcher !== watcher) return
				try {
					void Promise.resolve(onReload()).catch((reloadError) =>
						Logger.error("Failed to reload .diracignore after file change:", reloadError),
					)
				} catch (reloadError) {
					Logger.error("Failed to reload .diracignore after file change:", reloadError)
				}
			}
			watcher.on("error", (error) => {
				if (this.watcher !== watcher) return
				this.watcher = undefined
				Logger.error("Error watching .diracignore file; live reload is disabled:", error)
				void this.watcherCloser
					.close(watcher)
					.catch((closeError) => Logger.error("Failed to close disabled .diracignore watcher:", closeError))
			})
			watcher.on("change", reload)
			watcher.on("add", reload)
			watcher.on("unlink", reload)
		} catch (error) {
			this.watcher = undefined
			Logger.error("Failed to start .diracignore watcher; live reload is disabled:", error)
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true
		const watcher = this.watcher
		this.watcher = undefined
		await this.watcherCloser.closeAll(watcher ? [watcher] : [])
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/ignore/IgnorePatternParser.ts (lines 8-10)
```
export async function parseIgnoreContent(content: string, cwd: string): Promise<string> {
	return (await parseDiracIgnoreContent(content, cwd)).content
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/tools/ToolValidator.ts (lines 40-49)
```
	checkDiracIgnorePath(relPath: string): ValidationResult {
		const accessAllowed = this.diracIgnoreController.validateAccess(relPath)
		if (!accessAllowed) {
			return {
				ok: false,
				error: `Access to path '${relPath}' is blocked by .diracignore settings.`,
			}
		}
		return { ok: true }
	}
```


## Source Files:

- `src/core/formatResponse.ts`
- `src/core/ignore/CommandAccessValidator.ts`
- `src/core/ignore/IgnoreFileWatcher.ts`
- `src/core/ignore/IgnorePatternParser.ts`
- `src/core/task/tools/ToolValidator.ts`
- `src/services/glob/list-files.ts`
- `src/utils/worktree-include.ts`

