import * as fs from "node:fs/promises"
import * as path from "node:path"
import { SymbolIndexService, type SymbolLocation } from "@services/symbol-index/SymbolIndexService"
import type { SourceDefinitionCatalog } from "./SourceDefinitionCatalog"
import type {
	AstOccurrenceRequest,
	AstOccurrenceResult,
	AstOccurrenceTargetResult,
	ResolvedSourcePath,
	SourceDefinition,
	SourceOccurrence,
} from "./types"

interface SourceOccurrenceResolverDependencies {
	root: string
	resolvePath(path: string): Promise<ResolvedSourcePath>
	validateAccess(path: string): boolean
	reconcileAnchors(path: string, lines: string[]): string[]
	definitionCatalog?: SourceDefinitionCatalog
	index?: SymbolIndexService
}

interface ResolvedScope extends ResolvedSourcePath {
	requestedPath: string
	isFile: boolean
}

interface MaterializedOccurrences {
	occurrences: SourceOccurrence[]
	failures: string[]
}

interface QualifiedLocationResult {
	status: "success" | "not_found" | "ambiguous" | "inaccessible" | "parse_error" | "unsupported"
	locations: SymbolLocation[]
	message?: string
	partialFailure?: boolean
	partialFailureStatus?: "ambiguous" | "inaccessible" | "parse_error"
	failureMessages?: string[]
}

interface IndexedDefinition {
	location: SymbolLocation
	definition: SourceDefinition
}

export class SourceOccurrenceResolver {
	private readonly index: SymbolIndexService

	constructor(private readonly dependencies: SourceOccurrenceResolverDependencies) {
		this.index = dependencies.index ?? SymbolIndexService.getInstance()
	}

	public async resolve(request: AstOccurrenceRequest): Promise<AstOccurrenceResult> {
		const scopes = await Promise.all(request.paths.map((requestedPath) => this.resolveScope(requestedPath)))
		const validScopes = scopes.filter((scope): scope is ResolvedScope => scope !== undefined)
		const targetFailures: AstOccurrenceTargetResult[] = request.paths.flatMap((requestedPath) => {
			const scope = validScopes.find((candidate) => candidate.requestedPath === requestedPath)
			return scope
				? []
				: request.symbols.map((symbol) => ({
					path: requestedPath,
					symbol,
					status: "inaccessible" as const,
					occurrences: [],
					message: `Unable to access ${requestedPath}.`,
				}))
		})

		if (validScopes.length === 0) return { targets: targetFailures, occurrences: [] }

		await this.index.initialize(this.dependencies.root)
		if (!this.index.getProjectRoot() || path.resolve(this.index.getProjectRoot()) !== path.resolve(this.dependencies.root)) {
			throw new Error(`Symbol index is unavailable for ${this.dependencies.root}.`)
		}
		for (const scope of validScopes) {
			if (!scope.isFile) continue
			if (!this.index.shouldIndexPath(scope.absolutePath)) continue
			await this.index.updateFile(scope.absolutePath)
		}

		const occurrences: SourceOccurrence[] = []
		const targets: AstOccurrenceTargetResult[] = [...targetFailures]
		for (const scope of validScopes) {
			for (const symbol of request.symbols) {
				if (scope.isFile && !this.index.shouldIndexPath(scope.absolutePath)) {
					targets.push({
						path: scope.requestedPath,
						symbol,
						status: "unsupported",
						occurrences: [],
						message: `${scope.displayPath} is excluded from the symbol index.`,
					})
					continue
				}

				const simpleName = this.indexedSymbolName(symbol)
				const queriedLocations = this.query(simpleName, request.kind)
				const scopedLocations = queriedLocations.filter((location) =>
					this.contains(scope.absolutePath, this.absoluteLocationPath(location)),
				)
				const qualified = await this.filterQualifiedLocations(
					symbol,
					scope,
					scopedLocations,
					request.kind,
					request.requireDefinitionOwnership === true,
				)
				if (qualified.status !== "success") {
					targets.push({
						path: scope.requestedPath,
						symbol,
						status: qualified.status,
						occurrences: [],
						message: qualified.message,
					})
					continue
				}

				const materialized = await this.materialize(symbol, qualified.locations, request.includeAnchors === true)
				const failureMessages = [
					...(qualified.failureMessages ?? []),
					...materialized.failures,
				]
				const targetOccurrences = this.deduplicateAndSort(materialized.occurrences)
				const status = targetOccurrences.length > 0
					? "success"
					: failureMessages.length > 0
						? qualified.partialFailureStatus ?? "inaccessible"
						: "not_found"
				targets.push({
					path: scope.requestedPath,
					symbol,
					status,
					occurrences: targetOccurrences,
					partialFailure: qualified.partialFailure === true || materialized.failures.length > 0,
					partialFailureStatus: qualified.partialFailureStatus ?? (
						materialized.failures.length > 0 ? "inaccessible" : undefined
					),
					failureMessages: failureMessages.length > 0 ? failureMessages : undefined,
					...(failureMessages.length > 0
						? { message: failureMessages.join(" ") }
						: targetOccurrences.length === 0
							? { message: `Symbol not found: ${symbol} in ${scope.displayPath}.` }
							: {}),
				})
				occurrences.push(...targetOccurrences)
			}
		}

		const allOccurrences = this.deduplicateAndSort(occurrences)
		const canonicalTargets = targets.map((target) => ({
			...target,
			occurrences: target.occurrences.filter((occurrence) =>
				allOccurrences.some((canonical) => this.occurrenceKey(canonical) === this.occurrenceKey(occurrence)),
			),
		}))
		return { targets: canonicalTargets, occurrences: allOccurrences }
	}

	private async resolveScope(requestedPath: string): Promise<ResolvedScope | undefined> {
		try {
			const resolved = await this.dependencies.resolvePath(requestedPath)
			if (!this.dependencies.validateAccess(resolved.absolutePath)) return undefined
			const stats = await fs.stat(resolved.absolutePath)
			return { ...resolved, requestedPath, isFile: stats.isFile() }
		} catch {
			return undefined
		}
	}

	private indexedSymbolName(symbol: string): string {
		const normalized = symbol.replace(/::/g, ".")
		return normalized.slice(normalized.lastIndexOf(".") + 1)
	}

	private isQualifiedSymbol(symbol: string): boolean {
		return symbol.replace(/::/g, ".").includes(".")
	}

	private query(symbol: string, kind: AstOccurrenceRequest["kind"]): SymbolLocation[] {
		if (kind === "definition") return this.index.getDefinitions(symbol)
		if (kind === "reference") return this.index.getReferences(symbol)
		return this.index.getSymbols(symbol)
	}

	private async filterQualifiedLocations(
		symbol: string,
		scope: ResolvedScope,
		locations: SymbolLocation[],
		kind: AstOccurrenceRequest["kind"],
		requireDefinitionOwnership: boolean,
	): Promise<QualifiedLocationResult> {
		const allDefinitionLocations = [...new Map(
			this.index
				.getDefinitions(this.indexedSymbolName(symbol))
				.map((location) => [this.locationKey(location), location]),
		).values()]
		const scopedDefinitionLocations = allDefinitionLocations.filter((location) =>
			this.contains(scope.absolutePath, this.absoluteLocationPath(location)),
		)
		const definitionsToResolve = kind === "definition" ? scopedDefinitionLocations : allDefinitionLocations
		if (definitionsToResolve.length === 0) {
			if (requireDefinitionOwnership && kind !== "definition" && locations.length > 0) {
				return {
					status: "ambiguous",
					locations: [],
					message: `Cannot safely rename '${symbol}': indexed references exist, but no indexed definition establishes their ownership.`,
				}
			}
			return this.isQualifiedSymbol(symbol)
				? {
					status: "not_found",
					locations: [],
					message: `Symbol not found: ${symbol} in ${scope.displayPath}.`,
				}
				: { status: "success", locations }
		}

		const catalog = this.dependencies.definitionCatalog
		if (!catalog) {
			const requiresDisambiguation = this.isQualifiedSymbol(symbol) || definitionsToResolve.length > 1
			return requiresDisambiguation
				? {
					status: "parse_error",
					locations: [],
					message: `Definition disambiguation is unavailable for ${symbol}.`,
				}
				: { status: "success", locations }
		}

		const indexedDefinitions: IndexedDefinition[] = []
		const failures: Array<{ status: QualifiedLocationResult["status"]; message: string }> = []
		const byFile = new Map<string, SymbolLocation[]>()
		for (const location of definitionsToResolve) {
			const absolutePath = this.absoluteLocationPath(location)
			if (!this.dependencies.validateAccess(absolutePath)) {
				failures.push({
					status: "inaccessible",
					message: `Access denied for indexed source ${this.displayPath(absolutePath)}.`,
				})
				continue
			}
			const group = byFile.get(absolutePath) ?? []
			group.push(location)
			byFile.set(absolutePath, group)
		}

		for (const [absolutePath, fileLocations] of byFile) {
			const displayPath = this.displayPath(absolutePath)
			const result = await catalog.load(absolutePath, { displayPath })
			if (result.status !== "success") {
				failures.push({ status: result.status, message: result.message })
				continue
			}
			for (const location of fileLocations) {
				const definition = result.catalog.definitions.find((candidate) =>
					candidate.nameRange.startLine === location.startLine &&
					candidate.nameRange.startColumn === location.startColumn &&
					candidate.nameRange.endLine === location.endLine &&
					candidate.nameRange.endColumn === location.endColumn,
				)
				if (definition) {
					indexedDefinitions.push({ location, definition })
					continue
				}
				failures.push({
					status: "parse_error",
					message: `Stale symbol-index definition for ${symbol} in ${displayPath}.`,
				})
			}
		}

		if (failures.length > 0) {
			const status = failures.some((failure) => failure.status === "inaccessible")
				? "inaccessible"
				: failures.some((failure) => failure.status === "parse_error")
					? "parse_error"
					: failures[0].status
			return { status, locations: [], message: failures.map((failure) => failure.message).join(" ") }
		}

		const qualifiedIdentities = new Set(indexedDefinitions.map(({ definition }) => definition.qualifiedName))
		const hasDefinitionInRequestedFile = scope.isFile && indexedDefinitions.some(({ location }) =>
			this.contains(scope.absolutePath, this.absoluteLocationPath(location)),
		)
		if (hasDefinitionInRequestedFile && qualifiedIdentities.size === 1) {
			const identityMatch = catalog.match([indexedDefinitions[0].definition], symbol)
			if (identityMatch.status === "success") return { status: "success", locations }
		}

		const match = catalog.match(indexedDefinitions.map(({ definition }) => definition), symbol)
		if (match.status === "not_found") {
			return {
				status: "not_found",
				locations: [],
				message: `Symbol not found: ${symbol} in ${scope.displayPath}.`,
			}
		}
		if (match.status === "ambiguous") {
			return {
				status: "ambiguous",
				locations: [],
				message: `Ambiguous symbol '${symbol}' in ${scope.displayPath}: ${match.candidates
					.map((definition) => `${definition.qualifiedName} at line ${definition.declarationLine + 1}`)
					.join(", ")}. Use a dot-qualified symbol.`,
			}
		}

		const selected = indexedDefinitions.find(({ definition }) => definition === match.definition)
		if (!selected) {
			return {
				status: "parse_error",
				locations: [],
				message: `Unable to map ${symbol} to its indexed definition in ${scope.displayPath}.`,
			}
		}
		const selectedDefinitionKey = this.locationKey(selected.location)
		const selectedDefinitionLocations = locations.filter(
			(location) => location.type === "definition" && this.locationKey(location) === selectedDefinitionKey,
		)

		if (kind !== "definition" && indexedDefinitions.length > 1) {
			const message = `References for '${symbol}' are ambiguous: the symbol index records only the simple name '${this.indexedSymbolName(symbol)}' and cannot assign references among ${indexedDefinitions
				.map(({ definition }) => definition.qualifiedName)
				.join(", ")}. No references were returned or planned.`
			if (kind === "both" && selectedDefinitionLocations.length > 0) {
				return {
					status: "success",
					locations: selectedDefinitionLocations,
					message,
					partialFailure: true,
					partialFailureStatus: "ambiguous",
					failureMessages: [message],
				}
			}
			return { status: "ambiguous", locations: [], message }
		}

		return {
			status: "success",
			locations: locations.filter((location) =>
				location.type === "reference" || this.locationKey(location) === selectedDefinitionKey,
			),
		}
	}

	private absoluteLocationPath(location: SymbolLocation): string {
		return path.normalize(path.isAbsolute(location.path) ? location.path : path.join(this.index.getProjectRoot(), location.path))
	}

	private contains(scopePath: string, candidatePath: string): boolean {
		const scope = path.normalize(scopePath)
		const candidate = path.normalize(candidatePath)
		return candidate === scope || candidate.startsWith(scope.endsWith(path.sep) ? scope : `${scope}${path.sep}`)
	}

	private async materialize(
		symbol: string,
		locations: SymbolLocation[],
		includeAnchors: boolean,
	): Promise<MaterializedOccurrences> {
		const byFile = new Map<string, SymbolLocation[]>()
		const failures: string[] = []
		for (const location of locations) {
			const absolutePath = this.absoluteLocationPath(location)
			if (!this.dependencies.validateAccess(absolutePath)) {
				failures.push(`Access denied for indexed source ${this.displayPath(absolutePath)}.`)
				continue
			}
			const group = byFile.get(absolutePath) ?? []
			group.push(location)
			byFile.set(absolutePath, group)
		}

		const occurrences: SourceOccurrence[] = []
		for (const [absolutePath, fileLocations] of byFile) {
			let content: string
			try {
				content = await fs.readFile(absolutePath, "utf8")
			} catch (error) {
				failures.push(`Unable to read indexed source ${this.displayPath(absolutePath)}: ${this.errorMessage(error)}.`)
				continue
			}
			const lines = content.split(/\r?\n/)
			const anchors = includeAnchors ? this.dependencies.reconcileAnchors(absolutePath, lines) : []
			for (const location of fileLocations) {
				const sourceLine = lines[location.startLine]
				if (sourceLine === undefined) {
					failures.push(`Stale symbol-index line for ${symbol} in ${this.displayPath(absolutePath)}.`)
					continue
				}
				occurrences.push({
					absolutePath,
					displayPath: this.displayPath(absolutePath),
					symbol,
					kind: location.type,
					startLine: location.startLine,
					startColumn: location.startColumn,
					endLine: location.endLine,
					endColumn: location.endColumn,
					sourceLine,
					...(anchors[location.startLine] ? { anchor: anchors[location.startLine] } : {}),
				})
			}
		}
		return { occurrences, failures: [...new Set(failures)] }
	}

	private displayPath(absolutePath: string): string {
		return path.relative(this.dependencies.root, absolutePath) || path.basename(absolutePath)
	}

	private errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error)
	}

	private locationKey(location: SymbolLocation): string {
		return [
			this.absoluteLocationPath(location),
			location.startLine,
			location.startColumn,
			location.endLine,
			location.endColumn,
			location.type,
		].join(":")
	}

	private occurrenceKey(occurrence: SourceOccurrence): string {
		return [
			occurrence.absolutePath,
			occurrence.startLine,
			occurrence.startColumn,
			occurrence.endLine,
			occurrence.endColumn,
			occurrence.symbol,
			occurrence.kind,
		].join(":")
	}

	private deduplicateAndSort(occurrences: SourceOccurrence[]): SourceOccurrence[] {
		const unique = new Map<string, SourceOccurrence>()
		for (const occurrence of occurrences) unique.set(this.occurrenceKey(occurrence), occurrence)
		return [...unique.values()].sort((left, right) =>
			left.displayPath.localeCompare(right.displayPath) ||
			left.startLine - right.startLine ||
			left.startColumn - right.startColumn ||
			left.symbol.localeCompare(right.symbol) ||
			left.kind.localeCompare(right.kind),
		)
	}
}
