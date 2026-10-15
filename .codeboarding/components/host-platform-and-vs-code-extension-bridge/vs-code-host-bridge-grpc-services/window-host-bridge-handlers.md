---
component_id: 4.1.1
component_name: Window Host Bridge Handlers
---

# Window Host Bridge Handlers

## Component Description

Implements VS Code window RPC handlers for managing editors, tabs, file and save dialogs, input boxes, settings, and user notifications.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/window/openFile.ts (lines 4-7)
```
export async function openFile(request: OpenFileRequest): Promise<OpenFileResponse> {
	await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(request.filePath))
	return OpenFileResponse.create({})
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/window/getActiveEditor.ts (lines 5-8)
```
export async function getActiveEditor(_: GetActiveEditorRequest): Promise<GetActiveEditorResponse> {
	const filePath = vscode.window.activeTextEditor?.document.uri.fsPath
	return { filePath }
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/window/showMessage.ts (lines 6-26)
```
export async function showMessage(request: ShowMessageRequest): Promise<SelectedResponse> {
	const { message, type, options } = request
	const { modal, detail, items } = { ...DEFAULT_OPTIONS, ...options }
	const option = { modal, detail }

	let selectedOption: string | undefined

	switch (type) {
		case ShowMessageType.ERROR:
			selectedOption = await window.showErrorMessage(message, option, ...items)
			break
		case ShowMessageType.WARNING:
			selectedOption = await window.showWarningMessage(message, option, ...items)
			break
		default:
			selectedOption = await window.showInformationMessage(message, option, ...items)
			break
	}

	return SelectedResponse.create({ selectedOption })
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/window/getActiveEditor.ts`
- `src/hosts/vscode/hostbridge/window/getOpenTabs.ts`
- `src/hosts/vscode/hostbridge/window/getVisibleTabs.ts`
- `src/hosts/vscode/hostbridge/window/openFile.ts`
- `src/hosts/vscode/hostbridge/window/openSettings.ts`
- `src/hosts/vscode/hostbridge/window/showInputBox.ts`
- `src/hosts/vscode/hostbridge/window/showMessage.ts`
- `src/hosts/vscode/hostbridge/window/showOpenDialogue.ts`
- `src/hosts/vscode/hostbridge/window/showSaveDialog.ts`
- `src/hosts/vscode/hostbridge/window/showTextDocument.ts`

