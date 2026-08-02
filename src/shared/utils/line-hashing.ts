/**
 * Shared utilities for the model-facing line-anchor protocol.
 * Visible anchor IDs are opaque stateful coordinates, not content hashes.
 */

export const ANCHOR_DELIMITER = "§"

const ANCHOR_ID_PATTERN = /^[A-Z][a-zA-Z]*$/

export interface AnchoredLineParts {
	anchor: string
	content: string
}

/** Returns the centralized delimiter used to separate an anchor ID from exact line content. */
export function getDelimiter(): string {
	return ANCHOR_DELIMITER
}

/** Returns whether a visible anchor ID satisfies the shared producer/consumer contract. */
export function isValidAnchorId(value: string): boolean {
	return ANCHOR_ID_PATTERN.test(value)
}

/** Returns the JSON Schema pattern for one complete model-facing anchored source line. */
export function getAnchoredLinePattern(): string {
	const escapedDelimiter = ANCHOR_DELIMITER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return `^[A-Z][a-zA-Z]*${escapedDelimiter}[^\\r\\n]*$`
}

/** Parses one complete anchored source line without normalizing either half of the coordinate. */
export function parseAnchoredLine(value: string): AnchoredLineParts | null {
	if (typeof value !== "string" || value.includes("\n") || value.includes("\r")) return null
	const delimiterIndex = value.indexOf(ANCHOR_DELIMITER)
	if (delimiterIndex <= 0) return null

	const anchor = value.substring(0, delimiterIndex)
	if (!isValidAnchorId(anchor)) return null
	return {
		anchor,
		content: value.substring(delimiterIndex + ANCHOR_DELIMITER.length),
	}
}

/** Returns whether any source-text line begins with a complete line anchor. */
export function containsAnchoredLine(content: string): boolean {
	return content.split(/\r?\n/).some((line) => parseAnchoredLine(line) !== null)
}

/** Removes a line-anchor prefix when it starts at the requested offset. */
function stripAnchorPrefix(line: string, offset = 0): string {
	const parsed = parseAnchoredLine(line.substring(offset))
	return parsed ? line.substring(0, offset) + parsed.content : line
}

function transformLinesPreservingSeparators(content: string, transform: (line: string) => string): string {
	return content
		.split(/(\r?\n)/)
		.map((part, index) => index % 2 === 0 ? transform(part) : part)
		.join("")
}

/**
 * Strips line-anchor prefixes from raw content.
 * Interior anchor-like text and indented anchor-like literals are preserved exactly.
 */
export function stripHashes(content: string): string {
	if (!content) return ""
	return transformLinesPreservingSeparators(content, (line) => stripAnchorPrefix(line))
}

/** Strips line anchors after an optional leading diff marker while preserving that marker. */
export function stripHashesFromDiff(content: string): string {
	if (!content) return ""
	return transformLinesPreservingSeparators(content, (line) => {
		if (line.length > 0 && (line[0] === "+" || line[0] === "-" || line[0] === " ")) {
			return stripAnchorPrefix(line, 1)
		}
		return stripAnchorPrefix(line)
	})
}

/** Extracts the identifier portion of a line reference without validating the complete coordinate. */
export function extractId(ref: string): string {
	if (!ref) return ""
	const delimiterIndex = ref.indexOf(ANCHOR_DELIMITER)
	return delimiterIndex === -1 ? ref : ref.substring(0, delimiterIndex)
}
