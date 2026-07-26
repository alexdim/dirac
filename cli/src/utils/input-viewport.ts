export interface InputViewport {
	text: string
	cursorPosition: number
	hasHiddenBefore: boolean
	hasHiddenAfter: boolean
}

interface VisualRow {
	start: number
	end: number
}

function splitIntoVisualRows(text: string, columns: number): VisualRow[] {
	const width = Math.max(1, columns)
	const rows: VisualRow[] = []
	let rowStart = 0
	let rowColumns = 0

	for (let index = 0; index < text.length; index++) {
		if (text[index] === "\n") {
			rows.push({ start: rowStart, end: index + 1 })
			rowStart = index + 1
			rowColumns = 0
			continue
		}

		rowColumns += 1
		if (rowColumns === width) {
			rows.push({ start: rowStart, end: index + 1 })
			rowStart = index + 1
			rowColumns = 0
		}
	}

	if (rowStart < text.length || text.endsWith("\n") || rows.length === 0) {
		rows.push({ start: rowStart, end: text.length })
	}

	return rows
}

/**
 * Select a contiguous visual-row window containing the cursor. The cursor is
 * centered when possible so editing in the middle of a long draft retains
 * useful context above and below it.
 */
export function createInputViewport(
	text: string,
	cursorPosition: number,
	columns: number,
	maxRows: number,
): InputViewport {
	const safeCursorPosition = Math.max(0, Math.min(text.length, cursorPosition))
	const rowBudget = Math.max(1, maxRows)
	const rows = splitIntoVisualRows(text, columns)

	if (rows.length <= rowBudget) {
		return {
			text,
			cursorPosition: safeCursorPosition,
			hasHiddenBefore: false,
			hasHiddenAfter: false,
		}
	}

	let cursorRow = rows.findIndex((row) => safeCursorPosition < row.end)
	if (cursorRow === -1) cursorRow = rows.length - 1

	const rowsBeforeCursor = Math.floor(rowBudget / 2)
	const maximumStartRow = rows.length - rowBudget
	const startRow = Math.min(maximumStartRow, Math.max(0, cursorRow - rowsBeforeCursor))
	const endRow = startRow + rowBudget
	const sliceStart = rows[startRow].start
	const sliceEnd = rows[endRow - 1].end

	return {
		text: text.slice(sliceStart, sliceEnd),
		cursorPosition: safeCursorPosition - sliceStart,
		hasHiddenBefore: startRow > 0,
		hasHiddenAfter: endRow < rows.length,
	}
}
