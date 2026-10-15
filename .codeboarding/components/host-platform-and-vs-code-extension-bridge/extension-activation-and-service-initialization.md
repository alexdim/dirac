---
component_id: 4.6
component_name: Extension Activation & Service Initialization
---

# Extension Activation & Service Initialization

## Component Description

Bootstraps the VS Code extension lifecycle, registers host providers and commands, and initializes shared runtime services.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/extension.ts (lines 60-552)
```
export async function activate(context: vscode.ExtensionContext) {
	const activationStartTime = performance.now()

	// 1. Create storage context to determine shared data directory
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	const storageContext = createStorageContext({ workspacePath })

	// 2. Set up HostProvider for VSCode using shared data directory
	// IMPORTANT: This must be done before any service can be registered
	await setupHostProvider(context, storageContext.dataDir)

	// 3. Clean up legacy data patterns within VSCode's native storage.
	// Moves workspace→global keys, task history→file, custom instructions→rules, etc.
	// Must run BEFORE the file export so we copy clean state.
	await cleanupLegacyVSCodeStorage(context)

	// 4. One-time export of VSCode's native storage to shared file-backed stores.
	// After this, all platforms (VSCode, CLI, JetBrains) read from ~/.dirac/data/.
	await exportVSCodeStorageToSharedFiles(context, storageContext)

	// 4. Register services and perform common initialization
	// IMPORTANT: Must be done after host provider is setup and migrations are complete
	const webview = (await initialize(storageContext)) as VscodeDiracWebviewProvider

	// 5. Register services and commands specific to VS Code
	// Initialize test mode and add disposables to context
	const testModeWatchers = await initializeTestMode(webview)
	context.subscriptions.push(...testModeWatchers)

	// Initialize hook discovery cache for performance optimization
	HookDiscoveryCache.getInstance().initialize(
		{ subscriptions: context.subscriptions },
		(dir: string) => {
			try {
				const pattern = new vscode.RelativePattern(dir, "*")
				const watcher = vscode.workspace.createFileSystemWatcher(pattern)
				// Ensure watcher is disposed when extension is deactivated
				context.subscriptions.push(watcher)
				// Adapt VSCode FileSystemWatcher to generic interface
				return {
					onDidCreate: (listener: () => void) => watcher.onDidCreate(listener),
					onDidChange: (listener: () => void) => watcher.onDidChange(listener),
					onDidDelete: (listener: () => void) => watcher.onDidDelete(listener),
					dispose: () => watcher.dispose(),
				}
			} catch {
				return null
			}
		},
		(callback: () => void) => {
			// Adapt VSCode Disposable to generic interface
			const disposable = vscode.workspace.onDidChangeWorkspaceFolders(callback)
			context.subscriptions.push(disposable)
			return disposable
		},
	)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VscodeDiracWebviewProvider.SIDEBAR_ID, webview, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	// NOTE: Commands must be added to the internal registry before registering them with VSCode
	const { commands } = ExtensionRegistryInfo

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.PlusButton, async () => {
			const sidebarInstance = DiracWebviewProvider.getInstance()
			await sidebarInstance.controller.clearTask()
			await sidebarInstance.controller.postStateToWebview()
			await sendChatButtonClickedEvent()
		}),
	)
	context.subscriptions.push(vscode.commands.registerCommand(commands.SettingsButton, () => sendSettingsButtonClickedEvent()))
	context.subscriptions.push(vscode.commands.registerCommand(commands.HistoryButton, () => sendHistoryButtonClickedEvent()))
	context.subscriptions.push(vscode.commands.registerCommand(commands.WorktreesButton, () => sendWorktreesButtonClickedEvent()))

	/*
	We use the text document content provider API to show the left side for diff view by creating a
	virtual document for the original content. This makes it readonly so users know to edit the right
	side if they want to keep their changes.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by
	claiming an uri-scheme for which your provider then returns text contents. The scheme must be
	provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents
	 given such an uri. In return, content providers are wired into the open document logic so that
	 providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider))
	// Register commands for Accept/Reject from CodeLens
	context.subscriptions.push(
		vscode.commands.registerCommand("dirac.acceptEdit", async () => {
			const sidebarInstance = DiracWebviewProvider.getInstance()
			if (sidebarInstance.controller?.task) {
				await sidebarInstance.controller.task.submitCardResponse("", DiracAskResponse.APPROVE)
			}
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("dirac.saveWithMyChanges", async () => {
			const sidebarInstance = DiracWebviewProvider.getInstance()
			if (sidebarInstance.controller?.task) {
				await sidebarInstance.controller.task.submitCardResponse("", DiracAskResponse.APPROVE)
			}
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("dirac.rejectEdit", async () => {
			const sidebarInstance = DiracWebviewProvider.getInstance()
			if (sidebarInstance.controller?.task) {
				await sidebarInstance.controller.task.submitCardResponse("", DiracAskResponse.REJECT)
			}
		}),
	)

	const handleUri = async (uri: vscode.Uri) => {
		const url = decodeURIComponent(uri.toString())
		const isTaskUri = getUriPath(url) === TASK_URI_PATH

		if (isTaskUri) {
			await openDiracSidebarForTaskUri()
		}

		let success = await SharedUriHandler.handleUri(url)

		// Task deeplinks can race with first-time sidebar initialization.
		if (!success && isTaskUri) {
			await openDiracSidebarForTaskUri()
			success = await SharedUriHandler.handleUri(url)
		}

		if (!success) {
			Logger.warn("Extension URI handler: Failed to process URI:", uri.toString())
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register size testing commands in development mode
	if (IS_DEV) {
		vscode.commands.executeCommand("setContext", "dirac.isDevMode", IS_DEV)
		// Use dynamic import to avoid loading the module in production
		import("./dev/commands/tasks")
			.then((module) => {
				const devTaskCommands = module.registerTaskCommands(webview.controller)
				context.subscriptions.push(...devTaskCommands)
				Logger.log("[Dirac Dev] Dev mode activated & dev commands registered")
			})
			.catch((error) => {
				Logger.log("[Dirac Dev] Failed to register dev commands: " + error)
			})
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.TerminalOutput, async () => {
			const terminal = vscode.window.activeTerminal
			if (!terminal) {
				return
			}

			// Save current clipboard content
			const tempCopyBuffer = await readTextFromClipboard()

			try {
				// Copy the *existing* terminal selection (without selecting all)
				await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

				// Get copied content
				const terminalContents = (await readTextFromClipboard()).trim()

				// Restore original clipboard content
				await writeTextToClipboard(tempCopyBuffer)

				if (!terminalContents) {
					// No terminal content was copied (either nothing selected or some error)
					return
				}
				// Ensure the sidebar view is visible but preserve editor focus
				await showWebview(true)

				await sendAddToInputEvent(`Terminal output:\n\`\`\`\n${terminalContents}\n\`\`\``)

				Logger.log("addSelectedTerminalOutputToChat", terminalContents, terminal.name)
			} catch (error) {
				// Ensure clipboard is restored even if an error occurs
				await writeTextToClipboard(tempCopyBuffer)
				Logger.error("Error getting terminal contents:", error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Failed to get terminal contents",
				})
			}
		}),
	)

	// Register code action provider
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			"*",
			new (class implements vscode.CodeActionProvider {
				public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor]

				provideCodeActions(
					document: vscode.TextDocument,
					range: vscode.Range,
					context: vscode.CodeActionContext,
				): vscode.CodeAction[] {
					const CONTEXT_LINES_TO_EXPAND = 3
					const START_OF_LINE_CHAR_INDEX = 0
					const LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING = 1

					const actions: vscode.CodeAction[] = []
					const editor = vscode.window.activeTextEditor // Get active editor for selection check

					// Expand range to include surrounding 3 lines or use selection if broader
					const selection = editor?.selection
					let expandedRange = range
					if (
						editor &&
						selection &&
						!selection.isEmpty &&
						selection.contains(range.start) &&
						selection.contains(range.end)
					) {
						expandedRange = selection
					} else {
						expandedRange = new vscode.Range(
							Math.max(0, range.start.line - CONTEXT_LINES_TO_EXPAND),
							START_OF_LINE_CHAR_INDEX,
							Math.min(
								document.lineCount - LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING,
								range.end.line + CONTEXT_LINES_TO_EXPAND,
							),
							document.lineAt(
								Math.min(
									document.lineCount - LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING,
									range.end.line + CONTEXT_LINES_TO_EXPAND,
								),
							).text.length,
						)
					}

					// Add to Dirac (Always available)
					const addAction = new vscode.CodeAction("Add to Dirac", vscode.CodeActionKind.QuickFix)
					addAction.command = {
						command: commands.AddToChat,
						title: "Add to Dirac",
						arguments: [expandedRange, context.diagnostics],
					}
					actions.push(addAction)

					// Explain with Dirac (Always available)
					const explainAction = new vscode.CodeAction("Explain with Dirac", vscode.CodeActionKind.RefactorExtract) // Using a refactor kind
					explainAction.command = {
						command: commands.ExplainCode,
						title: "Explain with Dirac",
						arguments: [expandedRange],
					}
					actions.push(explainAction)

					// Improve with Dirac (Always available)
					const improveAction = new vscode.CodeAction("Improve with Dirac", vscode.CodeActionKind.RefactorRewrite) // Using a refactor kind
					improveAction.command = {
						command: commands.ImproveCode,
						title: "Improve with Dirac",
						arguments: [expandedRange],
					}
					actions.push(improveAction)

					// Fix with Dirac (Only if diagnostics exist)
					if (context.diagnostics.length > 0) {
						const fixAction = new vscode.CodeAction("Fix with Dirac", vscode.CodeActionKind.QuickFix)
						fixAction.isPreferred = true
						fixAction.command = {
							command: commands.FixWithDirac,
							title: "Fix with Dirac",
							arguments: [expandedRange, context.diagnostics],
						}
						actions.push(fixAction)
					}
					return actions
				}
			})(),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.RefactorExtract,
					vscode.CodeActionKind.RefactorRewrite,
				],
			},
		),
	)

	// Register the command handlers
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AddToChat, async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
			const context = await getContextForCommand(range, diagnostics)
			if (!context) {
				return
			}
			await addToDirac(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.FixWithDirac, async (range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
			const context = await getContextForCommand(range, diagnostics)
			if (!context) {
				return
			}
			await fixWithDirac(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ExplainCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await explainWithDirac(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ImproveCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await improveWithDirac(context.controller, context.commandContext)
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.FocusChatInput, async (preserveEditorFocus = false) => {
			const webview = DiracWebviewProvider.getInstance() as VscodeDiracWebviewProvider

			// Show the webview
			const webviewView = webview.getWebview()
			if (webviewView) {
				if (preserveEditorFocus) {
					// Only make webview visible without forcing focus
					webviewView.show(false)
				} else {
					// Show and force focus (default behavior for explicit focus actions)
					webviewView.show(true)
				}
			}

			// Send show webview event with preserveEditorFocus flag
			sendShowWebviewEvent(preserveEditorFocus)
			telemetryService.captureButtonClick("command_focusChatInput", webview.controller?.task?.ulid)
		}),
	)

	// Register Jupyter Notebook command handlers
	const NOTEBOOK_EDIT_INSTRUCTIONS = `Special considerations for using edit_file on *.ipynb files:
* Jupyter notebook files are JSON format with specific structure for source code cells
* Source code in cells is stored as JSON string arrays ending with explicit \\n characters and commas
* Always match the exact JSON format including quotes, commas, and escaped newlines.`

	// Helper to get notebook context for Jupyter commands
	async function getNotebookCommandContext(range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) {
		const activeNotebook = vscode.window.activeNotebookEditor
		if (!activeNotebook) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "No active Jupyter notebook found. Please open a .ipynb file first.",
			})
			return null
		}

		const ctx = await getContextForCommand(range, diagnostics)
		if (!ctx) {
			return null
		}

		const filePath = ctx.commandContext.filePath || ""
		let cellJson: string | null = null
		if (activeNotebook.notebook.cellCount > 0) {
			const cellIndex = activeNotebook.notebook.cellAt(activeNotebook.selection.start).index
			cellJson = await findMatchingNotebookCell(filePath, cellIndex)
		}

		return { ...ctx, cellJson }
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterGenerateCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const userPrompt = await showJupyterPromptInput(
					"Generate Notebook Cell",
					"Enter your prompt for generating notebook cell (press Enter to confirm & Esc to cancel)",
				)
				if (!userPrompt) return

				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = `User prompt: ${userPrompt}
Insert a new Jupyter notebook cell above or below the current cell based on user prompt.
${NOTEBOOK_EDIT_INSTRUCTIONS}

Current Notebook Cell Context (JSON, sanitized of image data):
\`\`\`json
${ctx.cellJson || "{}"}
\`\`\``

				await addToDirac(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterExplainCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = ctx.cellJson
					? `\n\nCurrent Notebook Cell Context (JSON, sanitized of image data):\n\`\`\`json\n${ctx.cellJson}\n\`\`\``
					: undefined

				await explainWithDirac(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterImproveCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const userPrompt = await showJupyterPromptInput(
					"Improve Notebook Cell",
					"Enter your prompt for improving the current notebook cell (press Enter to confirm & Esc to cancel)",
				)
				if (!userPrompt) return

				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = `User prompt: ${userPrompt}
${NOTEBOOK_EDIT_INSTRUCTIONS}

Current Notebook Cell Context (JSON, sanitized of image data):
\`\`\`json
${ctx.cellJson || "{}"}
\`\`\``

				await improveWithDirac(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	// Register the openWalkthrough command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.Walkthrough, async () => {
			await vscode.commands.executeCommand("workbench.action.openWalkthrough", `${context.extension.id}#DiracWalkthrough`)
			telemetryService.captureButtonClick("command_openWalkthrough")
		}),
	)

	// Register the reconstructTaskHistory command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ReconstructTaskHistory, async () => {
			const { reconstructTaskHistory } = await import("./core/commands/reconstructTaskHistory")
			await reconstructTaskHistory()
			telemetryService.captureButtonClick("command_reconstructTaskHistory")
		}),
	)

	// Register the generateGitCommitMessage command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GenerateCommit, async (scm) => {
			generateCommitMsg(webview.controller, scm)
		}),
		vscode.commands.registerCommand(commands.AbortCommit, () => {
			abortCommitGeneration()
		}),
	)

	Logger.log(`[Dirac] extension activated in ${performance.now() - activationStartTime} ms`)

	return createDiracAPI(webview.controller)
}
```

### /Users/highlands/pools/Development/dirac/src/extension.ts (lines 600-666)
```
async function setupHostProvider(context: ExtensionContext, globalStorageFsPath: string) {
	const outputChannel = registerDiracOutputChannel(context)
	outputChannel.appendLine("[Dirac] Setting up VS Code host...")

	const ripgrep = await resolveWorkingRipgrepBinary(context.extensionUri.fsPath).catch((error: unknown) => {
		const resolutionError = toError(error)
		Logger.warn(`[Dirac] ${resolutionError.message}`)
		outputChannel.appendLine(`[Dirac] ${resolutionError.message}`)
		return resolutionError
	})

	if (!(ripgrep instanceof Error)) {
		outputChannel.appendLine(`[Dirac] Resolved rg from ${ripgrep.source}: ${ripgrep.path}`)
	}

	const getCachedBinaryLocation = async (name: string): Promise<string> => {
		if (!name.startsWith("rg")) {
			throw new Error(`Binary '${name}' is not supported`)
		}
		if (ripgrep instanceof Error) {
			throw ripgrep
		}
		return ripgrep.path
	}

	const createWebview = () => new VscodeDiracWebviewProvider(context)
	const createDiffView = () => new VscodeDiffViewProvider()
	const createCommentReview = () => getVscodeCommentReviewController()
	const createTerminalManager = () => new VscodeTerminalManager()
	const getEnvironmentVariables = async (cwd: string) => {
		const { getPythonEnvironmentVariables } = await import("@/hosts/vscode/python")
		return await getPythonEnvironmentVariables(vscode.Uri.file(cwd))
	}

	const getCallbackUrl = async (path: string, _preferredPort?: number) => {
		const scheme = vscode.env.uriScheme || "vscode"
		const callbackUri = vscode.Uri.parse(`${scheme}://${context.extension.id}${path}`)

		if (vscode.env.uiKind === vscode.UIKind.Web) {
			// In VS Code Web (Codespaces, code serve-web), vscode:// URIs redirect to the
			// desktop app instead of staying in the browser. Use asExternalUri to convert
			// to a web-reachable HTTPS URL that routes back to the extension's URI handler.
			const externalUri = await vscode.env.asExternalUri(callbackUri)
			return externalUri.toString(true)
		}

		// In regular desktop VS Code, use the vscode:// URI protocol handler directly.
		return callbackUri.toString(true)
	}
	HostProvider.initialize(
		"extension",
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		vscodeHostBridgeClient,
		(msg: string) => outputChannel.appendLine(msg),
		getCallbackUrl,
		getCachedBinaryLocation,
		context.extensionUri.fsPath,
		globalStorageFsPath,

		getEnvironmentVariables,
		() => vscode.workspace.isTrusted,
		vscodeHostCapabilities,
	)
}
```

### /Users/highlands/pools/Development/dirac/src/extension.ts (lines 694-700)
```
export async function deactivate() {
	// Dispose Non-VSCode-specific services
	await tearDown()

	// VSCode-specific services
	disposeVscodeCommentReviewController()
}
```

### /Users/highlands/pools/Development/dirac/src/common.ts (lines 49-63)
```
export async function initialize(storageContext: StorageContext): Promise<DiracWebviewProvider> {
	await disposePersistentLogging()
	try {
		unsubscribeHostLogger = Logger.subscribe((msg: string) => HostProvider.get().logToChannel(msg))
		persistentFileLogger = createRotatingFileLogger({
			logDir: resolveLogDirectory(storageContext.dataDir),
			fileName: "dirac-ext.log",
		})
		unsubscribeFileLogger = Logger.subscribe(persistentFileLogger.write)
		return await initializeServices(storageContext)
	} catch (error) {
		await disposePersistentLogging()
		throw error
	}
}
```

### /Users/highlands/pools/Development/dirac/src/common.ts (lines 65-133)
```
async function initializeServices(storageContext: StorageContext): Promise<DiracWebviewProvider> {
	// Initialize DiracEndpoint configuration (reads bundled and ~/.dirac/endpoints.json if present)
	// This must be done before any other code that calls DiracEnv.config()
	// Throws DiracConfigurationError if config file exists but is invalid
	const { DiracEndpoint } = await import("./config")
	await DiracEndpoint.initialize(HostProvider.get().extensionFsPath)

	try {
		await StateManager.initialize(storageContext)
	} catch (error) {
		Logger.error("[Dirac] CRITICAL: Failed to initialize StateManager:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to initialize storage. Please check logs for details or try restarting the client.",
		})
	}

	// =============== External services ===============
	await ErrorService.initialize()
	// Legacy telemetry removed

	const stateManager = StateManager.get()
	// Record an exact-version upgrade before constructing a webview/controller that can publish state.
	await recordVersionUpgrade(stateManager)

	// =============== Webview services ===============
	const webview = HostProvider.get().createDiracWebviewProvider()
	void webview.controller
		.waitForGoalStartupReconciliation()
		.then(() => repairMissingTaskHistory(stateManager))
		.then(async (result) => {
			if (result.recovered > 0) await stateManager.onSyncExternalChange?.()
		})
		.catch((error) => {
			Logger.error("[Task History Repair] Background repair failed:", error)
		})
	// Check if this workspace was opened from worktree quick launch
	await checkWorktreeAutoOpen(stateManager)

	// =============== Background sync and cleanup tasks ===============
	// Use remote config blobStoreConfig if available, otherwise fall back to env vars
	const blobStoreSettings = getBlobStoreSettingsFromEnv()
	syncWorker().init({ ...blobStoreSettings, userDistinctId: getDistinctId() })
	// Clean up old temp files in background (non-blocking) and start periodic cleanup every 24 hours
	DiracTempManager.startPeriodicCleanup()
	// Clean up orphaned file context warnings (startup cleanup)
	FileContextTracker.cleanupOrphanedWarnings(stateManager)

	telemetryService.captureExtensionActivated()

	// =============== Symbol Index Service ===============
	// Initialize symbol index for the project in background with a delay to avoid blocking startup
	const INITIALIZATION_DELAY_MS = 5000
	setTimeout(() => {
		HostProvider.workspace.getWorkspacePaths({}).then((response) => {
			const paths = response.paths
			if (paths && paths.length > 0) {
				const projectRoot = paths[0]
				SymbolIndexService.getInstance()
					.initialize(projectRoot)
					.catch((error) => {
						Logger.error("[Dirac] Failed to initialize SymbolIndexService:", error)
					})
			}
		})
	}, INITIALIZATION_DELAY_MS)

	return webview
}
```


## Source Files:

- `src/common.ts`
- `src/config.ts`
- `src/extension.ts`
- `src/registry.ts`
- `src/shared/services/config/otel-config.ts`

