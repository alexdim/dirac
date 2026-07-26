const DEFAULT_COLUMNS = 80

function splitIntoVisualRows(text: string, columns: number): string[] {
	const width = Math.max(1, columns)
	return text.split("\n").flatMap((line) => {
		if (line.length === 0) return [""]
		const rows: string[] = []
		for (let offset = 0; offset < line.length; offset += width) {
			rows.push(line.slice(offset, offset + width))
		}
		return rows
	})
}

function truncateRow(text: string, width: number): string {
	if (width <= 0) return ""
	if (text.length <= width) return text
	if (width === 1) return "…"
	return `${text.slice(0, width - 1)}…`
}

function prependClippingMarker(rows: string[], marker: string, width: number, lineBudget: number): string[] {
	if (!marker) return rows.slice(-lineBudget)
	if (lineBudget === 1) {
		const latest = rows.at(-1) ?? ""
		return [truncateRow(`…${latest.slice(-(Math.max(1, width - 1)))}`, width)]
	}
	return [truncateRow(marker, width), ...rows.slice(-(lineBudget - 1))]
}

export function estimateVisualLineCount(text: string, columns = DEFAULT_COLUMNS): number {
	return splitIntoVisualRows(text, columns).length
}

export function clipTextToLastVisualLines(
	text: string,
	maxLines: number,
	columns = DEFAULT_COLUMNS,
	marker = "… earlier live output clipped …",
): string {
	const lineBudget = Math.max(1, maxLines)
	const width = Math.max(1, columns)
	const rows = splitIntoVisualRows(text, width)
	if (rows.length <= lineBudget) return text
	return prependClippingMarker(rows, marker, width, lineBudget).join("\n")
}

export function summarizeFirstLine(text: string, maxLength = 100): string {
	const line = text
		.split("\n")
		.map((part) => part.trim())
		.find(Boolean)

	if (!line) return ""

	const plain = line
		.replace(/^#{1,6}\s+/, "")
		.replace(/[*_`~]+/g, "")
		.replace(/^[-*+]\s+/, "")
		.replace(/^>\s+/, "")

	if (plain.length <= maxLength) return plain
	return `${plain.slice(0, Math.max(0, maxLength - 1))}…`
}

/**
 * Clip text to a visual-row window offset from the bottom. Long logical lines
 * are sliced as well as counted, so the returned text cannot exceed maxLines.
 */
export function clipTextToWindow(
	text: string,
	maxLines: number,
	columns = DEFAULT_COLUMNS,
	scrollFromBottom = 0,
	marker = "… earlier live output clipped …",
): { visibleText: string; hasMoreAbove: boolean; hasMoreBelow: boolean } {
	const lineBudget = Math.max(1, maxLines)
	const width = Math.max(1, columns)
	const rows = splitIntoVisualRows(text, width)
	if (rows.length <= lineBudget) {
		return { visibleText: text, hasMoreAbove: false, hasMoreBelow: false }
	}

	const maxScroll = rows.length - lineBudget
	const clampedScroll = Math.min(Math.max(0, scrollFromBottom), maxScroll)
	const windowEnd = rows.length - clampedScroll
	const hasMoreBelow = windowEnd < rows.length
	let contentBudget = lineBudget
	let windowStart = Math.max(0, windowEnd - contentBudget)
	const hasMoreAbove = windowStart > 0

	if (hasMoreAbove && marker && lineBudget > 1) {
		contentBudget -= 1
		windowStart = Math.max(0, windowEnd - contentBudget)
	}

	let visibleRows = rows.slice(windowStart, windowEnd)
	if (hasMoreAbove) {
		visibleRows = prependClippingMarker(visibleRows, marker, width, lineBudget)
	}

	return {
		visibleText: visibleRows.join("\n"),
		hasMoreAbove,
		hasMoreBelow,
	}
}
