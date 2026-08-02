import * as fs from "node:fs/promises"
import type { SourceDefinitionCatalog } from "./SourceDefinitionCatalog"
import type { SourceOccurrenceResolver } from "./SourceOccurrenceResolver"
import type {
	AstRenameRequest,
	AstReplacementRequest,
	ResolvedSourcePath,
	SourceAstFailure,
	SourceFileChange,
	SourceMutationPlan,
	SourceTextEdit,
	SourceUnchangedTarget,
} from "./types"

interface SourceMutationPlannerDependencies {
	resolvePath(path: string): Promise<ResolvedSourcePath>
	definitionCatalog: SourceDefinitionCatalog
	occurrenceResolver: SourceOccurrenceResolver
}

interface PendingFileEdits {
	absolutePath: string
	displayPath: string
	originalContent: string
	edits: SourceTextEdit[]
}

export class SourceMutationPlanner {
	constructor(private readonly dependencies: SourceMutationPlannerDependencies) { }

	public async planRename(request: AstRenameRequest): Promise<SourceMutationPlan> {
		const occurrenceResult = await this.dependencies.occurrenceResolver.resolve({
			paths: request.paths,
			symbols: [request.symbol],
			kind: "both",
			requireDefinitionOwnership: true,
		})
		const failures: SourceAstFailure[] = occurrenceResult.targets
			.filter((target) => target.status !== "success" && target.status !== "not_found")
			.map((target) => ({
				status: target.status as SourceAstFailure["status"],
				path: target.path,
				symbol: target.symbol,
				message: target.message ?? `Unable to inspect ${target.path}.`,
			}))
		for (const target of occurrenceResult.targets.filter((candidate) => candidate.partialFailure)) {
			for (const message of target.failureMessages ?? []) {
				failures.push({
					status: target.partialFailureStatus ?? "inaccessible",
					path: target.path,
					symbol: target.symbol,
					message,
				})
			}
		}
		const unchangedTargets: SourceUnchangedTarget[] = occurrenceResult.targets
			.filter((target) => target.status === "not_found")
			.map((target) => ({ path: target.path, symbol: target.symbol, reason: target.message ?? "Symbol not found." }))

		const files = new Map<string, PendingFileEdits>()
		const expectedText = this.simpleSymbol(request.symbol)
		if (request.replacement === expectedText) {
			return {
				operation: "rename",
				files: [],
				editCount: 0,
				unchangedTargets: request.paths.map((path) => ({
					path,
					symbol: request.symbol,
					reason: "The requested name is unchanged.",
				})),
				failures,
			}
		}
		for (const occurrence of occurrenceResult.occurrences) {
			let pending = files.get(occurrence.absolutePath)
			if (!pending) {
				const originalContent = await this.readFile(occurrence.absolutePath)
				pending = {
					absolutePath: occurrence.absolutePath,
					displayPath: occurrence.displayPath,
					originalContent,
					edits: [],
				}
				files.set(occurrence.absolutePath, pending)
			}
			const startIndex = this.offsetAt(pending.originalContent, occurrence.startLine, occurrence.startColumn)
			const endIndex = this.offsetAt(pending.originalContent, occurrence.endLine, occurrence.endColumn)
			const actualText = pending.originalContent.slice(startIndex, endIndex)
			if (actualText !== expectedText) {
				failures.push({
					status: "parse_error",
					path: occurrence.displayPath,
					symbol: request.symbol,
					message: `Stale symbol-index location in ${occurrence.displayPath}: expected '${expectedText}' but found '${actualText}'.`,
				})
				continue
			}
			if (!pending.edits.some((edit) => edit.startIndex === startIndex && edit.endIndex === endIndex)) {
				pending.edits.push({
					startIndex,
					endIndex,
					replacement: request.replacement,
					symbol: request.symbol,
					source: "rename",
				})
			}
		}

		return this.finalizePlan("rename", files, unchangedTargets, failures)
	}

	public async planReplacements(request: AstReplacementRequest): Promise<SourceMutationPlan> {
		const files = new Map<string, PendingFileEdits>()
		const failures: SourceAstFailure[] = []
		const unchangedTargets: SourceUnchangedTarget[] = []

		for (const target of request.targets) {
			let resolved: ResolvedSourcePath
			try {
				resolved = await this.dependencies.resolvePath(target.path)
			} catch (error) {
				failures.push({
					status: "inaccessible",
					path: target.path,
					symbol: target.symbol,
					message: `Unable to resolve ${target.path}: ${this.errorMessage(error)}`,
				})
				continue
			}
			try {
				const stats = await fs.stat(resolved.absolutePath)
				if (!stats.isFile()) {
					failures.push({
						status: "unsupported",
						path: target.path,
						symbol: target.symbol,
						message: `Replacement target must be a source file: ${target.path}.`,
					})
					continue
				}
			} catch (error) {
				failures.push({
					status: "inaccessible",
					path: target.path,
					symbol: target.symbol,
					message: `Unable to access ${target.path}: ${this.errorMessage(error)}`,
				})
				continue
			}

			const catalogResult = await this.dependencies.definitionCatalog.load(resolved.absolutePath, {
				displayPath: resolved.displayPath,
			})
			if (catalogResult.status !== "success") {
				failures.push({
					status: catalogResult.status,
					path: target.path,
					symbol: target.symbol,
					message: catalogResult.message,
				})
				continue
			}

			const match = this.dependencies.definitionCatalog.match(catalogResult.catalog.definitions, target.symbol)
			if (match.status === "not_found") {
				failures.push({
					status: "not_found",
					path: target.path,
					symbol: target.symbol,
					message: `Symbol not found: ${target.symbol} in ${target.path}.`,
				})
				continue
			}
			if (match.status === "ambiguous") {
				failures.push({
					status: "ambiguous",
					path: target.path,
					symbol: target.symbol,
					message: `Ambiguous symbol '${target.symbol}' in ${target.path}.`,
					candidates: match.candidates.map(({ qualifiedName, kind, declarationLine }) => ({
						qualifiedName,
						kind,
						declarationLine,
					})),
				})
				continue
			}

			const range = match.definition.replacementRange
			const oldText = catalogResult.catalog.content.slice(range.startIndex, range.endIndex)
			if (oldText === target.replacement) {
				unchangedTargets.push({ path: target.path, symbol: target.symbol, reason: "Replacement is identical." })
				continue
			}
			let pending = files.get(resolved.absolutePath)
			if (!pending) {
				pending = {
					absolutePath: resolved.absolutePath,
					displayPath: resolved.displayPath,
					originalContent: catalogResult.catalog.content,
					edits: [],
				}
				files.set(resolved.absolutePath, pending)
			}
			pending.edits.push({
				startIndex: range.startIndex,
				endIndex: range.endIndex,
				replacement: target.replacement,
				symbol: target.symbol,
				source: "replace",
			})
		}

		return this.finalizePlan("replace", files, unchangedTargets, failures)
	}

	private finalizePlan(
		operation: SourceMutationPlan["operation"],
		pendingFiles: Map<string, PendingFileEdits>,
		unchangedTargets: SourceUnchangedTarget[],
		failures: SourceAstFailure[],
	): SourceMutationPlan {
		const files: SourceFileChange[] = []
		for (const pending of pendingFiles.values()) {
			const edits = this.validateEdits(pending)
			if (edits.length === 0) continue
			let content = pending.originalContent
			for (const edit of [...edits].sort((left, right) => right.startIndex - left.startIndex)) {
				content = content.slice(0, edit.startIndex) + edit.replacement + content.slice(edit.endIndex)
			}
			if (content === pending.originalContent) continue
			files.push({
				absolutePath: pending.absolutePath,
				displayPath: pending.displayPath,
				originalContent: pending.originalContent,
				content,
				changedSymbols: [...new Set(edits.map((edit) => edit.symbol))].sort(),
				editCount: edits.length,
				edits,
			})
		}
		files.sort((left, right) => left.displayPath.localeCompare(right.displayPath))
		return {
			operation,
			files,
			editCount: files.reduce((count, file) => count + file.editCount, 0),
			unchangedTargets,
			failures,
		}
	}

	private validateEdits(file: PendingFileEdits): SourceTextEdit[] {
		const edits = [...file.edits].sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex)
		let previous: SourceTextEdit | undefined
		for (const edit of edits) {
			if (
				!Number.isInteger(edit.startIndex) ||
				!Number.isInteger(edit.endIndex) ||
				edit.startIndex < 0 ||
				edit.endIndex < edit.startIndex ||
				edit.endIndex > file.originalContent.length
			) {
				throw new Error(`Invalid AST edit range in ${file.displayPath}.`)
			}
			if (previous && edit.startIndex === previous.startIndex && edit.endIndex === previous.endIndex) {
				throw new Error(`Duplicate AST edit range in ${file.displayPath}.`)
			}
			if (previous && edit.startIndex < previous.endIndex) {
				throw new Error(`Overlapping AST edit ranges in ${file.displayPath}.`)
			}
			previous = edit
		}
		return edits
	}

	private offsetAt(content: string, line: number, byteColumn: number): number {
		const lines = content.split(/\r?\n/)
		if (line < 0 || line >= lines.length || byteColumn < 0) throw new Error("Invalid indexed source coordinate.")
		let offset = 0
		for (let index = 0; index < line; index++) {
			offset += lines[index].length
			offset += content.slice(offset, offset + 2) === "\r\n" ? 2 : 1
		}
		const currentLine = lines[line]
		let characterColumn = 0
		let consumedBytes = 0
		for (const character of currentLine) {
			if (consumedBytes >= byteColumn) break
			consumedBytes += Buffer.byteLength(character, "utf8")
			characterColumn += character.length
		}
		if (consumedBytes !== byteColumn) throw new Error("Indexed source coordinate splits a Unicode code point.")
		return offset + characterColumn
	}

	private simpleSymbol(symbol: string): string {
		const normalized = symbol.replace(/::/g, ".")
		return normalized.slice(normalized.lastIndexOf(".") + 1)
	}

	private async readFile(absolutePath: string): Promise<string> {
		return fs.readFile(absolutePath, "utf8")
	}

	private errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error)
	}
}
