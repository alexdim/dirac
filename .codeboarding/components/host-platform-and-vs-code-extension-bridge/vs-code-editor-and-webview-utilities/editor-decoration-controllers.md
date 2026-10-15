---
component_id: 4.2.2
component_name: Editor Decoration Controllers
---

# Editor Decoration Controllers

## Component Description

Manages active-line and faded-overlay text editor decorations during streaming edits in VS Code.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/DecorationControllerManager.ts (lines 4-38)
```
export class DecorationControllerManager {
	private fadedOverlay?: DecorationController
	private activeLine?: DecorationController

	constructor(private editor: vscode.TextEditor) {}

	initialize(): void {
		this.fadedOverlay = new DecorationController("fadedOverlay", this.editor)
		this.activeLine = new DecorationController("activeLine", this.editor)
		this.fadedOverlay.addLines(0, this.editor.document.lineCount)
	}

	get fadedOverlayController(): DecorationController | undefined {
		return this.fadedOverlay
	}

	get activeLineController(): DecorationController | undefined {
		return this.activeLine
	}

	updateAfterReplace(currentLine: number): void {
		this.activeLine?.setActiveLine(currentLine)
		this.fadedOverlay?.updateOverlayAfterLine(currentLine, this.editor.document.lineCount)
	}

	clearAll(): void {
		this.fadedOverlay?.clear()
		this.activeLine?.clear()
	}

	reset(): void {
		this.fadedOverlay = undefined
		this.activeLine = undefined
	}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/DecorationController.ts (lines 18-78)
```
export class DecorationController {
	private decorationType: DecorationType
	private editor: vscode.TextEditor
	private ranges: vscode.Range[] = []

	constructor(decorationType: DecorationType, editor: vscode.TextEditor) {
		this.decorationType = decorationType
		this.editor = editor
	}

	getDecoration() {
		switch (this.decorationType) {
			case "fadedOverlay":
				return fadedOverlayDecorationType
			case "activeLine":
				return activeLineDecorationType
		}
	}

	addLines(startIndex: number, numLines: number) {
		// Guard against invalid inputs
		if (startIndex < 0 || numLines <= 0) {
			return
		}

		const lastRange = this.ranges[this.ranges.length - 1]
		if (lastRange && lastRange.end.line === startIndex - 1) {
			this.ranges[this.ranges.length - 1] = lastRange.with(undefined, lastRange.end.translate(numLines))
		} else {
			const endLine = startIndex + numLines - 1
			this.ranges.push(new vscode.Range(startIndex, 0, endLine, Number.MAX_SAFE_INTEGER))
		}

		this.editor.setDecorations(this.getDecoration(), this.ranges)
	}

	clear() {
		this.ranges = []
		this.editor.setDecorations(this.getDecoration(), this.ranges)
	}

	updateOverlayAfterLine(line: number, totalLines: number) {
		// Remove any existing ranges that start at or after the current line
		this.ranges = this.ranges.filter((range) => range.end.line < line)

		// Add a new range for all lines after the current line
		if (line < totalLines - 1) {
			this.ranges.push(
				new vscode.Range(new vscode.Position(line + 1, 0), new vscode.Position(totalLines - 1, Number.MAX_SAFE_INTEGER)),
			)
		}

		// Apply the updated decorations
		this.editor.setDecorations(this.getDecoration(), this.ranges)
	}

	setActiveLine(line: number) {
		this.ranges = [new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER)]
		this.editor.setDecorations(this.getDecoration(), this.ranges)
	}
}
```


## Source Files:

- `src/hosts/vscode/DecorationController.ts`
- `src/hosts/vscode/DecorationControllerManager.ts`

