---
component_id: 6.3
component_name: VS Code Workspace Host Bridge
---

# VS Code Workspace Host Bridge

## Component Description

Implements VS Code host bridge handlers for workspace path retrieval, document saving, and diagnostic collection.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/workspace/getDiagnostics.ts (lines 24-45)
```
export function convertToFileDiagnostics(vscodeAllDiagnostics: [vscode.Uri, vscode.Diagnostic[]][]): FileDiagnostics[] {
	const workspaceFolders = vscode.workspace.workspaceFolders || []

	const result = []
	for (const [uri, diagnostics] of vscodeAllDiagnostics) {
		if (diagnostics.length > 0) {
			result.push(
				FileDiagnostics.create({
					filePath: (() => {
						const folder = workspaceFolders.find((f) => uri.fsPath.startsWith(f.uri.fsPath))
						if (folder) {
							return path.relative(folder.uri.fsPath, uri.fsPath).toPosix()
						}
						return uri.fsPath.toPosix()
					})(),
					diagnostics: convertVscodeDiagnostics(diagnostics),
				}),
			)
		}
	}
	return result
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/workspace/saveOpenDocumentIfDirty.ts (lines 5-12)
```
export async function saveOpenDocumentIfDirty(request: SaveOpenDocumentIfDirtyRequest): Promise<SaveOpenDocumentIfDirtyResponse> {
	const existingDocument = vscode.workspace.textDocuments.find((doc) => arePathsEqual(doc.uri.fsPath, request.filePath))
	if (existingDocument && existingDocument.isDirty) {
		await existingDocument.save()
		return { wasSaved: true }
	}
	return {}
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/workspace/getDiagnostics.ts`
- `src/hosts/vscode/hostbridge/workspace/getWorkspacePaths.ts`
- `src/hosts/vscode/hostbridge/workspace/saveOpenDocumentIfDirty.ts`

