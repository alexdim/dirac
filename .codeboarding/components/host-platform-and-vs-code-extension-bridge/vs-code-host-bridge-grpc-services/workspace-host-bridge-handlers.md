---
component_id: 4.1.3
component_name: Workspace Host Bridge Handlers
---

# Workspace Host Bridge Handlers

## Component Description

Implements VS Code workspace RPC handlers for opening folders, sidebar and explorer panels, terminal execution, and workspace diagnostics preparation.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts (lines 11-42)
```
export async function executeCommandInTerminal(
	request: ExecuteCommandInTerminalRequest,
): Promise<ExecuteCommandInTerminalResponse> {
	try {
		// Create terminal with fixed options
		const terminalOptions: vscode.TerminalOptions = {
			name: "Dirac",
			iconPath: getDiracIconUri(),
			env: {
				DIRAC_ACTIVE: "true",
			},
		}

		// Create a new terminal
		const terminal = vscode.window.createTerminal(terminalOptions)

		// Show the terminal to the user
		terminal.show()

		// Send the command to the terminal
		terminal.sendText(request.command, true)

		return ExecuteCommandInTerminalResponse.create({
			success: true,
		})
	} catch (error) {
		Logger.error("Error executing command in terminal:", error)
		return ExecuteCommandInTerminalResponse.create({
			success: false,
		})
	}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/workspace/openFolder.ts (lines 5-16)
```
export async function openFolder(request: OpenFolderRequest): Promise<OpenFolderResponse> {
	try {
		const uri = vscode.Uri.file(request.path)
		await vscode.commands.executeCommand("vscode.openFolder", uri, {
			forceNewWindow: request.newWindow,
		})
		return OpenFolderResponse.create({ success: true })
	} catch (error) {
		Logger.error("Failed to open folder:", error)
		return OpenFolderResponse.create({ success: false })
	}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/workspace/prepareDiagnostics.ts (lines 4-19)
```
export async function prepareDiagnostics(request: PrepareDiagnosticsRequest): Promise<PrepareDiagnosticsResponse> {
	try {
		await Promise.all(
			request.filePaths.map(async (filePath) => {
				try {
					await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
				} catch (error) {
					// Ignore errors opening documents
				}
			}),
		)
		return { success: true }
	} catch (error) {
		return { success: false }
	}
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts`
- `src/hosts/vscode/hostbridge/workspace/openDiracSidebarPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openFolder.ts`
- `src/hosts/vscode/hostbridge/workspace/openInFileExplorerPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openProblemsPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openTerminalPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/prepareDiagnostics.ts`

