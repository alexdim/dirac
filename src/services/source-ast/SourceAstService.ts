import { contentHash } from "@utils/line-hashing"
import { SourceDefinitionCatalog } from "./SourceDefinitionCatalog"
import { SourceMutationPlanner } from "./SourceMutationPlanner"
import { SourceOccurrenceResolver } from "./SourceOccurrenceResolver"
import type {
	AstImplementationRequest,
	AstImplementationResult,
	AstImplementationTargetResult,
	AstOccurrenceRequest,
	AstOccurrenceResult,
	AstOutlineFileResult,
	AstOutlineRequest,
	AstOutlineResult,
	AstRenameRequest,
	AstReplacementRequest,
	SourceAstDependencies,
	SourceLine,
	SourceMutationPlan,
} from "./types"

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
		return error instanceof Error ? error.message : String(error)
	}
}

export type {
	AstImplementationRequest,
	AstImplementationResult,
	AstOccurrenceRequest,
	AstOccurrenceResult,
	AstOutlineRequest,
	AstOutlineResult,
	AstRenameRequest,
	AstReplacementRequest,
	SourceMutationPlan,
} from "./types"
