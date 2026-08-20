import chokidar from "chokidar"
import { DiracIgnorePolicy } from "@/shared/ignore/DiracIgnorePolicy"
import { Logger } from "@/shared/services/Logger"
import { findBlockedCommandArgument } from "./CommandAccessValidator"
import { IgnoreFileWatcher } from "./IgnoreFileWatcher"
import type { WatcherFactory } from "./IgnorePatterns"

export type { WatcherFactory } from "./IgnorePatterns"
// Re-export public API symbols so existing import sites keep working
export { LOCK_TEXT_SYMBOL } from "./IgnorePatterns"

/**
 * Orchestrates .diracignore loading, file watching, and access validation.
 * Pattern parsing, include resolution, file watching, and command validation
 * are delegated to focused collaborators.
 */
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
