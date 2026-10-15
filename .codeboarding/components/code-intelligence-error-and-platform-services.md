---
component_id: 7
component_name: Code Intelligence, Error & Platform Services
---

# Code Intelligence, Error & Platform Services

## Component Description

Provides AST analysis, Tree-sitter parsing, symbol indexing, ripgrep search, error reporting, remote banners, and telemetry provider backends.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/source-ast/SourceAstService.ts (lines 21-222)
```
export class SourceAstService {
	private readonly definitionCatalog: SourceDefinitionCatalog
	private readonly occurrenceResolver: SourceOccurrenceResolver
	private readonly mutationPlanner: SourceMutationPlanner

	constructor(private readonly dependencies: SourceAstDependencies) {
		this.definitionCatalog = new SourceDefinitionCatalog({
			validateAccess: dependencies.validateAccess,
			reconcileAnchors: dependencies.reconcileAnchors,
		})
		this.occurrenceResolver = new SourceOccurrenceResolver({
			root: dependencies.root,
			resolvePath: dependencies.resolvePath,
			validateAccess: dependencies.validateAccess,
			reconcileAnchors: dependencies.reconcileAnchors,
			definitionCatalog: this.definitionCatalog,
		})
		this.mutationPlanner = new SourceMutationPlanner({
			resolvePath: dependencies.resolvePath,
			definitionCatalog: this.definitionCatalog,
			occurrenceResolver: this.occurrenceResolver,
		})
	}

	public async outline(request: AstOutlineRequest): Promise<AstOutlineResult> {
		const files: AstOutlineFileResult[] = []
		for (const requestedPath of request.paths) {
			let resolved
			try {
				resolved = await this.dependencies.resolvePath(requestedPath)
			} catch (error) {
				files.push({
					path: requestedPath,
					status: "inaccessible" as const,
					definitions: [],
					lines: [],
					message: `Unable to resolve ${requestedPath}: ${this.errorMessage(error)}`,
				})
				continue
			}
			const catalogResult = await this.definitionCatalog.load(resolved.absolutePath, {
				displayPath: resolved.displayPath,
				includeAnchors: request.includeAnchors,
				showCallGraph: request.showCallGraph,
			})
			if (catalogResult.status !== "success") {
				files.push({
					path: requestedPath,
					absolutePath: resolved.absolutePath,
					status: catalogResult.status,
					definitions: [],
					lines: [],
					message: catalogResult.message,
				})
				continue
			}
			const catalog = catalogResult.catalog
			const anchors = request.includeAnchors
				? this.dependencies.reconcileAnchors(catalog.absolutePath, catalog.lines)
				: []
			const seenLines = new Set<number>()
			const lines = catalog.definitions.flatMap((definition) => {
				if (seenLines.has(definition.declarationLine)) return []
				seenLines.add(definition.declarationLine)
				return [{
					lineNumber: definition.declarationLine + 1,
					text: definition.declarationText,
					...(anchors[definition.declarationLine] ? { anchor: anchors[definition.declarationLine] } : {}),
				}]
			})
			files.push({
				path: requestedPath,
				absolutePath: catalog.absolutePath,
				status: catalog.definitions.length > 0 ? "success" as const : "not_found" as const,
				definitions: catalog.definitions,
				lines,
				...(catalog.definitions.length === 0 ? { message: `No definitions found in ${resolved.displayPath}.` } : {}),
			})
		}
		return { files }
	}

	public async implementations(request: AstImplementationRequest): Promise<AstImplementationResult> {
		const targets: AstImplementationTargetResult[] = []
		for (const requestedPath of request.paths) {
			let resolved
			try {
				resolved = await this.dependencies.resolvePath(requestedPath)
			} catch (error) {
				for (const symbol of request.symbols) {
					targets.push({
						path: requestedPath,
						symbol,
						status: "inaccessible" as const,
						message: `Unable to resolve ${requestedPath}: ${this.errorMessage(error)}`,
					})
				}
				continue
			}

			const catalogResult = await this.definitionCatalog.load(resolved.absolutePath, {
				displayPath: resolved.displayPath,
				includeAnchors: request.includeAnchors,
				includeContext: true,
				showCallGraph: true,
			})
			if (catalogResult.status !== "success") {
				for (const symbol of request.symbols) {
					targets.push({
						path: requestedPath,
						absolutePath: resolved.absolutePath,
						symbol,
						status: catalogResult.status,
						message: catalogResult.message,
					})
				}
				continue
			}

			const catalog = catalogResult.catalog
			const anchors = request.includeAnchors
				? this.dependencies.reconcileAnchors(catalog.absolutePath, catalog.lines)
				: []
			for (const symbol of request.symbols) {
				const match = this.definitionCatalog.match(catalog.definitions, symbol)
				if (match.status === "not_found") {
					targets.push({
						path: requestedPath,
						absolutePath: catalog.absolutePath,
						symbol,
						status: "not_found" as const,
						message: `Symbol not found: ${symbol} in ${resolved.displayPath}.`,
					})
					continue
				}
				if (match.status === "ambiguous") {
					targets.push({
						path: requestedPath,
						absolutePath: catalog.absolutePath,
						symbol,
						status: "ambiguous" as const,
						message: `Ambiguous symbol '${symbol}' in ${resolved.displayPath}.`,
						candidates: match.candidates.map(({ qualifiedName, kind, declarationLine }) => ({
							qualifiedName,
							kind,
							declarationLine,
						})),
					})
					continue
				}

				const definition = match.definition
				const range = definition.replacementRange
				const content = catalog.content.slice(range.startIndex, range.endIndex)
				const rawLines = content.split(/\r?\n/)
				const implementationLines = request.includeAnchors && range.endColumn === 0 && rawLines.at(-1) === ""
					? rawLines.slice(0, -1)
					: rawLines
				const lines: SourceLine[] = implementationLines.map((text, index) => {
					const sourceLineIndex = range.startLine + index
					return {
						lineNumber: sourceLineIndex + 1,
						text: request.includeAnchors ? (catalog.lines[sourceLineIndex] ?? text) : text,
						...(anchors[sourceLineIndex] ? { anchor: anchors[sourceLineIndex] } : {}),
					}
				})
				targets.push({
					path: requestedPath,
					absolutePath: catalog.absolutePath,
					symbol,
					status: "success" as const,
					definition,
					content,
					contentHash: contentHash(content),
					lines,
					contextLines: definition.contextLines,
				})
			}
		}
		return { targets }
	}

	public async occurrences(request: AstOccurrenceRequest): Promise<AstOccurrenceResult> {
		return this.occurrenceResolver.resolve(request)
	}

	public async planRename(request: AstRenameRequest): Promise<SourceMutationPlan> {
		return this.mutationPlanner.planRename(request)
	}

	public async planReplacements(request: AstReplacementRequest): Promise<SourceMutationPlan> {
		return this.mutationPlanner.planReplacements(request)
	}

	public getAnchorFingerprint(path: string): string | null {
		return this.dependencies.getAnchorFingerprint(path)
	}

	private errorMessage(error: unknown): string {
		return getErrorMessage(error)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/symbol-index/SymbolIndexService.ts (lines 46-611)
```
export class SymbolIndexService {
	private static instance: SymbolIndexService | null = null
	private static readonly DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024
	private static readonly MAX_FIRST_LINE_LENGTH = 5000
	private static readonly MAX_AVERAGE_LINE_LENGTH = 2000
	private static readonly INDEX_DIR = ".dirac-cache"
	private static readonly INDEX_FILE = "symbol-index.db"
	private static readonly LEGACY_INDEX_DIR = ".dirac-symbol-index"
	private static readonly LEGACY_INDEX_FILE = "data.db"
	private static readonly MAX_STALE_LOOKUP_PASSES = 10
	private static readonly REMOVAL_BATCH_SIZE = 100
	private static readonly INDEXING_BATCH_SIZE = 10
	private static readonly PROGRESS_LOG_BATCH_INTERVAL = 10
	private static readonly COMPACTION_MIN_RECLAIMABLE_BYTES = 64 * 1024 * 1024
	private static readonly COMPACTION_MIN_FREE_RATIO = 0.25

	private projectRoot = ""
	private db: SymbolIndexDatabase | null = null
	private eligibility: SymbolIndexEligibility | null = null
	private runtime: SymbolIndexRuntime | null = null
	private retryTimeout: NodeJS.Timeout | null = null
	private isScanningInternal = false
	private isPersistenceEnabled = true
	private skipRepoCheck = false
	private maxFileSizeBytes = SymbolIndexService.DEFAULT_MAX_FILE_SIZE_BYTES
	private operationTail: Promise<void> = Promise.resolve()
	private activeReconciliation: Promise<void> | null = null
	private queuedReconciliationReason: string | null = null
	private eligiblePaths = new Set<string>()
	private externalControlPaths = new Set<string>()
	private disposed = false

	private constructor() {}

	public static getInstance(): SymbolIndexService {
		if (!SymbolIndexService.instance) SymbolIndexService.instance = new SymbolIndexService()
		return SymbolIndexService.instance
	}

	public getProjectRoot(): string {
		return this.projectRoot
	}

	public isScanning(): boolean {
		return this.isScanningInternal
	}

	public setSkipRepoCheck(skip: boolean): void {
		this.skipRepoCheck = skip
	}

	public setPersistenceEnabled(enabled: boolean): void {
		this.isPersistenceEnabled = enabled
	}

	public setMaxFileSizeBytes(maxFileSizeBytes: number): void {
		this.maxFileSizeBytes = maxFileSizeBytes
	}

	public shouldIndexPath(absolutePath: string): boolean {
		if (!this.projectRoot) return false
		return (this.eligibility ?? new SymbolIndexEligibility(this.projectRoot)).admitsAbsolutePath(absolutePath)
	}

	public async initialize(projectRoot: string): Promise<void> {
		Logger.info(`[SymbolIndexService] Initializing for root: ${projectRoot}`)
		if (this.projectRoot === projectRoot && this.db) return
		if (!this.skipRepoCheck && !(await this.isRepository(projectRoot))) {
			Logger.info(`[SymbolIndexService] ${projectRoot} is not a repository; symbol indexing is disabled`)
			return
		}

		this.disposed = false
		await this.resetProjectDatabase(projectRoot)
		if (this.disposed) return

		this.runtime = new SymbolIndexRuntime(projectRoot, {
			admitsPath: (absolutePath) => this.shouldIndexPath(absolutePath),
			excludesPath: (absolutePath) => this.eligibility?.excludesAbsolutePath(absolutePath) ?? true,
			isControlPath: (absolutePath) => this.eligibility?.isControlPath(absolutePath) ?? false,
			applyWatcherEvents: (events) => this.applyWatcherEvents(events),
			requestReconciliation: (reason) => this.requestReconciliation(reason),
		})
		try {
			const controlPaths = await this.eligibility!.prepareControlPaths()
			this.externalControlPaths = controlPaths.externalControlPaths
			this.runtime.refreshExternalControlPaths(this.externalControlPaths)
		} catch (error) {
			SymbolIndexTelemetry.recordFailure()
			Logger.error("[SymbolIndexService] Failed to prepare eligibility control watchers", error)
		}
		await this.requestReconciliation("initial")
	}

	public async updateFile(absolutePath: string): Promise<void> {
		await this.applyWatcherEvents([{ absolutePath, kind: "change" }])
	}

	public async removeFile(absolutePath: string): Promise<void> {
		await this.applyWatcherEvents([{ absolutePath, kind: "remove" }])
	}

	public requestFullRescan(): void {
		void this.requestReconciliation("requested rescan")
	}

	public requestReconciliation(reason: string): Promise<void> {
		if (!this.db || !this.eligibility || this.disposed) return Promise.resolve()
		if (this.activeReconciliation) {
			this.queuedReconciliationReason = reason
			return this.activeReconciliation
		}

		const reconciliation = this.enqueueOperation(() => this.runReconciliationQueue(reason))
		this.activeReconciliation = reconciliation.finally(() => {
			this.activeReconciliation = null
		})
		return this.activeReconciliation
	}

	public dispose(): void {
		this.disposed = true
		if (this.retryTimeout) clearTimeout(this.retryTimeout)
		this.retryTimeout = null
		if (this.runtime) void this.runtime.dispose()
		this.runtime = null

		this.db?.close()
		this.db = null
		SymbolIndexTelemetry.logSummary("deactivation")
	}

	public getSymbols(symbol: string, type?: "definition" | "reference", limit?: number): SymbolLocation[] {
		if (!this.db) return []
		let locations: SymbolLocation[] = []
		for (let pass = 0; pass < SymbolIndexService.MAX_STALE_LOOKUP_PASSES; pass++) {
			locations = this.db.getSymbolsByName(symbol, type, limit)
			const stalePaths = this.findMissingResultPaths(locations)
			if (stalePaths.length === 0) return locations
			if (this.removeStaleIndexedPaths(stalePaths, "symbol lookup") === 0) return locations
		}
		return locations
	}

	public getReferences(symbol: string, limit?: number): SymbolLocation[] {
		return this.getSymbols(symbol, "reference", limit)
	}

	public getDefinitions(symbol: string, limit?: number): SymbolLocation[] {
		return this.getSymbols(symbol, "definition", limit)
	}

	private async runReconciliationQueue(initialReason: string): Promise<void> {
		let reason: string | null = initialReason
		while (reason) {
			try {
				await this.reconcile(reason)
			} catch (error) {
				SymbolIndexTelemetry.recordFailure()
				Logger.error(`[SymbolIndexService] Reconciliation failed (${reason}); completed batches retained`, error)
			}
			reason = this.queuedReconciliationReason
			this.queuedReconciliationReason = null
		}
	}

	private async reconcile(reason: string): Promise<boolean> {
		const db = this.db
		const eligibility = this.eligibility
		if (!db || !eligibility || this.disposed) return false

		this.isScanningInternal = true
		try {
			const eligibilityResult = await eligibility.enumerate()
			if (this.disposed || this.db !== db) return false
			const eligiblePaths = eligibilityResult.paths
			const existingMetadata = db.getAllFilesMetadata()
			const ineligiblePaths = [...existingMetadata.keys()].filter((relPath) => !eligiblePaths.has(relPath))
			const candidates: FileCandidate[] = []
			const rejectedPaths: string[] = []

			for (const relPath of eligiblePaths) {
				const absolutePath = path.join(this.projectRoot, relPath)
				try {
					const stats = await fs.stat(absolutePath)
					if (!stats.isFile()) {
						rejectedPaths.push(relPath)
						continue
					}
					const existing = existingMetadata.get(relPath)
					if (
						existing &&
						Math.floor(existing.mtime / 1_000) === Math.floor(stats.mtimeMs / 1_000) &&
						existing.size === stats.size
					)
						continue
					candidates.push({ absolutePath, relPath })
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
					rejectedPaths.push(relPath)
				}
			}

			const removalPaths = [...ineligiblePaths, ...rejectedPaths]
			const removedBeforeParsing = await this.applyRemovalBatches(db, removalPaths, reason)
			if (this.disposed || this.db !== db) return removedBeforeParsing > 0
			const candidateResult = await this.applyCandidateBatches(db, candidates, reason)
			if (this.disposed || this.db !== db) return removedBeforeParsing > 0 || candidateResult.changed

			this.eligiblePaths = eligiblePaths
			this.externalControlPaths = eligibilityResult.externalControlPaths
			if (candidateResult.retryRequested) this.rescheduleChangedDuringRead()
			this.runtime?.refreshExternalControlPaths(this.externalControlPaths)
			const removed = removedBeforeParsing + candidateResult.removed
			this.compactDatabaseIfNeeded(db, reason)
			SymbolIndexTelemetry.recordReconciliation(eligiblePaths.size, removed, candidateResult.replaced)
			return removed > 0 || candidateResult.changed
		} finally {
			this.isScanningInternal = false
		}
	}

	private enqueueOperation(operation: () => Promise<void>): Promise<void> {
		const queuedOperation = this.operationTail.then(operation)
		this.operationTail = queuedOperation.catch(() => {})
		return queuedOperation
	}

	private applyWatcherEvents(events: readonly SymbolIndexWatcherEvent[]): Promise<void> {
		if (events.length === 0) return Promise.resolve()
		return this.enqueueOperation(() => this.applyWatcherEventsSerially(events))
	}

	private async applyWatcherEventsSerially(events: readonly SymbolIndexWatcherEvent[]): Promise<void> {
		const db = this.db
		const eligibility = this.eligibility
		if (!db || !eligibility || this.disposed) return
		SymbolIndexTelemetry.recordUpdateRun()

		const removedPaths = new Set<string>()
		const removedPathHints = new Set<string>()
		const candidatePaths = new Map<string, FileCandidate>()
		let directoryChangeDetected = false

		for (const event of events) {
			const relPath = path.normalize(path.relative(this.projectRoot, event.absolutePath))
			if (relPath === ".." || relPath.startsWith(`..${path.sep}`) || path.isAbsolute(relPath)) {
				SymbolIndexTelemetry.recordWatcherRejected()
				continue
			}

			if (event.kind === "remove") {
				removedPathHints.add(relPath)
				continue
			}

			let stats
			try {
				stats = await fs.stat(event.absolutePath)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
				removedPathHints.add(relPath)
				continue
			}

			if (stats.isDirectory()) {
				directoryChangeDetected = true
				continue
			}
			if (!stats.isFile() || !eligibility.admitsRelativePath(relPath)) {
				if (this.eligiblePaths.has(relPath)) removedPaths.add(relPath)
				SymbolIndexTelemetry.recordWatcherRejected()
				continue
			}
			candidatePaths.set(relPath, { absolutePath: event.absolutePath, relPath })
		}

		this.collectRemovedPaths(removedPathHints, removedPaths)

		const eligibleAbsolutePaths = await eligibility.filterAbsolutePaths(
			[...candidatePaths.values()].map((candidate) => candidate.absolutePath),
		)
		const eligibleCandidates: FileCandidate[] = []
		for (const candidate of candidatePaths.values()) {
			if (eligibleAbsolutePaths.has(candidate.absolutePath)) eligibleCandidates.push(candidate)
			else removedPaths.add(candidate.relPath)
		}

		await this.applyRemovalBatches(db, [...removedPaths], "watcher update")
		if (this.disposed || this.db !== db) return
		const candidateResult = await this.applyCandidateBatches(db, eligibleCandidates, "watcher update")
		if (this.disposed || this.db !== db) return

		for (const relPath of removedPaths) this.eligiblePaths.delete(relPath)
		for (const candidate of eligibleCandidates) this.eligiblePaths.add(candidate.relPath)
		if (candidateResult.retryRequested) this.rescheduleChangedDuringRead()
		if (directoryChangeDetected) void this.requestReconciliation("watcher directory change")
	}

	private collectRemovedPaths(relativePathHints: ReadonlySet<string>, removedPaths: Set<string>): void {
		const possibleDirectoryPaths = new Set<string>()
		for (const relativePath of relativePathHints) {
			if (this.eligiblePaths.has(relativePath)) removedPaths.add(relativePath)
			else possibleDirectoryPaths.add(relativePath)
		}
		if (possibleDirectoryPaths.size === 0) return
		if (possibleDirectoryPaths.has(".")) {
			for (const eligiblePath of this.eligiblePaths) removedPaths.add(eligiblePath)
			return
		}

		for (const eligiblePath of this.eligiblePaths) {
			let ancestorPath = path.dirname(eligiblePath)
			while (ancestorPath !== ".") {
				if (possibleDirectoryPaths.has(ancestorPath)) {
					removedPaths.add(eligiblePath)
					break
				}
				const parentPath = path.dirname(ancestorPath)
				if (parentPath === ancestorPath) break
				ancestorPath = parentPath
			}
		}
	}

	private compactDatabaseIfNeeded(db: SymbolIndexDatabase, reason: string): void {
		if (this.disposed || this.db !== db) return
		const before = db.getAllocation()
		const freeRatio = before.pageCount === 0 ? 0 : before.freelistCount / before.pageCount
		if (before.reclaimableBytes < SymbolIndexService.COMPACTION_MIN_RECLAIMABLE_BYTES) return
		if (freeRatio < SymbolIndexService.COMPACTION_MIN_FREE_RATIO) return

		Logger.info(
			`[SymbolIndexService] Compacting database reason=${reason} reclaimableBytes=${before.reclaimableBytes} freeRatio=${freeRatio.toFixed(3)}`,
		)
		db.compact()
		const after = db.getAllocation()
		Logger.info(
			`[SymbolIndexService] Compacted database reason=${reason} beforeBytes=${before.databaseBytes} afterBytes=${after.databaseBytes} reclaimedBytes=${before.databaseBytes - after.databaseBytes}`,
		)
	}

	private async applyRemovalBatches(
		db: SymbolIndexDatabase,
		relativePaths: readonly string[],
		reason: string,
	): Promise<number> {
		let removed = 0
		for (let offset = 0; offset < relativePaths.length; offset += SymbolIndexService.REMOVAL_BATCH_SIZE) {
			if (this.disposed || this.db !== db) return removed
			const batch = relativePaths.slice(offset, offset + SymbolIndexService.REMOVAL_BATCH_SIZE)
			removed += db.applyMutation({ removals: batch, replacements: [] }).removed
			const processed = Math.min(offset + batch.length, relativePaths.length)
			const batchNumber = Math.floor(offset / SymbolIndexService.REMOVAL_BATCH_SIZE) + 1
			if (processed === relativePaths.length || batchNumber % SymbolIndexService.PROGRESS_LOG_BATCH_INTERVAL === 0)
				Logger.info(
					`[SymbolIndexService] Removal progress reason=${reason} processed=${processed}/${relativePaths.length} removed=${removed}`,
				)
			await this.yieldAfterMutationBatch()
		}
		return removed
	}

	private async applyCandidateBatches(
		db: SymbolIndexDatabase,
		candidates: readonly FileCandidate[],
		reason: string,
	): Promise<{ changed: boolean; removed: number; replaced: number; retryRequested: boolean }> {
		let changed = false
		let removed = 0
		let replaced = 0
		let retryRequested = false
		for (let offset = 0; offset < candidates.length; offset += SymbolIndexService.INDEXING_BATCH_SIZE) {
			if (this.disposed || this.db !== db) break
			const batch = candidates.slice(offset, offset + SymbolIndexService.INDEXING_BATCH_SIZE)
			const staged = await this.stageFiles(batch)
			if (this.disposed || this.db !== db) break
			const mutation = db.applyMutation({ removals: staged.rejectedPaths, replacements: staged.replacements })
			changed ||= mutation.changed
			removed += mutation.removed
			replaced += mutation.replaced
			retryRequested ||= staged.retryRequested
			await this.yieldAfterMutationBatch()
		}
		return { changed, removed, replaced, retryRequested }
	}

	private async yieldAfterMutationBatch(): Promise<void> {
		await new Promise<void>((resolve) => setImmediate(resolve))
	}

	private async stageFiles(candidates: readonly FileCandidate[]): Promise<{
		replacements: FileSymbolReplacement[]
		rejectedPaths: string[]
		retryRequested: boolean
	}> {
		if (candidates.length === 0) return { replacements: [], rejectedPaths: [], retryRequested: false }
		const languageParsers = await loadRequiredLanguageParsers(candidates.map((candidate) => candidate.absolutePath))
		const replacements: FileSymbolReplacement[] = []
		const rejectedPaths: string[] = []
		let retryRequested = false

		for (const candidate of candidates) {
			const outcome = await this.indexFile(candidate.absolutePath, languageParsers)
			if (outcome.status === "indexed") replacements.push({ relPath: candidate.relPath, ...outcome.entry })
			else if (outcome.status === "rejected") rejectedPaths.push(candidate.relPath)
			else retryRequested = true
		}
		return { replacements, rejectedPaths, retryRequested }
	}

	private async indexFile(absolutePath: string, languageParsers: LanguageParsers): Promise<FileIndexOutcome> {
		let before
		try {
			before = await fs.stat(absolutePath)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "rejected", reason: "missing" }
			throw error
		}
		if (!before.isFile()) return { status: "rejected", reason: "not a file" }
		if (before.size > this.maxFileSizeBytes) {
			SymbolIndexTelemetry.recordSizeSkip()
			return { status: "rejected", reason: "oversized" }
		}

		const fileBuffer = await fs.readFile(absolutePath)
		const fileContent = fileBuffer.toString("utf8")
		let rejectionReason: string | null = null
		const symbols: FileIndexEntry["symbols"] = []
		if (this.isLikelyMinifiedOrGenerated(fileContent)) {
			SymbolIndexTelemetry.recordMinifiedSkip()
			rejectionReason = "generated or minified"
		}

		const extension = path.extname(absolutePath).toLowerCase().slice(1)
		const { parser, query } = languageParsers[extension] ?? {}
		if (!rejectionReason && (!parser || !query)) rejectionReason = "unsupported parser"

		let tree: Tree | null = null
		try {
			if (!rejectionReason && parser && query) {
				tree = parser.parse(fileContent)
				if (!tree?.rootNode) rejectionReason = "parse failure"
				else {
					for (const capture of query.captures(tree.rootNode)) {
						const { node, name } = capture
						if (name !== "name.reference" && !name.includes("name.definition")) continue
						symbols.push({
							n: fileContent.slice(node.startIndex, node.endIndex),
							t: name.includes("name.definition") ? "d" : "r",
							k: name.split(".").pop(),
							r: [node.startPosition.row, node.startPosition.column, node.endPosition.row, node.endPosition.column],
						})
					}
				}
			}
		} finally {
			tree?.delete()
		}

		let after
		try {
			after = await fs.stat(absolutePath)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "retry" }
			throw error
		}
		if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) return { status: "retry" }
		if (rejectionReason) return { status: "rejected", reason: rejectionReason }
		return { status: "indexed", entry: { mtime: after.mtimeMs, size: after.size, symbols } }
	}

	private rescheduleChangedDuringRead(): void {
		if (this.retryTimeout || this.disposed) return
		this.retryTimeout = setTimeout(() => {
			this.retryTimeout = null
			void this.requestReconciliation("file changed during indexing")
		}, 250)
		this.retryTimeout.unref()
	}

	private isLikelyMinifiedOrGenerated(fileContent: string): boolean {
		const lines = fileContent.split(/\r?\n/)
		if (lines[0]?.length > SymbolIndexService.MAX_FIRST_LINE_LENGTH) return true
		const totalLength = lines.reduce((total, line) => total + line.length, 0)
		return totalLength / Math.max(lines.length, 1) > SymbolIndexService.MAX_AVERAGE_LINE_LENGTH
	}

	private findMissingResultPaths(locations: SymbolLocation[]): string[] {
		if (!this.projectRoot) return []
		const stalePaths: string[] = []
		for (const relativePath of new Set(locations.map((location) => location.path))) {
			try {
				if (!statSync(path.join(this.projectRoot, relativePath)).isFile()) stalePaths.push(relativePath)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") stalePaths.push(relativePath)
			}
		}
		return stalePaths
	}

	private removeStaleIndexedPaths(relativePaths: readonly string[], reason: string): number {
		if (!this.db || relativePaths.length === 0) return 0
		const removed = this.db.removeFiles(relativePaths)
		if (removed > 0) {
			Logger.info(`[SymbolIndexService] Removed ${removed} stale indexed file(s) during ${reason}`)
		}
		return removed
	}

	private async resetProjectDatabase(projectRoot: string): Promise<void> {
		if (this.runtime) await this.runtime.dispose()
		this.runtime = null
		await this.operationTail
		if (this.db) this.db.close()
		this.projectRoot = projectRoot
		this.eligibility = new SymbolIndexEligibility(projectRoot)
		this.eligiblePaths = new Set()
		this.externalControlPaths = new Set()

		let databasePath: string | undefined
		if (this.isPersistenceEnabled) {
			await this.ensureIndexDir()
			databasePath = path.join(projectRoot, SymbolIndexService.INDEX_DIR, SymbolIndexService.INDEX_FILE)
		}
		this.db = await SymbolIndexDatabase.create(databasePath)
	}

	private async isRepository(directoryPath: string): Promise<boolean> {
		for (const vcsDirectory of [".git", ".hg", ".svn"]) {
			try {
				await fs.access(path.join(directoryPath, vcsDirectory))
				return true
			} catch {}
		}
		return new SymbolIndexEligibility(directoryPath).isGitWorkspace()
	}

	private async ensureIndexDir(): Promise<void> {
		const indexDirectory = path.join(this.projectRoot, SymbolIndexService.INDEX_DIR)
		const legacyIndexDirectory = path.join(this.projectRoot, SymbolIndexService.LEGACY_INDEX_DIR)
		const indexDirectoryExists = await this.pathExists(indexDirectory)
		const legacyIndexDirectoryExists = await this.pathExists(legacyIndexDirectory)
		if (legacyIndexDirectoryExists && indexDirectoryExists) await fs.rm(legacyIndexDirectory, { recursive: true })
		if (legacyIndexDirectoryExists && !indexDirectoryExists) await fs.rename(legacyIndexDirectory, indexDirectory)
		await fs.mkdir(indexDirectory, { recursive: true })
		await this.migrateLegacyIndexFile(indexDirectory)
	}

	private async migrateLegacyIndexFile(indexDirectory: string): Promise<void> {
		const legacyIndexFile = path.join(indexDirectory, SymbolIndexService.LEGACY_INDEX_FILE)
		if (!(await this.pathExists(legacyIndexFile))) return
		const indexFile = path.join(indexDirectory, SymbolIndexService.INDEX_FILE)
		if (await this.pathExists(indexFile)) await fs.rm(legacyIndexFile)
		else await fs.rename(legacyIndexFile, indexFile)
	}

	private async pathExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath)
			return true
		} catch {
			return false
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/error/ErrorService.ts (lines 11-96)
```
export class ErrorService {
	private static instance: ErrorService | null = null

	private provider: IErrorProvider

	/**
	 * Sets up the ErrorService singleton.
	 */
	public static async initialize(): Promise<ErrorService> {
		if (ErrorService.instance) {
			return ErrorService.instance
		}

		const provider = await ErrorProviderFactory.createProvider(ErrorProviderFactory.getDefaultConfig())
		ErrorService.instance = new ErrorService(provider)
		return ErrorService.instance
	}

	/**
	 * Gets the singleton instance
	 */
	public static get(): ErrorService {
		if (!ErrorService.instance) {
			throw new Error("ErrorService not setup. Call ErrorService.initialize() first.")
		}
		return ErrorService.instance
	}

	constructor(provider: IErrorProvider) {
		this.provider = provider
	}

	captureException(error: Error | DiracError, properties?: Record<string, unknown>) {
		return this.provider.captureException(error, properties)
	}

	public logException(error: Error | DiracError, properties?: Record<string, unknown>): void {
		this.provider.logException(error, properties)
		Logger.error("[ErrorService] Logging exception", JSON.stringify(error))
	}

	public logMessage(
		message: string,
		level: "error" | "warning" | "log" | "debug" | "info" = "log",
		properties?: Record<string, unknown>,
	): void {
		this.provider.logMessage(message, level, properties)
	}

	public toDiracError(rawError: unknown, modelId?: string, providerId?: string): DiracError {
		const transformed = DiracError.transform(rawError, modelId, providerId)
		this.logException(transformed, { modelId, providerId })
		return transformed
	}

	/**
	 * Check if error logging is currently enabled
	 * @returns Boolean indicating whether error logging is enabled
	 */
	public isEnabled(): boolean {
		return this.provider.isEnabled()
	}

	/**
	 * Get current error logging settings
	 * @returns Current error logging settings
	 */
	public getSettings() {
		return this.provider.getSettings()
	}

	/**
	 * Get the error provider instance
	 * @returns The current error provider
	 */
	public getProvider(): IErrorProvider {
		return this.provider
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		await this.provider.dispose()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/banner/BannerService.ts (lines 14-133)
```
export class BannerService {
	private static instance: BannerService | null = null

	private readonly validActionTypes: Set<string>
	readonly remote: RemoteBannerService
	private readonly welcome: WelcomeBannerService

	private constructor(controller: Controller, hostInfo: HostInfo) {
		this.validActionTypes = new Set(Object.values(BannerActionType))
		this.remote = new RemoteBannerService(controller, hostInfo)
		this.welcome = new WelcomeBannerService(
			this.remote,
			(bannerId) => this.isBannerDismissed(bannerId),
			(banner) => this.toBannerCardData(banner),
		)
		Logger.log("[BannerService] initialized")
	}

	public static initialize(controller: Controller): BannerService {
		if (BannerService.instance) return BannerService.instance
		const hostInfo = HostRegistryInfo.get()
		if (!hostInfo) throw new Error("[BannerService] Ensure HostRegistryInfo is initialized before BannerService.")
		BannerService.instance = new BannerService(controller, hostInfo)
		return BannerService.instance
	}

	public static get(): BannerService {
		if (!BannerService.instance) {
			throw new Error("BannerService not initialized. Call BannerService.initialize(controller) first.")
		}
		return BannerService.instance
	}

	public static reset(): void {
		const instance = BannerService.instance
		if (instance) {
			if (instance.remote?.debounceTimer) clearTimeout(instance.remote.debounceTimer)
			instance.remote?.abortController?.abort()
		}
		BannerService.instance = null
	}

	public static async onAuthUpdate(userId: string | null): Promise<void> {
		const instance = BannerService.instance
		if (!instance) return
		return instance.remote.onAuthUpdate(userId)
	}

	public getActiveBanners(): BannerCardData[] {
		this.remote.ensureFreshCache()

		return this.remote
			.getCachedBanners()
			.filter((b) => b.placement !== "welcome")
			.filter((b) => !this.isBannerDismissed(b.id))
			.map((b) => this.toBannerCardData(b))
			.filter((b): b is BannerCardData => b !== null)
	}

	/** Returns welcome banners for the What's New modal, or undefined when the feature flag is off. */
	public getWelcomeBanners(): BannerCardData[] | undefined {
		return this.welcome.getWelcomeBanners()
	}

	public clearCache(): void {
		this.remote.clearCache()
	}

	public async dismissBanner(bannerId: string): Promise<void> {
		try {
			const dismissed = StateManager.get().getGlobalStateKey("dismissedBanners") || []
			if (dismissed.some((b) => b.bannerId === bannerId)) return

			StateManager.get().setGlobalState("dismissedBanners", [...dismissed, { bannerId, dismissedAt: Date.now() }])

			await this.remote.sendBannerEvent(bannerId, "dismiss")
			this.clearCache()
		} catch (error) {
			Logger.error("[BannerService] Error dismissing banner", error)
		}
	}

	public async sendBannerEvent(bannerId: string, eventType: "dismiss"): Promise<void> {
		return this.remote.sendBannerEvent(bannerId, eventType)
	}

	public isBannerDismissed(bannerId: string): boolean {
		try {
			const dismissed = StateManager.get().getGlobalStateKey("dismissedBanners") || []
			return dismissed.some((b) => b.bannerId === bannerId)
		} catch (error) {
			Logger.error("[BannerService] Error checking dismissed banner", error)
			return false
		}
	}

	private getBannerActions(banner: Banner): BannerAction[] {
		return banner.actions ?? []
	}

	private toBannerCardData(banner: Banner): BannerCardData | null {
		const actions = this.getBannerActions(banner)

		// Validate all actions have valid types
		for (const action of actions) {
			if (!action.action || !this.validActionTypes.has(action.action) || !action.title) {
				Logger.error(`[BannerService] Invalid action type (${action.action}) for banner ${banner.id}`)
				return null
			}
		}

		return {
			id: banner.id,
			title: banner.titleMd,
			description: banner.bodyMd,
			icon: banner.icon,
			actions: actions.map((a) => ({ title: a.title || "", action: a.action as BannerActionType, arg: a.arg })),
		}
	}
}
```


## Source Files:

- `src/services/EnvUtils.ts`
- `src/services/banner/BannerService.ts`
- `src/services/banner/RemoteBannerService.ts`
- `src/services/banner/WelcomeBannerService.ts`
- `src/services/error/DiracError.ts`
- `src/services/error/ErrorProviderFactory.ts`
- `src/services/error/ErrorService.ts`
- `src/services/error/index.ts`
- `src/services/error/providers/DiracErrorProvider.ts`
- `src/services/error/providers/IErrorProvider.ts`
- `src/services/logging/distinctId.ts`
- `src/services/release-notes/ReleaseNotesService.ts`
- `src/services/release-notes/recordVersionUpgrade.ts`
- `src/services/ripgrep/index.ts`
- `src/services/ripgrep/resolve-ripgrep-binary.ts`
- `src/services/source-ast/SourceAstService.ts`
- `src/services/source-ast/SourceDefinitionCatalog.ts`
- `src/services/source-ast/SourceMutationPlanner.ts`
- `src/services/source-ast/SourceOccurrenceResolver.ts`
- `src/services/source-ast/SymbolContextResolver.ts`
- `src/services/source-ast/types.ts`
- `src/services/symbol-index/SymbolIndexDatabase.ts`
- `src/services/symbol-index/SymbolIndexService.ts`
- `src/services/symbol-index/SymbolIndexTelemetry.ts`
- `src/services/telemetry/HookTelemetry.ts`
- `src/services/telemetry/MentionTelemetry.ts`
- `src/services/telemetry/SubagentTelemetry.ts`
- `src/services/telemetry/TelemetryCategoryGate.ts`
- `src/services/telemetry/TelemetryContextManager.ts`
- `src/services/telemetry/TelemetryEventEmitter.ts`
- `src/services/telemetry/TelemetryProviderFactory.ts`
- `src/services/telemetry/TelemetryProviderManager.ts`
- `src/services/telemetry/TelemetrySessionTracker.ts`
- `src/services/telemetry/TelemetryTypes.ts`
- `src/services/telemetry/TerminalTelemetry.ts`
- `src/services/telemetry/UiTelemetry.ts`
- `src/services/telemetry/events/EventHandlerBase.ts`
- `src/services/telemetry/index.ts`
- `src/services/telemetry/providers/DiracTelemetryProvider.ts`
- `src/services/telemetry/providers/ITelemetryProvider.ts`
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryClientProvider.ts`
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryExporterFactory.ts`
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts`
- `src/services/tree-sitter/index.ts`
- `src/services/tree-sitter/languageParser.ts`
- `src/services/uri/SharedUriHandler.ts`

