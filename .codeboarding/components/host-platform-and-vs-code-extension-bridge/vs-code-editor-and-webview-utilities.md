---
component_id: 4.2
component_name: VS Code Editor & Webview Utilities
---

# VS Code Editor & Webview Utilities

## Component Description

Provides VS Code editor managers, webview providers, document and notebook diff utilities, and commit message generation helpers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/VscodeWebviewProvider.ts (lines 16-221)
```
export class VscodeDiracWebviewProvider extends DiracWebviewProvider implements vscode.WebviewViewProvider {
	// Used in package.json as the view's id. This value cannot be changed due to how vscode caches
	// views based on their id, and updating the id would break existing instances of the extension.
	public static readonly SIDEBAR_ID = ExtensionRegistryInfo.views.Sidebar

	private webview?: vscode.WebviewView
	private disposables: vscode.Disposable[] = []

	override getWebviewUrl(path: string) {
		if (!this.webview) {
			throw new Error("Webview not initialized")
		}
		const uri = this.webview.webview.asWebviewUri(vscode.Uri.file(path))
		return uri.toString()
	}

	override getCspSource() {
		if (!this.webview) {
			throw new Error("Webview not initialized")
		}
		return this.webview.webview.cspSource
	}

	/**
	 * Forwards user-configurable VSCode settings to the webview via
	 * `window.__DIRAC_CONFIG__`. Currently exposes the optional Plan/Act toggle
	 * shortcut override (see the `dirac.planActToggleShortcut` setting and issue
	 * #100). When unset, the webview keeps the built-in default.
	 */
	protected override getInjectedConfig(): Record<string, unknown> {
		const config = vscode.workspace.getConfiguration("dirac")
		const planActToggleShortcut = config.get<string>("planActToggleShortcut")?.trim()
		return planActToggleShortcut ? { planActToggleShortcut } : {}
	}

	override isVisible() {
		return this.webview?.visible || false
	}

	public getWebview(): vscode.WebviewView | undefined {
		return this.webview
	}

	/**
	 * Initializes and sets up the webview when it's first created.
	 *
	 * @param webviewView - The sidebar webview view instance to be resolved
	 * @returns A promise that resolves when the webview has been fully initialized
	 */
	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.webview = webviewView

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		}

		webviewView.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent()
				: this.getHtmlContent()

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received
		this.setWebviewMessageListener(webviewView.webview)

		// Logs show up in bottom panel > Debug Console
		//Logger.log("registering listener")

		// Listen for when the sidebar becomes visible
		// https://github.com/microsoft/vscode-discussions/discussions/840

		// onDidChangeVisibility is only available on the sidebar webview
		// Otherwise WebviewView and WebviewPanel have all the same properties except for this visibility listener
		// WebviewPanel is not currently used in the extension
		webviewView.onDidChangeVisibility(
			async () => {
				if (this.webview?.visible) {
					// View becoming visible should not steal editor focus.
					await sendShowWebviewEvent(true)
				}
			},
			null,
			this.disposables,
		)

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				await this.dispose()
			},
			null,
			this.disposables,
		)

		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration(
			async (e) => {
				// The Plan/Act toggle shortcut is injected into the webview HTML at
				// render time, so re-render the HTML when it changes to apply the new
				// binding without requiring a manual reload.
				if (e.affectsConfiguration("dirac.planActToggleShortcut") && this.webview) {
					this.webview.webview.html =
						this.context.extensionMode === vscode.ExtensionMode.Development
							? await this.getHMRHtmlContent()
							: this.getHtmlContent()
				}
			},
			null,
			this.disposables,
		)

		// if the extension is starting a new session, clear previous task state
		this.controller.clearTask()

		Logger.log("[VscodeDiracWebviewProvider] Webview view resolved")

		// Title setting logic removed to allow VSCode to use the container title primarily.
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * IMPORTANT: When passing methods as callbacks in JavaScript/TypeScript, the method's
	 * 'this' context can be lost. This happens because the method is passed as a
	 * standalone function reference, detached from its original object.
	 *
	 * The Problem:
	 * Doing: webview.onDidReceiveMessage(this.controller.handleWebviewMessage)
	 * Would cause 'this' inside handleWebviewMessage to be undefined or wrong,
	 * leading to "TypeError: this.setUserInfo is not a function"
	 *
	 * The Solution:
	 * We wrap the method call in an arrow function, which:
	 * 1. Preserves the lexical scope's 'this' binding
	 * 2. Ensures handleWebviewMessage is called as a method on the controller instance
	 * 3. Maintains access to all controller methods and properties
	 *
	 * Alternative solutions could use .bind() or making handleWebviewMessage an arrow
	 * function property, but this approach is clean and explicit.
	 *
	 * @param webview The webview instance to attach the message listener to
	 */
	private setWebviewMessageListener(webview: vscode.Webview) {
		webview.onDidReceiveMessage(
			(message) => {
				this.handleWebviewMessage(message)
			},
			null,
			this.disposables,
		)
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	async handleWebviewMessage(message: WebviewMessage) {
		const postMessageToWebview = (response: ExtensionMessage) => this.postMessageToWebview(response)

		switch (message.type) {
			case "grpc_request": {
				if (message.grpc_request) {
					await handleGrpcRequest(this.controller, postMessageToWebview, message.grpc_request)
				}
				break
			}
			case "grpc_request_cancel": {
				if (message.grpc_request_cancel) {
					await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
				}
				break
			}
			default: {
				Logger.error("Received unhandled WebviewMessage type:", JSON.stringify(message))
			}
		}
	}

	/**
	 * Sends a message from the extension to the webview.
	 *
	 * @param message - The message to send to the webview
	 * @returns A thenable that resolves to a boolean indicating success, or undefined if the webview is not available
	 */
	private async postMessageToWebview(message: ExtensionMessage): Promise<boolean | undefined> {
		return this.webview?.webview.postMessage(message)
	}

	override async dispose() {
		// WebviewView doesn't have a dispose method, it's managed by VSCode
		// We just need to clean up our disposables
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		super.dispose()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/DocumentOperationManager.ts (lines 8-181)
```
export class DocumentOperationManager {
	async saveDocument(editor: vscode.TextEditor): Promise<boolean> {
		if (!editor) {
			return false
		}
		if (!editor.document.isDirty) {
			return true
		}
		try {
			return await pTimeout(editor.document.save(), {
				milliseconds: 10_000,
				message: "Failed to save document in VS Code within 10 seconds",
			})
		} catch (error) {
			Logger.warn(`DocumentOperationManager: failed to save document: ${error}`)
			return false
		}
	}

	async applyAndSaveSilently(
		absolutePath: string,
		content: string,
	): Promise<{
		finalContent: string | undefined
		autoFormattingEdits: string | undefined
		userEdits: string | undefined
	}> {
		const uri = vscode.Uri.file(absolutePath)

		await createDirectoriesForFile(absolutePath)

		try {
			await vscode.workspace.fs.stat(uri)
		} catch (_error) {
			await vscode.workspace.fs.writeFile(uri, new Uint8Array())
		}

		const document = await vscode.workspace.openTextDocument(uri)

		const edit = new vscode.WorkspaceEdit()
		const range = new vscode.Range(0, 0, document.lineCount, 0)
		edit.replace(uri, range, content)
		const applied = await vscode.workspace.applyEdit(edit)
		if (!applied) {
			throw new Error(`Failed to apply edit in VS Code: ${absolutePath}`)
		}

		const saved = await pTimeout(document.save(), {
			milliseconds: 10_000,
			message: "Failed to save document in VS Code within 10 seconds",
		})
		if (!saved) {
			throw new Error(`Failed to save document in VS Code: ${absolutePath}`)
		}

		return this.computeResults(content, document)
	}

	async applyAndSaveBatchSilently(
		files: { path: string; content: string }[],
	): Promise<
		Map<string, { finalContent: string | undefined; autoFormattingEdits: string | undefined; userEdits: string | undefined }>
	> {
		const results = new Map<
			string,
			{ finalContent: string | undefined; autoFormattingEdits: string | undefined; userEdits: string | undefined }
		>()

		const edit = new vscode.WorkspaceEdit()
		const documents: vscode.TextDocument[] = []

		for (const file of files) {
			const uri = vscode.Uri.file(file.path)
			await createDirectoriesForFile(file.path)
			try {
				await vscode.workspace.fs.stat(uri)
			} catch (_error) {
				await vscode.workspace.fs.writeFile(uri, new Uint8Array())
			}

			const document = await vscode.workspace.openTextDocument(uri)
			documents.push(document)
			const range = new vscode.Range(0, 0, document.lineCount, 0)
			edit.replace(uri, range, file.content)
		}

		const applied = await vscode.workspace.applyEdit(edit)
		if (!applied) {
			throw new Error("Failed to apply batch edit in VS Code")
		}

		await Promise.all(
			documents.map(async (doc) => {
				const saved = await pTimeout(doc.save(), {
					milliseconds: 10_000,
					message: `Failed to save document ${doc.uri.fsPath} in VS Code within 10 seconds`,
				})
				if (!saved) {
					throw new Error(`Failed to save document ${doc.uri.fsPath} in VS Code`)
				}
			}),
		)

		const cwd = await (await import("@utils/path")).getCwd()
		const { formatResponse } = await import("@core/formatResponse")

		for (let i = 0; i < files.length; i++) {
			const file = files[i]
			const document = documents[i]
			const result = this.computeResults(file.content, document)
			const normalizedPostSaveContent = result.finalContent ?? ""

			let autoFormattingEdits: string | undefined
			if (result.finalContent && normalizedPostSaveContent !== result.finalContent) {
				autoFormattingEdits = formatResponse.createPrettyPatch(
					path.relative(cwd, file.path).replace(/\\/g, "/"),
					result.finalContent,
					normalizedPostSaveContent,
				)
			}

			results.set(file.path, {
				finalContent: normalizedPostSaveContent,
				autoFormattingEdits,
				userEdits: undefined,
			})
		}

		return results
	}

	private computeResults(content: string, document: vscode.TextDocument) {
		const postSaveContent = document.getText()
		const newContentEOL = content.includes("\r\n") ? "\r\n" : "\n"
		const normalizedNewContent = content.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL
		const normalizedPostSaveContent = postSaveContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL

		return {
			finalContent: normalizedPostSaveContent,
			autoFormattingEdits: undefined as string | undefined,
			userEdits: undefined as string | undefined,
		}
	}

	async format(filePath: string): Promise<string> {
		const uri = vscode.Uri.file(filePath)
		try {
			const document = await vscode.workspace.openTextDocument(uri)
			const editorConfig = vscode.workspace.getConfiguration("editor", uri)
			const insertSpaces = editorConfig.get<boolean>("insertSpaces", true)
			const tabSize = editorConfig.get<number>("tabSize", 4)
			const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", uri, {
				insertSpaces,
				tabSize,
			})
			if (edits && edits.length > 0) {
				const edit = new vscode.WorkspaceEdit()
				edit.set(uri, edits)
				await vscode.workspace.applyEdit(edit)
				const editor = vscode.window.visibleTextEditors.find((e) => arePathsEqual(e.document.uri.fsPath, filePath))
				if (editor) {
					await editor.document.save()
				} else {
					await document.save()
				}
			}
			return document.getText()
		} catch (error) {
			Logger.warn(`DocumentOperationManager: format failed for ${filePath}: ${error}`)
			const document = await vscode.workspace.openTextDocument(uri)
			return document.getText()
		}
	}
}
```

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

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/commit-message-generator.ts (lines 51-83)
```
export async function generateCommitMsg(controller: Controller, scm?: vscode.SourceControl) {
	try {
		const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports
		if (!gitExtension) {
			throw new Error("Git extension not found")
		}

		const git = gitExtension.getAPI(1)
		if (git.repositories.length === 0) {
			throw new Error("No Git repositories available")
		}

		// If scm is provided, then the user specified one repository by clicking the "Source Control" menu button
		if (scm) {
			const repository = git.getRepository(scm.rootUri)

			if (!repository) {
				throw new Error("Repository not found for provided SCM")
			}

			await generateCommitMsgForRepository(controller, repository)
			return
		}

		await orchestrateWorkspaceCommitMsgGeneration(controller, git.repositories)
	} catch (error) {
		const errorMessage = getErrorMessage(error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `[Commit Generation Failed] ${errorMessage}`,
		})
	}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/commandUtils.ts (lines 106-110)
```
export async function showWebview(preserveEditorFocus = true): Promise<DiracWebviewProvider> {
	await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.FocusChatInput, preserveEditorFocus)

	return DiracWebviewProvider.getInstance()
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/iconUtils.ts (lines 4-6)
```
export function getDiracIconUri(): vscode.Uri {
	return vscode.Uri.joinPath(vscode.Uri.file(HostProvider.get().extensionFsPath), "assets", "icons", "icon.svg")
}
```


## Source Files:

- `src/hosts/vscode/DecorationController.ts`
- `src/hosts/vscode/DecorationControllerManager.ts`
- `src/hosts/vscode/DocumentOperationManager.ts`
- `src/hosts/vscode/NotebookDiffManager.ts`
- `src/hosts/vscode/NotebookDiffView.ts`
- `src/hosts/vscode/StreamingTextUpdater.ts`
- `src/hosts/vscode/TabManager.ts`
- `src/hosts/vscode/VscodeWebviewProvider.ts`
- `src/hosts/vscode/commandUtils.ts`
- `src/hosts/vscode/commit-message-generator.ts`
- `src/hosts/vscode/host-capabilities.ts`
- `src/hosts/vscode/iconUtils.ts`
- `src/hosts/vscode/python.ts`
- `src/hosts/vscode/vscode-lm-format.ts`
- `src/hosts/vscode/vscode-to-file-migration.ts`

