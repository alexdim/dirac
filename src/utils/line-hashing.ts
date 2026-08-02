import { AnchorStateManager } from "./AnchorStateManager"
import { ANCHOR_DELIMITER, parseAnchoredLine } from "../shared/utils/line-hashing"

export {
	ANCHOR_DELIMITER,
	containsAnchoredLine,
	extractId,
	getAnchoredLinePattern,
	getDelimiter,
	isValidAnchorId,
	parseAnchoredLine,
	stripHashes,
	stripHashesFromDiff,
} from "../shared/utils/line-hashing"

/** Generates an internal 32-bit FNV-1a content fingerprint. */
export function contentHash(content: string): string {
	let h = 2166136261
	for (let i = 0; i < content.length; i++) {
		h = Math.imul(h ^ content.charCodeAt(i), 16777619)
	}
	return (h >>> 0).toString(16).padStart(8, "0")
}

/** @deprecated Use parseAnchoredLine when validating a complete edit coordinate. */
export function splitAnchor(rawAnchor: string): { anchor: string; content: string } {
	return parseAnchoredLine(rawAnchor) ?? { anchor: "", content: "" }
}

/** Formats exact source content with its opaque visible line ID. */
export function formatLineWithHash(content: string, anchor: string): string {
	return `${anchor}${ANCHOR_DELIMITER}${content}`
}

/** Formats every line using conversation/task-scoped stateful line IDs. */
export function hashLinesStateful(absolutePath: string, content: string, taskId?: string): string {
	if (!content) return ""
	const lines = content.split(/\r?\n/)
	const anchors = AnchorStateManager.reconcile(absolutePath, lines, taskId)
	return lines.map((line, index) => formatLineWithHash(line, anchors[index])).join("\n")
}

/** Formats one source line for the model, optionally including its line anchor. */
export function formatLineForModel(content: string, anchor: string, includeAnchors: boolean): string {
	return includeAnchors ? formatLineWithHash(content, anchor) : content
}

/** Formats source lines for the model, optionally including their line anchors. */
export function formatLinesForModel(lines: string[], anchors: string[], includeAnchors: boolean): string {
	return lines.map((line, index) => formatLineForModel(line, anchors[index], includeAnchors)).join("\n")
}

/** Legacy wrapper that leaves content plain when no absolute path is available. */
export function hashLines(content: string, absolutePath?: string, taskId?: string): string {
	if (!content) return ""
	return absolutePath ? hashLinesStateful(absolutePath, content, taskId) : content
}
