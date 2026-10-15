---
component_id: 4.2.3
component_name: Notebook Diff View Management
---

# Notebook Diff View Management

## Component Description

Manages specialized Jupyter notebook `.ipynb` diff views and editor switching within VS Code.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/NotebookDiffManager.ts (lines 5-42)
```
export class NotebookDiffManager {
	private notebookDiffView?: NotebookDiffView

	isNotebookFile(relPath: string | undefined): boolean {
		return relPath?.toLowerCase().endsWith(".ipynb") ?? false
	}

	async switchToSpecializedEditor(absolutePath: string, editor: vscode.TextEditor): Promise<void> {
		if (!this.notebookDiffView) {
			try {
				this.notebookDiffView = new NotebookDiffView()
				await this.notebookDiffView.open(absolutePath, editor)
			} catch (error) {
				Logger.error("NotebookDiffManager: failed to create notebook diff view:", error)
			}
		}
	}

	async showFileForNotebook(uri: vscode.Uri): Promise<void> {
		const jupyterExtension = vscode.extensions.getExtension("ms-toolsai.jupyter")
		if (jupyterExtension) {
			await vscode.commands.executeCommand("vscode.openWith", uri, "jupyter-notebook")
			return
		}
		await vscode.window.showTextDocument(uri, { preview: false })
	}

	async cleanup(): Promise<void> {
		if (this.notebookDiffView) {
			await this.notebookDiffView.cleanup()
			this.notebookDiffView = undefined
		}
	}

	reset(): void {
		this.notebookDiffView = undefined
	}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/NotebookDiffView.ts (lines 13-119)
```
export class NotebookDiffView {
	private tempModifiedUri?: vscode.Uri
	private tempFileWatcher?: vscode.FileSystemWatcher

	/**
	 * Opens a notebook diff view for the given file.
	 *
	 * @param absolutePath Path to the notebook file
	 * @param editor The active text editor containing modified content
	 */
	async open(absolutePath: string, editor: vscode.TextEditor): Promise<void> {
		const uri = vscode.Uri.file(absolutePath)
		const fileName = path.basename(uri.fsPath)

		// Check if Jupyter extension is available
		const jupyterExtension = vscode.extensions.getExtension("ms-toolsai.jupyter")
		if (!jupyterExtension) {
			vscode.window.showErrorMessage("Jupyter extension is required for notebook diffs.")
			return
		}

		if (!jupyterExtension.isActive) {
			await jupyterExtension.activate()
		}

		await this.createDiffView(uri, fileName, editor)
	}

	private async createDiffView(uri: vscode.Uri, fileName: string, editor: vscode.TextEditor): Promise<void> {
		const tempDir = os.tmpdir()
		const timestamp = Date.now()
		const tempModifiedPath = path.join(tempDir, `dirac-modified-${timestamp}-${fileName}`)

		const currentContent = editor.document.getText()

		// Validate JSON before creating notebook diff
		try {
			JSON.parse(currentContent)
		} catch {
			Logger.error(`Invalid JSON content for notebook file ${fileName}, skipping notebook diff view`)
			return
		}

		await vscode.workspace.fs.writeFile(vscode.Uri.file(tempModifiedPath), new TextEncoder().encode(currentContent))

		this.tempModifiedUri = vscode.Uri.file(tempModifiedPath)
		this.setupFileWatcher(editor)

		await vscode.commands.executeCommand(
			"vscode.diff",
			uri,
			this.tempModifiedUri,
			`${fileName}: Original ↔ Dirac's Changes (Notebook)`,
		)

		// Brief delay to allow VS Code to render the notebook diff view
		await new Promise((resolve) => setTimeout(resolve, 500))
	}

	private setupFileWatcher(editor: vscode.TextEditor): void {
		if (!this.tempModifiedUri) {
			return
		}

		const tempDir = path.dirname(this.tempModifiedUri.fsPath)
		const tempFileName = path.basename(this.tempModifiedUri.fsPath)
		this.tempFileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(tempDir, tempFileName))

		this.tempFileWatcher.onDidChange(async () => {
			await this.syncToEditor(editor)
		})
	}

	private async syncToEditor(editor: vscode.TextEditor): Promise<void> {
		if (!this.tempModifiedUri || !editor.document) {
			return
		}

		try {
			const tempContent = await vscode.workspace.fs.readFile(this.tempModifiedUri)
			const tempContentString = new TextDecoder().decode(tempContent)

			const edit = new vscode.WorkspaceEdit()
			const fullRange = new vscode.Range(0, 0, editor.document.lineCount, 0)
			edit.replace(editor.document.uri, fullRange, tempContentString)
			await vscode.workspace.applyEdit(edit)
		} catch (error) {
			Logger.error("Failed to sync temp file to editor:", error)
		}
	}

	async cleanup(): Promise<void> {
		if (this.tempFileWatcher) {
			this.tempFileWatcher.dispose()
			this.tempFileWatcher = undefined
		}

		if (this.tempModifiedUri) {
			try {
				await vscode.workspace.fs.delete(this.tempModifiedUri)
			} catch (error) {
				Logger.error(`Failed to cleanup temporary file: ${error}`)
			}
			this.tempModifiedUri = undefined
		}
	}
}
```


## Source Files:

- `src/hosts/vscode/NotebookDiffManager.ts`
- `src/hosts/vscode/NotebookDiffView.ts`

