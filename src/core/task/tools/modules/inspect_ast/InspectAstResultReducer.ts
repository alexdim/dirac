import type {
    AstImplementationResult,
    AstImplementationTargetResult,
    AstOccurrenceResult,
    AstOutlineFileResult,
    AstOutlineResult,
    SourceAstResultStatus,
    SourceOccurrence,
} from "@services/source-ast/types"
import type { InspectAstOperation } from "./InspectAstValidator"

export interface InspectAstIssue {
	path: string
	status: SourceAstResultStatus
	message: string
}

interface InspectAstResultGroupBase {
	status: "success" | "failure"
	searchedPaths: string[]
	issues: InspectAstIssue[]
	reason?: string
}

export interface InspectAstOutlineGroup extends InspectAstResultGroupBase {
	operation: "outline"
	path: string
	file?: AstOutlineFileResult
}

export interface InspectAstImplementationGroup extends InspectAstResultGroupBase {
	operation: "implementation"
	symbol: string
	matches: AstImplementationTargetResult[]
}

export interface InspectAstOccurrenceGroup extends InspectAstResultGroupBase {
	operation: "definitions" | "references" | "occurrences"
	symbol: string
	occurrences: SourceOccurrence[]
}

export type InspectAstResultGroup =
	| InspectAstOutlineGroup
	| InspectAstImplementationGroup
	| InspectAstOccurrenceGroup

/** Reduces backend path/symbol lookup targets into one model-facing result per requested path or symbol. */
export class InspectAstResultReducer {
	public reduceOutline(paths: string[], result: AstOutlineResult): InspectAstOutlineGroup[] {
		return paths.map((path) => {
			const file = result.files.find((candidate) => candidate.path === path)
			if (!file) {
				return {
					operation: "outline",
					path,
					status: "failure",
					searchedPaths: [path],
					issues: [{
						path,
						status: "parse_error",
						message: "The source-AST backend returned no result for this path.",
					}],
					reason: "The path could not be inspected.",
				}
			}

			if (file.status === "success" && file.definitions.length > 0) {
				return {
					operation: "outline",
					path,
					status: "success",
					searchedPaths: [path],
					issues: [],
					file,
				}
			}

			const issues = file.status === "not_found" || file.status === "success"
				? []
				: [{ path, status: file.status, message: file.message ?? `Unable to inspect ${path}.` }]
			return {
				operation: "outline",
				path,
				status: "failure",
				searchedPaths: [path],
				issues,
				file,
				reason: file.status === "not_found" || file.status === "success"
					? "No definitions were found."
					: "The path could not be inspected.",
			}
		})
	}

	public reduceImplementations(
		paths: string[],
		symbols: string[],
		result: AstImplementationResult,
	): InspectAstImplementationGroup[] {
		return symbols.map((symbol) => {
			const targets = result.targets.filter((target) => target.symbol === symbol)
			const matches = this.uniqueImplementationMatches(targets.filter((target) =>
				target.status === "success" && target.definition !== undefined && target.contentHash !== undefined,
			))
			const issues: InspectAstIssue[] = []

			for (const path of paths) {
				if (targets.some((target) => target.path === path)) continue
				issues.push({
					path,
					status: "parse_error",
					message: "The source-AST backend returned no result for this path and symbol.",
				})
			}
			for (const target of targets) {
				if (target.status === "not_found") continue
				if (target.status === "success" && target.definition && target.contentHash) continue
				if (target.status === "success") {
					issues.push({
						path: target.path,
						status: "parse_error",
						message: `The source-AST backend returned an incomplete implementation for ${symbol}.`,
					})
					continue
				}
				const candidates = target.candidates?.length
					? ` Candidates: ${target.candidates.map((candidate) =>
						`${candidate.qualifiedName} (${candidate.kind}, line ${candidate.declarationLine + 1})`,
					).join(", ")}.`
					: ""
				issues.push({
					path: target.path,
					status: target.status,
					message: `${target.message ?? `Unable to inspect ${symbol}.`}${candidates}`,
				})
			}

			return {
				operation: "implementation",
				symbol,
				status: matches.length > 0 ? "success" : "failure",
				searchedPaths: paths,
				issues: this.uniqueIssues(issues),
				matches,
				...(matches.length === 0 ? { reason: "No implementation was found in any requested path." } : {}),
			}
		})
	}

	public reduceOccurrences(
		operation: Exclude<InspectAstOperation, "outline" | "implementation">,
		paths: string[],
		symbols: string[],
		result: AstOccurrenceResult,
	): InspectAstOccurrenceGroup[] {
		return symbols.map((symbol) => {
			const targets = result.targets.filter((target) => target.symbol === symbol)
			const issues: InspectAstIssue[] = []

			for (const path of paths) {
				if (targets.some((target) => target.path === path)) continue
				issues.push({
					path,
					status: "parse_error",
					message: "The source-AST backend returned no result for this path and symbol.",
				})
			}
			for (const target of targets) {
				if (target.status !== "success" && target.status !== "not_found") {
					issues.push({
						path: target.path,
						status: target.status,
						message: target.message ?? `Unable to inspect ${symbol}.`,
					})
				}
				if (!target.partialFailure) continue
				const messages = target.failureMessages ?? (target.message ? [target.message] : [])
				for (const message of messages) {
					issues.push({
						path: target.path,
						status: target.partialFailureStatus ?? "parse_error",
						message,
					})
				}
			}

			const occurrences = this.uniqueOccurrences(targets.flatMap((target) => target.occurrences))
			return {
				operation,
				symbol,
				status: occurrences.length > 0 ? "success" : "failure",
				searchedPaths: paths,
				issues: this.uniqueIssues(issues),
				occurrences,
				...(occurrences.length === 0 ? { reason: this.occurrenceFailureReason(operation) } : {}),
			}
		})
	}

	private occurrenceFailureReason(operation: InspectAstOccurrenceGroup["operation"]): string {
		if (operation === "definitions") return "No definitions were found in any requested path."
		if (operation === "references") return "No references were found in any requested path."
		return "No definitions or references were found in any requested path."
	}

	private uniqueImplementationMatches(matches: AstImplementationTargetResult[]): AstImplementationTargetResult[] {
		const unique = new Map<string, AstImplementationTargetResult>()
		for (const match of matches) {
			const definition = match.definition
			const key = definition
				? `${match.absolutePath ?? match.path}:${definition.definitionRange.startIndex}:${definition.definitionRange.endIndex}`
				: `${match.absolutePath ?? match.path}:${match.symbol}`
			if (!unique.has(key)) unique.set(key, match)
		}
		return [...unique.values()]
	}

	private uniqueOccurrences(occurrences: SourceOccurrence[]): SourceOccurrence[] {
		const unique = new Map<string, SourceOccurrence>()
		for (const occurrence of occurrences) {
			const key = [
				occurrence.absolutePath,
				occurrence.kind,
				occurrence.startLine,
				occurrence.startColumn,
				occurrence.endLine,
				occurrence.endColumn,
			].join(":")
			if (!unique.has(key)) unique.set(key, occurrence)
		}
		return [...unique.values()].sort((left, right) =>
			left.displayPath.localeCompare(right.displayPath) ||
			left.startLine - right.startLine ||
			left.startColumn - right.startColumn ||
			left.kind.localeCompare(right.kind),
		)
	}

	private uniqueIssues(issues: InspectAstIssue[]): InspectAstIssue[] {
		const unique = new Map<string, InspectAstIssue>()
		for (const issue of issues) {
			const key = `${issue.path}:${issue.status}:${issue.message}`
			if (!unique.has(key)) unique.set(key, issue)
		}
		return [...unique.values()]
	}
}
