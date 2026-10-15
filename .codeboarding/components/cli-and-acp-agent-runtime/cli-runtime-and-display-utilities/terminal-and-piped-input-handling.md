---
component_id: 2.2.4
component_name: Terminal & Piped Input Handling
---

# Terminal & Piped Input Handling

## Component Description

Manages interactive terminal input state, input viewport calculation, and piped standard input reading.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/utils/input-layout.ts (lines 60-65)
```
export function getInputCursorRow(rows: InputVisualRow[], cursorPosition: number): number {
	for (let index = 1; index < rows.length; index++) {
		if (rows[index].start > cursorPosition) return index - 1
	}
	return rows.length - 1
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/input-layout.ts (lines 27-58)
```
export function getInputVisualRows(text: string, columns: number): InputVisualRow[] {
	const width = Math.max(1, columns - 1)
	const rows: InputVisualRow[] = []
	let rowStart = 0
	let rowColumns = 0
	let cursorStops: CursorStop[] = []

	for (const { segment, index } of graphemes.segment(text)) {
		if (segment === "\n") {
			cursorStops.push({ index, column: rowColumns })
			rows.push({ start: rowStart, end: index, cursorStops })
			rowStart = index + 1
			rowColumns = 0
			cursorStops = []
			continue
		}

		const cellWidth = stringWidth(segment)
		if (rowColumns > 0 && rowColumns + cellWidth > width) {
			rows.push({ start: rowStart, end: index, cursorStops })
			rowStart = index
			rowColumns = 0
			cursorStops = []
		}
		cursorStops.push({ index, column: rowColumns })
		rowColumns += cellWidth
	}

	cursorStops.push({ index: text.length, column: rowColumns })
	rows.push({ start: rowStart, end: text.length, cursorStops })
	return rows
}
```


## Source Files:

- `cli/src/utils/input-layout.ts`
- `cli/src/utils/input-viewport.ts`
- `cli/src/utils/input.ts`
- `cli/src/utils/piped.ts`

