---
component_id: 4.1.2
component_name: Diff Host Bridge Handlers
---

# Diff Host Bridge Handlers

## Component Description

Provides host bridge diff service RPC handlers for opening, scrolling, closing, and editing diff views and documents in VS Code.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/diff/openDiff.ts (lines 3-5)
```
export async function openDiff(_request: OpenDiffRequest): Promise<OpenDiffResponse> {
	throw new Error("diffService is not supported. Use the VscodeDiffViewProvider.")
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/diff/openMultiFileDiff.ts (lines 7-33)
```
export async function openMultiFileDiff(request: OpenMultiFileDiffRequest): Promise<OpenMultiFileDiffResponse> {
	const cwd = await getCwd()
	await vscode.commands.executeCommand(
		"vscode.changes",
		request.title,
		request.diffs.map((diff) => {
			const file = vscode.Uri.file(diff.filePath || "")
			const relativePath = path.relative(cwd, diff.filePath || "")
			const left = diff.leftContent ?? ""
			const right = diff.rightContent ?? ""
			return [
				file,
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${relativePath}`).with({
					query: Buffer.from(left).toString("base64"),
				}),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${relativePath}`).with({
					query: Buffer.from(right).toString("base64"),
				}),
			]
		}),
	)

	// Hide the bottom panel to give more room for the diff view
	vscode.commands.executeCommand("workbench.action.closePanel")

	return {}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/diff/saveDocument.ts (lines 3-5)
```
export async function saveDocument(_request: SaveDocumentRequest): Promise<SaveDocumentResponse> {
	throw new Error("diffService is not supported. Use the VscodeDiffViewProvider.")
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/diff/closeAllDiffs.ts`
- `src/hosts/vscode/hostbridge/diff/getDocumentText.ts`
- `src/hosts/vscode/hostbridge/diff/openDiff.ts`
- `src/hosts/vscode/hostbridge/diff/openMultiFileDiff.ts`
- `src/hosts/vscode/hostbridge/diff/replaceText.ts`
- `src/hosts/vscode/hostbridge/diff/saveDocument.ts`
- `src/hosts/vscode/hostbridge/diff/scrollDiff.ts`
- `src/hosts/vscode/hostbridge/diff/truncateDocument.ts`

