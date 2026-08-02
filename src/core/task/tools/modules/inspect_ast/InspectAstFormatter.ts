import type {
	AstImplementationTargetResult,
	SourceDefinition,
	SourceLine,
	SourceOccurrence,
} from "@services/source-ast/types"
import { getDelimiter } from "@utils/line-hashing"
import type {
	InspectAstImplementationGroup,
	InspectAstIssue,
	InspectAstOccurrenceGroup,
	InspectAstOutlineGroup,
	InspectAstResultGroup,
} from "./InspectAstResultReducer"
import type { InspectAstOperation } from "./InspectAstValidator"

export interface ImplementationCacheRecord {
	contentHash: string
	anchorFingerprint?: string
}

export interface InspectAstCacheStats {
	hitCount: number
	missCount: number
}

export interface InspectAstSummary {
	resultCount: number
	successCount: number
	failureCount: number
	issueCount: number
	mixedResult: boolean
}

export interface FormattedInspectAstResult {
	text: string
	summary: InspectAstSummary
	cacheStats: InspectAstCacheStats
}

function formatLine(line: SourceLine, includeAnchors: boolean): string {
	return includeAnchors && line.anchor ? `${line.anchor}${getDelimiter()}${line.text}` : line.text
}

function describeDefinition(definition: SourceDefinition, line: SourceLine | undefined, includeAnchors: boolean): string {
	if (includeAnchors && line?.anchor) {
		const result = ["Declaration:", formatLine(line, true)]
		if (definition.calls.length > 0) result.push(`Calls: [${definition.calls.join(", ")}]`)
		return result.join("\n")
	}
	const declaration = line ? line.text : definition.declarationText
	const calls = definition.calls.length > 0 ? `\n│${definition.indentation}    # Calls: [${definition.calls.join(", ")}]` : ""
	return `│${declaration}${calls}`
}

function summaryFromGroups(groups: InspectAstResultGroup[]): InspectAstSummary {
	const successCount = groups.filter((group) => group.status === "success").length
	const failureCount = groups.length - successCount
	return {
		resultCount: groups.length,
		successCount,
		failureCount,
		issueCount: groups.reduce((count, group) => count + group.issues.length, 0),
		mixedResult: successCount > 0 && failureCount > 0,
	}
}

/** Formats reduced AST result groups into a compact, deterministic model-facing document. */
export class InspectAstFormatter {
	public formatOutline(groups: InspectAstOutlineGroup[], includeAnchors: boolean): FormattedInspectAstResult {
		const sections = groups.map((group) => {
			const definitions = group.file?.definitions ?? []
			const lines = [
				`Path: ${group.path}`,
				`Status: ${group.status.toUpperCase()}`,
				`Definitions: ${definitions.length}`,
			]
			if (group.status === "failure") {
				lines.push(`Reason: ${group.reason}`)
				this.appendIssues(lines, "Issues", group.issues)
				return lines.join("\n")
			}

			const sourceLines = new Map(group.file!.lines.map((line) => [line.lineNumber, line]))
			const body = definitions.map((definition) =>
				describeDefinition(definition, sourceLines.get(definition.declarationLine + 1), includeAnchors),
			).join("\n|----\n")
			lines.push("", "|----", body, "|----")
			return lines.join("\n")
		})
		return this.document("outline", groups, sections, includeAnchors, { hitCount: 0, missCount: 0 })
	}

	public formatImplementations(
		groups: InspectAstImplementationGroup[],
		includeAnchors: boolean,
		cache: Record<string, ImplementationCacheRecord | string>,
		_fingerprintForPath: (path: string) => string | null,
	): FormattedInspectAstResult {
		const cacheStats: InspectAstCacheStats = { hitCount: 0, missCount: 0 }
		const sections = groups.map((group) => {
			const lines = [
				`Symbol: ${group.symbol}`,
				`Status: ${group.status.toUpperCase()}`,
				`Matches: ${group.matches.length}`,
			]
			if (group.status === "failure") {
				lines.push(`Reason: ${group.reason}`, `Searched paths: ${group.searchedPaths.join(", ")}`)
				this.appendIssues(lines, "Issues", group.issues)
				return lines.join("\n")
			}

			for (let index = 0; index < group.matches.length; index++) {
				lines.push("", this.formatImplementationMatch(
					group.matches[index],
					index,
					group.matches.length,
					includeAnchors,
					cache,
					cacheStats,
				))
			}
			this.appendIssues(lines, "Warnings", group.issues)
			return lines.join("\n")
		})
		return this.document("implementation", groups, sections, includeAnchors, cacheStats)
	}

	public formatOccurrences(
		groups: InspectAstOccurrenceGroup[],
		operation: InspectAstOccurrenceGroup["operation"],
		includeAnchors: boolean,
	): FormattedInspectAstResult {
		const sections = groups.map((group) => {
			const definitionCount = group.occurrences.filter((occurrence) => occurrence.kind === "definition").length
			const referenceCount = group.occurrences.length - definitionCount
			const lines = [
				`Symbol: ${group.symbol}`,
				`Status: ${group.status.toUpperCase()}`,
				this.occurrenceCountLine(operation, group.occurrences.length, definitionCount, referenceCount),
			]
			if (group.status === "failure") {
				lines.push(`Reason: ${group.reason}`, `Searched paths: ${group.searchedPaths.join(", ")}`)
				this.appendIssues(lines, "Issues", group.issues)
				return lines.join("\n")
			}

			const groupedOccurrences = new Map<string, SourceOccurrence[]>()
			for (const occurrence of group.occurrences) {
				const occurrences = groupedOccurrences.get(occurrence.displayPath) ?? []
				occurrences.push(occurrence)
				groupedOccurrences.set(occurrence.displayPath, occurrences)
			}
			for (const [path, occurrences] of groupedOccurrences) {
				lines.push("", `${path}:`)
				for (const occurrence of occurrences) {
					const location = `  [${occurrence.kind}] line ${occurrence.startLine + 1}:${occurrence.startColumn + 1}`
					if (includeAnchors && occurrence.anchor) {
						lines.push(location, `${occurrence.anchor}${getDelimiter()}${occurrence.sourceLine ?? ""}`)
					} else {
						lines.push(`${location} ${occurrence.sourceLine ?? ""}`.trimEnd())
					}
				}
			}
			this.appendIssues(lines, "Warnings", group.issues)
			return lines.join("\n")
		})
		return this.document(operation, groups, sections, includeAnchors, { hitCount: 0, missCount: 0 })
	}

	private formatImplementationMatch(
		target: AstImplementationTargetResult,
		index: number,
		total: number,
		includeAnchors: boolean,
		cache: Record<string, ImplementationCacheRecord | string>,
		cacheStats: InspectAstCacheStats,
	): string {
		const definition = target.definition!
		const contentHash = target.contentHash!
		const displayName = `${target.path}::${definition.qualifiedName}`
		const header = `--- MATCH ${index + 1}/${total}: ${displayName}`
		const normalizedPath = (target.absolutePath ?? target.path).replace(/\\/g, "/")
		const cacheKey = `${normalizedPath}::${target.symbol}#plain`
		const cached = includeAnchors ? undefined : cache[cacheKey]
		const contentMatches = typeof cached === "string"
			? cached === contentHash
			: cached?.contentHash === contentHash

		if (!includeAnchors && contentMatches) {
			cacheStats.hitCount++
			return `${header}\nImplementation hash: ${contentHash}\nNo changes have been made to this implementation since the previous inspection.`
		}

		cacheStats.missCount++
		if (!includeAnchors) cache[cacheKey] = { contentHash }
		const context = (target.contextLines ?? []).map((line) => formatLine(line, includeAnchors)).join("\n")
		const implementation = (target.lines ?? []).map((line) => formatLine(line, includeAnchors)).join("\n")
		const sections = [header, `Implementation hash: ${contentHash}`]
		if (context) sections.push("Context:", context)
		sections.push("Implementation:", implementation)
		return sections.join("\n")
	}

	private occurrenceCountLine(
		operation: InspectAstOccurrenceGroup["operation"],
		total: number,
		definitions: number,
		references: number,
	): string {
		if (operation === "definitions") return `Definitions: ${total}`
		if (operation === "references") return `References: ${total}`
		return `Occurrences: ${total} | Definitions: ${definitions} | References: ${references}`
	}

	private appendIssues(lines: string[], heading: "Issues" | "Warnings", issues: InspectAstIssue[]): void {
		if (issues.length === 0) return
		lines.push("", `${heading}:`)
		for (const issue of issues) {
			lines.push(`- ${issue.path} [${issue.status.toUpperCase()}]: ${issue.message}`)
		}
	}

	private document(
		operation: InspectAstOperation,
		groups: InspectAstResultGroup[],
		sections: string[],
		includeAnchors: boolean,
		cacheStats: InspectAstCacheStats,
	): FormattedInspectAstResult {
		const summary = summaryFromGroups(groups)
		const envelope = [
			`INSPECT_AST ${operation}`,
			`Results: ${summary.resultCount} | Success: ${summary.successCount} | Failure: ${summary.failureCount} | Anchors: ${includeAnchors ? "yes" : "no"}`,
		].join("\n")
		const body = sections.map((section, index) => `===== RESULT ${index + 1}/${sections.length} =====\n${section}`)
		return {
			text: `${envelope}\n\n${body.join("\n\n")}`,
			summary,
			cacheStats,
		}
	}
}
