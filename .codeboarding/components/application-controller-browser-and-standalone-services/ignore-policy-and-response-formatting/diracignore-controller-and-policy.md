---
component_id: 5.4.2
component_name: DiracIgnore Controller & Policy
---

# DiracIgnore Controller & Policy

## Component Description

Manages `.diracignore` lifecycle and enforces ignore policy rules and file access validation across workspace paths.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/ignore/DiracIgnoreController.ts (lines 17-76)
```
export class DiracIgnoreController {
	public yoloMode = false
	diracIgnoreContent: string | undefined

	private readonly ignorePolicy: DiracIgnorePolicy
	private fileWatcher?: IgnoreFileWatcher

	constructor(cwd: string, watcherFactory: WatcherFactory = chokidar.watch) {
		this.ignorePolicy = new DiracIgnorePolicy(cwd)
		this.diracIgnoreContent = undefined
		this.fileWatcher = new IgnoreFileWatcher(cwd, watcherFactory)
	}

	/** Load custom patterns and start watching .diracignore for changes. Must be called after construction. */
	async initialize(): Promise<void> {
		await this.fileWatcher?.start(() => this.loadDiracIgnore())
		await this.loadDiracIgnore()
	}

	/** Reload .diracignore from disk, resolving !include directives into the ignore instance. */
	private async loadDiracIgnore(): Promise<void> {
		try {
			await this.ignorePolicy.reload()
			this.diracIgnoreContent = this.ignorePolicy.content
		} catch (error) {
			Logger.error("Unexpected error loading .diracignore:", error)
		}
	}

	/** True if `filePath` is accessible (not ignored); paths outside cwd are allowed. */
	validateAccess(filePath: string): boolean {
		if (this.yoloMode) return true
		try {
			return this.ignorePolicy.allowsAbsolutePath(filePath)
		} catch (_error) {
			return true
		}
	}

	/** Returns the first blocked file argument in a file-reading command, or undefined if allowed. */
	validateCommand(command: string): string | undefined {
		if (this.yoloMode) return undefined
		return findBlockedCommandArgument(command, (path) => this.validateAccess(path))
	}

	/** Filter an array of paths, removing those that are ignored. Fails closed for security. */
	filterPaths(paths: string[]): string[] {
		try {
			return paths.filter((path) => this.validateAccess(path))
		} catch (error) {
			Logger.error("Error filtering paths:", error)
			return []
		}
	}

	async dispose(): Promise<void> {
		await this.fileWatcher?.dispose()
		this.fileWatcher = undefined
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/ignore/DiracIgnoreController.ts (lines 47-54)
```
	validateAccess(filePath: string): boolean {
		if (this.yoloMode) return true
		try {
			return this.ignorePolicy.allowsAbsolutePath(filePath)
		} catch (_error) {
			return true
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/shared/ignore/DiracIgnorePolicy.ts (lines 127-135)
```
export async function parseDiracIgnoreContent(content: string, cwd: string): Promise<ParsedDiracIgnoreContent> {
	if (!content.includes(INCLUDE_PREFIX)) return { content, includedPaths: new Set() }

	const resolvedLines = await Promise.all(content.split(/\r?\n/).map((line) => resolveIgnoreLine(line, cwd)))
	return {
		content: resolvedLines.map((line) => line.content).join("\n"),
		includedPaths: new Set(resolvedLines.flatMap((line) => (line.includedPath ? [line.includedPath] : []))),
	}
}
```


## Source Files:

- `src/core/ignore/DiracIgnoreController.ts`
- `src/shared/ignore/DiracIgnorePolicy.ts`

