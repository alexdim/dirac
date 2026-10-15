---
component_id: 4
component_name: Host Platform & VS Code Extension Bridge
---

# Host Platform & VS Code Extension Bridge

## Component Description

Abstracts host environment capabilities and implements VS Code extension activation, hostbridge gRPC services, diff views, terminals, and goal loops.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/host-provider.ts (lines 20-169)
```
export class HostProvider {
	private static instance: HostProvider | null = null

	diracType: "cli" | "extension"
	createDiracWebviewProvider: DiracWebviewProviderCreator
	createDiffViewProvider: DiffViewProviderCreator
	createCommentReviewController: CommentReviewControllerCreator
	createTerminalManager: TerminalManagerCreator
	hostBridge: HostBridgeClientProvider

	// Logs to a user-visible output channel.
	logToChannel: LogToChannel

	// Returns a callback URL that will redirect to Dirac.
	// The path parameter specifies the route for the callback (e.g., "/auth", "/openrouter").
	// The optional preferredPort parameter hints that the provider should try to bind
	// this specific port first (used to preserve OAuth client registrations across sessions).
	getCallbackUrl: (path: string, preferredPort?: number) => Promise<string>

	// Returns the location of the binary `name`.
	// Use `getBinaryLocation()` from utils/ts.ts instead of using
	// this directly. The helper function correctly handles the file
	// extension on Windows.
	getBinaryLocation: (name: string) => Promise<string>

	// The absolute file system path where the extension is installed.
	// Use to this to get the location of extension assets.
	extensionFsPath: string
	getEnvironmentVariables: (cwd: string) => Promise<{ [key: string]: string | undefined } | undefined>
	/** Host-level workspace restriction; never substitutes for a code-specific grant. */
	isWorkspaceTrusted: () => boolean

	// The absolute file system path where the extension can store global state.
	globalStorageFsPath: string

	// Optional host-only capabilities (walkthrough UI, vscode.lm models, terminal
	// contents capture). Empty on hosts that cannot provide them.
	readonly capabilities: HostCapabilities

	// Private constructor to enforce singleton pattern
	private constructor(
		diracType: "cli" | "extension",
		createDiracWebviewProvider: DiracWebviewProviderCreator,
		createDiffViewProvider: DiffViewProviderCreator,
		createCommentReviewController: CommentReviewControllerCreator,
		createTerminalManager: TerminalManagerCreator,
		hostBridge: HostBridgeClientProvider,
		logToChannel: LogToChannel,
		getCallbackUrl: (path: string, preferredPort?: number) => Promise<string>,
		getBinaryLocation: (name: string) => Promise<string>,
		extensionFsPath: string,
		globalStorageFsPath: string,
		getEnvironmentVariables: GetEnvironmentVariables,
		isWorkspaceTrusted: () => boolean = () => true,
		capabilities: HostCapabilities = {},
	) {
		this.diracType = diracType
		this.createDiracWebviewProvider = createDiracWebviewProvider
		this.createDiffViewProvider = createDiffViewProvider
		this.createCommentReviewController = createCommentReviewController
		this.createTerminalManager = createTerminalManager
		this.hostBridge = hostBridge
		this.logToChannel = logToChannel
		this.getCallbackUrl = getCallbackUrl
		this.getBinaryLocation = getBinaryLocation
		this.extensionFsPath = extensionFsPath
		this.globalStorageFsPath = globalStorageFsPath
		this.getEnvironmentVariables = getEnvironmentVariables
		this.isWorkspaceTrusted = isWorkspaceTrusted
		this.capabilities = capabilities
		setHostCapabilities(capabilities)
	}

	public static initialize(
		diracType: "cli" | "extension",
		webviewProviderCreator: DiracWebviewProviderCreator,
		diffViewProviderCreator: DiffViewProviderCreator,
		commentReviewControllerCreator: CommentReviewControllerCreator,
		terminalManagerCreator: TerminalManagerCreator,
		hostBridgeProvider: HostBridgeClientProvider,
		logToChannel: LogToChannel,
		getCallbackUrl: (path: string, preferredPort?: number) => Promise<string>,
		getBinaryLocation: (name: string) => Promise<string>,
		extensionFsPath: string,
		globalStorageFsPath: string,
		getEnvironmentVariables: GetEnvironmentVariables,
		isWorkspaceTrusted: () => boolean = () => true,
		capabilities: HostCapabilities = {},
	): HostProvider {
		if (HostProvider.instance) {
			throw new Error("Host provider has already been initialized.")
		}
		HostProvider.instance = new HostProvider(
			diracType,
			webviewProviderCreator,
			diffViewProviderCreator,
			commentReviewControllerCreator,
			terminalManagerCreator,
			hostBridgeProvider,
			logToChannel,
			getCallbackUrl,
			getBinaryLocation,
			extensionFsPath,
			globalStorageFsPath,
			getEnvironmentVariables,
			isWorkspaceTrusted,
			capabilities,
		)
		return HostProvider.instance
	}

	/**
	 * Gets the singleton instance
	 */
	public static get(): HostProvider {
		if (!HostProvider.instance) {
			throw new Error("HostProvider not setup. Call HostProvider.initialize() first.")
		}
		return HostProvider.instance
	}

	public static isInitialized(): boolean {
		return !!HostProvider.instance
	}

	/**
	 * Resets the HostProvider instance (primarily for testing)
	 * This allows tests to reinitialize the HostProvider with different configurations
	 */
	public static reset(): void {
		HostProvider.instance = null
		setHostCapabilities(undefined)
	}

	public static get workspace() {
		return HostProvider.get().hostBridge.workspaceClient
	}

	public static get env() {
		return HostProvider.get().hostBridge.envClient
	}

	public static get window() {
		return HostProvider.get().hostBridge.windowClient
	}

	public static get diff() {
		return HostProvider.get().hostBridge.diffClient
	}
}
```

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

### /Users/highlands/pools/Development/dirac/src/core/goal/GoalLoop.ts (lines 58-663)
```
export class GoalLoop {
	private readonly lifecycleMutex = new Mutex()
	private readonly interactionMutex = new Mutex()
	private runtime?: LiveGoalRuntime
	private requestedEnd?: { status: RequestedEnd; reason?: string }
	private followUpEndReason?: string
	private coordinatorInteractionCount = 0

	constructor(private readonly dependencies: GoalLoopDependencies) { }

	get goalId(): string {
		return this.dependencies.goalId
	}

	get coordinator(): Task | undefined {
		return this.runtime?.coordinator
	}

	get isActive(): boolean {
		return this.runtime?.kind === "goal"
	}

	get hasRunningCoordinator(): boolean {
		return this.runtime !== undefined
	}

	get isFollowUpActive(): boolean {
		return this.runtime?.kind === "followup"
	}

	async start(): Promise<void> {
		await this.activate(false)
	}

	async resume(): Promise<void> {
		await this.activate(true)
	}

	async sendMessage(message: string): Promise<void> {
		const text = message.trim()
		if (!text) throw new Error("A Goal message cannot be empty")

		let running: LiveGoalRuntime | undefined
		await this.lifecycleMutex.withLock(async () => {
			if (this.runtime) {
				running = this.runtime
				return
			}
			const record = await this.dependencies.store.read(this.goalId)
			if (isActiveGoalStatus(record.status)) {
				throw new Error(`Goal ${this.goalId} is ${record.status} without a running coordinator`)
			}
			this.requestedEnd = undefined
			this.followUpEndReason = undefined
			const runtime = await this.constructRuntime(record, "followup", false, text)
			this.runtime = runtime
			runtime.settlement = this.settleCoordinatorRun(runtime)
		})

		if (running) {
			await this.enqueueMessage(running, text)
			return
		}
		await this.dependencies.postState()
	}

	async steer(message: string): Promise<void> {
		const text = message.trim()
		if (!text) throw new Error("Goal steering cannot be empty")
		const record = await this.dependencies.store.read(this.goalId)
		if (!isActiveGoalStatus(record.status) || this.runtime?.kind !== "goal") {
			throw new Error(`Goal ${this.goalId} is ${record.status} and cannot accept steering`)
		}
		await this.enqueueMessage(this.runtime, text)
	}

	async cancelCurrentExecution(reason = "Cancelled by user"): Promise<void> {
		if (this.runtime?.kind === "goal") {
			await this.pause(reason)
			return
		}
		await this.cancelFollowUp(reason)
	}

	async pause(reason = "Paused by user"): Promise<GoalRecord> {
		return this.endActiveRun("paused", "interrupted", reason)
	}

	async stop(reason = "Stopped by user"): Promise<GoalRecord> {
		const current = await this.dependencies.store.read(this.goalId)
		if (current.status === "stopped" || current.status === "achieved") return current
		if (!isActiveGoalStatus(current.status)) {
			const stopped = await this.dependencies.store.transition(this.goalId, { status: "stopped", statusReason: reason })
			await this.syncHistory(stopped)
			await this.dependencies.postState()
			return stopped
		}
		return this.endActiveRun("stopped", "cancelled", reason)
	}

	async inspect(): Promise<GoalViewState> {
		return goalViewState(await this.dependencies.store.read(this.goalId), this.isFollowUpActive)
	}

	async publishHistory(): Promise<void> {
		await this.syncHistory(await this.dependencies.store.read(this.goalId))
	}

	private async activate(resume: boolean): Promise<void> {
		try {
			await this.lifecycleMutex.withLock(() => this.activateSerial(resume))
		} catch (error) {
			try {
				await this.dependencies.postState()
			} catch (publicationError) {
				throw new AggregateError([error, publicationError], `Goal ${this.goalId} activation failed`)
			}
			throw error
		}
		await this.dependencies.postState()
	}

	private async activateSerial(resume: boolean): Promise<void> {
		if (this.runtime) throw new Error(`Goal ${this.goalId} already has a running coordinator`)
		const current = await this.dependencies.store.read(this.goalId)
		if (resume && !isResumableGoalStatus(current.status)) {
			throw new Error(`Goal ${this.goalId} cannot resume from ${current.status}`)
		}
		if (!resume && (current.status !== "paused" || current.statusReason !== "Created")) {
			throw new Error(`Goal ${this.goalId} has already been started`)
		}

		this.requestedEnd = undefined
		this.followUpEndReason = undefined
		const working = await this.dependencies.store.transition(this.goalId, {
			status: "working",
			statusReason: resume ? "Resumed by user" : "Started",
		})
		await this.syncHistory(working)

		try {
			const runtime = await this.constructRuntime(working, "goal", resume)
			this.runtime = runtime
			runtime.settlement = this.settleCoordinatorRun(runtime)
		} catch (error) {
			const blocked = await this.dependencies.store.transition(this.goalId, {
				status: "blocked",
				statusReason: errorMessage(error),
			})
			await this.syncHistory(blocked)
			throw error
		}
	}

	private async constructRuntime(
		record: GoalRecord,
		kind: GoalRuntimeKind,
		resume: boolean,
		followUpMessage?: string,
	): Promise<LiveGoalRuntime> {
		const taskFactory = this.dependencies.createTaskFactory()
		const coordinatorAuxiliarySourceId = `goal/aux:${ulid()}`
		let host!: GoalTaskHost
		host = new GoalTaskHost(this.goalId, this.dependencies.store, async (input) =>
			taskFactory.create({
				id: input.id,
				conversationUlid: input.conversationUlid,
				prompt: input.prompt,
				executionProfile: "goal_child",
				childRole: input.role,
				environmentFactory: input.environmentFactory,
				onHistorySnapshot: (_item, task) =>
					this.recordAccounting(
						input.role === "verification" ? `goal/verification:${input.id}` : `goal/child:${input.id}`,
						input.role === "verification"
							? `goal/verification:${input.id}/aux`
							: `goal/child:${input.id}/aux`,
						task,
					),
			}),
		)
		await host.recoverUnreadResponses()
		const environmentFactory = new GoalCoordinatorToolEnvironmentFactory(
			(surface) => this.goalTrait(host, surface),
			{
				duringUserInteraction: (operation) => this.duringCoordinatorInteraction(operation),
			},
		)
		const coordinator = await taskFactory.create({
			id: this.goalId,
			conversationUlid: record.conversationUlid,
			...(resume || kind === "followup"
				? { historyItem: this.requireHistoryItem() }
				: { prompt: this.dependencies.initialDisplayText }),
			executionProfile: kind === "followup" ? "goal_followup" : "goal_coordinator",
			environmentFactory,
			conversationPersistenceHooks: {
				onUserContentPersisted: () => host.acknowledgePersistedWake(),
				onUserContentPersistenceFailed: () => host.rollbackUnpersistedWake(),
			},
			getPinnedContext: () => this.pinnedContext(),
			onHistorySnapshot: (_item, task) => this.recordAccounting("goal", coordinatorAuxiliarySourceId, task),
		})

		let run: Promise<TaskRunOutcome>
		if (kind === "followup") {
			if (!followUpMessage) throw new Error(`Goal ${this.goalId} follow-up is missing user input`)
			run = coordinator.resumeTaskFromHistory(undefined, {
				systemContext: goalFollowUpWake(record),
				initialUserInput: { text: followUpMessage },
			})
		} else if (resume) {
			run = coordinator.resumeTaskFromHistory(undefined, { systemContext: goalResumeWake(record) })
		} else {
			run = coordinator.startTask(this.dependencies.initialDisplayText)
		}

		return { kind, coordinator, host, run }
	}

	private async settleCoordinatorRun(runtime: LiveGoalRuntime): Promise<void> {
		const outcome = await runtime.run
		if (runtime.kind === "followup") {
			await this.settleFollowUpRun(runtime, outcome)
			return
		}
		await this.lifecycleMutex.withLock(async () => {
			if (this.runtime !== runtime) return
			const requested = this.requestedEnd
			let transition =
				requested && outcome.kind !== "failed" ? requested : transitionForOutcome(outcome)
			try {
				await runtime.host.shutdown(
					transition.status === "stopped" ? "cancelled" : "interrupted",
					transition.reason ?? `Goal became ${transition.status}`,
				)
			} catch (error) {
				transition = { status: "blocked", reason: `Owned activity failed to stop: ${errorMessage(error)}` }
			}
			const record = await this.dependencies.store.transition(this.goalId, {
				status: transition.status,
				statusReason: transition.reason,
			})
			this.runtime = undefined
			this.requestedEnd = undefined
			await this.syncHistory(record)
		})
		await this.dependencies.postState()
	}

	private async settleFollowUpRun(runtime: LiveGoalRuntime, outcome: TaskRunOutcome): Promise<void> {
		const reason = this.followUpEndReason ?? followUpOutcomeReason(outcome)
		const childEnd = outcome.kind === "cancelled" ? "cancelled" : "interrupted"
		let shutdownError: unknown
		try {
			await runtime.host.shutdown(childEnd, reason)
		} catch (error) {
			shutdownError = error
		}

		await this.lifecycleMutex.withLock(async () => {
			if (this.runtime !== runtime) return
			this.runtime = undefined
			this.followUpEndReason = undefined
			await this.syncHistory(await this.dependencies.store.read(this.goalId))
		})
		await this.dependencies.postState()
		if (shutdownError) throw shutdownError
	}

	private async enqueueMessage(runtime: LiveGoalRuntime, text: string): Promise<void> {
		if (this.runtime !== runtime) throw new Error(`Goal ${this.goalId} coordinator changed before message delivery`)
		await runtime.coordinator.enqueueSteeringMessage(text)
		await runtime.host.recordUserSteering()
		await this.dependencies.postState()
	}

	private async cancelFollowUp(reason: string): Promise<void> {
		let runtime: LiveGoalRuntime | undefined
		await this.lifecycleMutex.withLock(async () => {
			if (this.runtime?.kind === "followup") {
				runtime = this.runtime
				this.followUpEndReason = reason
			}
		})
		if (!runtime) return

		const controls = await Promise.allSettled([
			runtime.coordinator.abortTask({ kind: "cancelled", reason }),
			runtime.host.shutdown("cancelled", reason),
		])
		await runtime.settlement
		const failures = controls
			.filter((result): result is PromiseRejectedResult => result.status === "rejected")
			.map((result) => result.reason)
		if (failures.length === 1) throw failures[0]
		if (failures.length > 1) throw new AggregateError(failures, `Goal ${this.goalId} follow-up cancellation failed`)
	}

	private async endActiveRun(
		status: Extract<RequestedEnd, "paused" | "stopped">,
		kind: "cancelled" | "interrupted",
		reason: string,
	): Promise<GoalRecord> {
		let runtime: LiveGoalRuntime | undefined
		await this.lifecycleMutex.withLock(async () => {
			const current = await this.dependencies.store.read(this.goalId)
			if (current.status === status) return
			if (!isActiveGoalStatus(current.status) || !this.runtime) {
				return
			}
			this.requestedEnd ??= { status, reason }
			runtime = this.runtime
		})
		if (!runtime) return this.dependencies.store.read(this.goalId)
		const controls = await Promise.allSettled([
			runtime.coordinator.abortTask({ kind, reason }),
			runtime.host.shutdown(kind, reason),
		])
		await runtime.settlement
		const failures = controls
			.filter((result): result is PromiseRejectedResult => result.status === "rejected")
			.map((result) => result.reason)
		if (failures.length === 1) throw failures[0]
		if (failures.length > 1) throw new AggregateError(failures, `Goal ${status} failed`)
		return this.dependencies.store.read(this.goalId)
	}

	private goalTrait(host: GoalTaskHost, surface: SurfaceAdapter): IGoalTrait {
		return {
			startTask: (input) => host.startTask(input),
			listTasks: (input) => host.listTasks(input),
			sendTaskMessage: (input) => host.sendTaskMessage(input.taskId, input.message),
			cancelTask: (input) => host.cancelTask(input.taskId, input.reason),
			readTaskTranscript: (input) => host.readTaskTranscript(input.taskId, input.cursor, input.limit),
			resolveTaskInteraction: (input) => this.resolveInteraction(host, surface, input),
			waitForEvents: () => host.waitForEvents(),
			startVerification: (input) => host.startVerification(input),
			replaceObjective: (markdown) => this.replaceObjective(markdown),
			blockGoal: (reason) => this.blockGoal(host, surface, reason),
			commitCompletion: (result) => this.commitCompletion(host, surface, result),
		}
	}

	private async resolveInteraction(
		host: GoalTaskHost,
		surface: SurfaceAdapter,
		input: Parameters<IGoalTrait["resolveTaskInteraction"]>[0],
	): ReturnType<IGoalTrait["resolveTaskInteraction"]> {
		if (input.resolution !== "passthrough") {
			return host.resolveTaskInteraction({
				taskId: input.taskId,
				interactionId: input.interactionId,
				resolution: input.resolution,
				answer: input.answer,
			})
		}
		const goal = await this.dependencies.store.read(this.goalId)
		const child = goal.children.find((candidate) => candidate.id === input.taskId)
		if (!child?.pendingInteraction || child.pendingInteraction.id !== input.interactionId) {
			throw new Error(`Interaction ${input.interactionId} is stale for contained Task ${input.taskId}`)
		}
		return this.duringCoordinatorInteraction(async () => {
			const currentGoal = await this.dependencies.store.read(this.goalId)
			const currentChild = currentGoal.children.find((candidate) => candidate.id === input.taskId)
			if (!currentChild?.pendingInteraction || currentChild.pendingInteraction.id !== input.interactionId) {
				throw new Error(`Interaction ${input.interactionId} is stale for contained Task ${input.taskId}`)
			}
			const source = currentChild.pendingInteraction.card
			const taskDetails =
				source.renderType === "markdown"
					? [
						`**Task:** ${currentChild.title}`,
						`**Task ID:** \`${currentChild.id}\``,
						`**Interaction ID:** \`${currentChild.pendingInteraction.id}\``,
					].join("\n")
					: [
						`Task: ${currentChild.title}`,
						`Task ID: ${currentChild.id}`,
						`Interaction ID: ${currentChild.pendingInteraction.id}`,
					].join("\n")
			const card = await surface.ui.createManualInteractionCard({
				kind: source.kind,
				header: `${source.header || "Task interaction"} · ${currentChild.title}`,
				toolName: "resolve_task_interaction",
				icon: source.icon,
				renderType: source.renderType,
				body:
					source.renderType === "diff"
						? source.body
						: `${taskDetails}${source.body ? `\n\n${source.body}` : ""}`,
				rawInput: {
					...(source.rawInput ?? {}),
					taskId: currentChild.id,
					interactionId: currentChild.pendingInteraction.id,
				},
				rawOutput: source.rawOutput,
				diffs: source.diffs,
				locations: source.locations,
				requireApproval: source.requireApproval,
				requireFeedback: source.requireFeedback,
				feedbackPlaceholder: source.feedbackPlaceholder,
				actions: source.actions,
				autoScroll: source.autoScroll,
				collapsed: source.collapsed,
				maxHeight: source.maxHeight,
				cleanupStrategy: source.cleanupStrategy,
				do_not_auto_collapse: source.do_not_auto_collapse,
				outcome: source.outcome,
			})
			let result: GoalChildInteractionResult
			try {
				result = (await card.waitForInteraction()) as GoalChildInteractionResult
			} catch (error) {
				try {
					await card.finalize(CardStatus.CANCELLED)
				} catch (finalizationError) {
					throw new AggregateError([error, finalizationError], "Goal passthrough interaction failed")
				}
				throw error
			}

			let resolution: Awaited<ReturnType<IGoalTrait["resolveTaskInteraction"]>>
			try {
				resolution = await host.resolveTaskInteraction({
					taskId: input.taskId,
					interactionId: input.interactionId,
					resolution: "passthrough",
					passthroughResult: result,
				})
			} catch (error) {
				try {
					await card.finalize(CardStatus.CANCELLED)
				} catch (finalizationError) {
					throw new AggregateError([error, finalizationError], "Goal passthrough relay failed")
				}
				throw error
			}
			await finalizeResolvedInteractionCard(card, resolution.task.title, result)
			return resolution
		})
	}

	private async replaceObjective(markdown: string) {
		const objective = markdown.trim()
		if (!objective) throw new Error("A Goal objective cannot be empty")
		const record = await this.dependencies.store.update(this.goalId, (goal, now) => {
			if (goal.status === "achieved") {
				throw new Error(`Goal ${this.goalId} is achieved; its completed objective cannot be revised`)
			}
			goal.objective = {
				markdown: objective,
				revision: goal.objective.revision + 1,
				updatedAt: now,
			}
		})
		await this.syncHistory(record)
		await this.dependencies.postState()
		return record.objective
	}

	private async blockGoal(host: GoalTaskHost, surface: SurfaceAdapter, reason: string): Promise<void> {
		const detail = reason.trim()
		if (!detail) throw new Error("A blocked Goal requires a non-empty reason")
		await host.guardTerminalTransition()
		await this.lifecycleMutex.withLock(async () => {
			if (this.runtime?.kind === "followup") this.followUpEndReason ??= detail
			else this.requestedEnd ??= { status: "blocked", reason: detail }
		})
		surface.orchestration.setTaskState("abort", true)
	}

	private async commitCompletion(
		host: GoalTaskHost,
		surface: SurfaceAdapter,
		result: string,
	): Promise<CompletionCommitResult> {
		let completion: CompletionCommitResult
		try {
			completion = await host.commitTerminalAttempt(() => surface.orchestration.commitAttemptCompletion(result))
		} catch (error) {
			if (error instanceof GoalTerminalGuardError) return { committed: false, error: error.message }
			throw error
		}
		if (completion.committed) {
			await this.lifecycleMutex.withLock(async () => {
				if (this.runtime?.kind === "goal") this.requestedEnd ??= { status: "achieved" }
			})
		}
		return completion
	}

	private async duringCoordinatorInteraction<T>(operation: () => Promise<T>): Promise<T> {
		await this.acquireCoordinatorInteraction()
		let result: T | undefined
		let operationError: unknown
		try {
			result = await operation()
		} catch (error) {
			operationError = error
		}

		let releaseError: unknown
		try {
			await this.releaseCoordinatorInteraction()
		} catch (error) {
			releaseError = error
		}
		if (operationError && releaseError) {
			throw new AggregateError([operationError, releaseError], "Goal user interaction and status restoration failed")
		}
		if (operationError) throw operationError
		if (releaseError) throw releaseError
		return result as T
	}

	private async acquireCoordinatorInteraction(): Promise<void> {
		await this.interactionMutex.withLock(async () => {
			if (this.coordinatorInteractionCount > 0 || this.requestedEnd || this.followUpEndReason) {
				this.coordinatorInteractionCount += 1
				return
			}

			let transitioned = false
			try {
				const current = await this.dependencies.store.read(this.goalId)
				if (current.status === "working") {
					await this.dependencies.store.transition(this.goalId, {
						status: "waiting",
						statusReason: "Waiting for user interaction",
					})
					transitioned = true
					await this.dependencies.postState()
				}
				this.coordinatorInteractionCount = 1
			} catch (error) {
				if (!transitioned || this.requestedEnd || this.followUpEndReason) throw error
				try {
					await this.dependencies.store.transition(this.goalId, { status: "working" })
					await this.dependencies.postState()
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], "Goal interaction acquisition rollback failed")
				}
				throw error
			}
		})
	}

	private async releaseCoordinatorInteraction(): Promise<void> {
		await this.interactionMutex.withLock(async () => {
			if (this.coordinatorInteractionCount === 0) throw new Error("Goal interaction ownership is unbalanced")
			this.coordinatorInteractionCount -= 1
			if (this.coordinatorInteractionCount !== 0 || this.requestedEnd || this.followUpEndReason) return
			const current = await this.dependencies.store.read(this.goalId)
			if (current.status !== "waiting") return
			await this.dependencies.store.transition(this.goalId, { status: "working" })
			await this.dependencies.postState()
		})
	}

	private async pinnedContext(): Promise<string> {
		const record = await this.dependencies.store.read(this.goalId)
		const active = record.children.filter((child) => child.status === "starting" || child.status === "running" || child.status === "waiting")
		return [
			`<goal_lifecycle status="${record.status}" coordinator="${this.runtime?.kind ?? "idle"}">`,
			`Follow-up conversation turns do not change this lifecycle status.`,
			"</goal_lifecycle>",
			"",
			`<goal_objective revision="${record.objective.revision}">`,
			record.objective.markdown,
			"</goal_objective>",
			"",
			"<goal_active_tasks>",
			...(active.length
				? active.map((child) =>
					`- ${child.id} | ${child.title} | ${child.role} | ${child.status}${child.pendingInteraction ? ` | interaction ${child.pendingInteraction.id}` : ""}`,
				)
				: ["- none"]),
			"</goal_active_tasks>",
		].join("\n")
	}

	private requireHistoryItem(): GoalHistoryItem {
		const item = this.dependencies.stateManager
			.getGlobalStateKey("taskHistory")
			.find((candidate) => candidate.id === this.goalId)
		if (!item || !isGoalHistoryItem(item)) throw new Error(`Goal ${this.goalId} is missing its top-level history entry`)
		return item
	}

	private async recordAccounting(apiSourceId: string, auxiliarySourceId: string, task: Task): Promise<void> {
		const apiSnapshot = apiAccountingSnapshot(task)
		const auxiliarySnapshot = auxiliaryAccountingSnapshot(task)
		const record = await this.dependencies.store.update(this.goalId, (goal) => {
			if (apiSnapshot) replaceGoalAccountingSource(goal, apiSourceId, apiSnapshot)
			if (auxiliarySnapshot) replaceGoalAccountingSource(goal, auxiliarySourceId, auxiliarySnapshot)
		})
		await this.syncHistory(record)
	}

	private async syncHistory(record: GoalRecord): Promise<void> {
		await this.dependencies.updateHistory(
			createGoalHistoryItem(record, this.dependencies.initialDisplayText, this.dependencies.workspaceRootPath),
		)
	}
}
```


## Source Files:

- `src/common.ts`
- `src/config.ts`
- `src/core/api/providers/gemini-image-resolver.ts`
- `src/core/goal/GoalLoop.ts`
- `src/core/goal/GoalTaskHost.ts`
- `src/core/task/types/task-host.ts`
- `src/extension.ts`
- `src/hosts/external/AuthHandler.ts`
- `src/hosts/external/ExternalCommentReviewController.ts`
- `src/hosts/external/ExternalDiffviewProvider.ts`
- `src/hosts/external/ExternalWebviewProvider.ts`
- `src/hosts/external/grpc-types.ts`
- `src/hosts/external/host-bridge-client-manager.ts`
- `src/hosts/host-capabilities.ts`
- `src/hosts/host-provider-types.ts`
- `src/hosts/host-provider.ts`
- `src/hosts/vscode/DecorationController.ts`
- `src/hosts/vscode/DecorationControllerManager.ts`
- `src/hosts/vscode/DocumentOperationManager.ts`
- `src/hosts/vscode/NotebookDiffManager.ts`
- `src/hosts/vscode/NotebookDiffView.ts`
- `src/hosts/vscode/ReviewContextManager.ts`
- `src/hosts/vscode/StreamingTextUpdater.ts`
- `src/hosts/vscode/TabManager.ts`
- `src/hosts/vscode/VscodeDiffViewProvider.ts`
- `src/hosts/vscode/VscodeWebviewProvider.ts`
- `src/hosts/vscode/commandUtils.ts`
- `src/hosts/vscode/commit-message-generator.ts`
- `src/hosts/vscode/host-capabilities.ts`
- `src/hosts/vscode/hostbridge-grpc-handler.ts`
- `src/hosts/vscode/hostbridge-grpc-service.ts`
- `src/hosts/vscode/hostbridge/client/host-grpc-client-base.ts`
- `src/hosts/vscode/hostbridge/diff/closeAllDiffs.ts`
- `src/hosts/vscode/hostbridge/diff/getDocumentText.ts`
- `src/hosts/vscode/hostbridge/diff/openDiff.ts`
- `src/hosts/vscode/hostbridge/diff/openMultiFileDiff.ts`
- `src/hosts/vscode/hostbridge/diff/replaceText.ts`
- `src/hosts/vscode/hostbridge/diff/saveDocument.ts`
- `src/hosts/vscode/hostbridge/diff/scrollDiff.ts`
- `src/hosts/vscode/hostbridge/diff/truncateDocument.ts`
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
- `src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts`
- `src/hosts/vscode/hostbridge/workspace/openDiracSidebarPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openFolder.ts`
- `src/hosts/vscode/hostbridge/workspace/openInFileExplorerPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openProblemsPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openTerminalPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/prepareDiagnostics.ts`
- `src/hosts/vscode/iconUtils.ts`
- `src/hosts/vscode/python.ts`
- `src/hosts/vscode/review/VscodeCommentReplyHandler.ts`
- `src/hosts/vscode/review/VscodeCommentReviewController.ts`
- `src/hosts/vscode/review/VscodeCommentThreadManager.ts`
- `src/hosts/vscode/review/VscodeStreamingCommentHandler.ts`
- `src/hosts/vscode/terminal/VscodeCommandExecutor.ts`
- `src/hosts/vscode/terminal/VscodeShellIntegrationManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalLifecycleManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalProcess.ts`
- `src/hosts/vscode/terminal/VscodeTerminalProfileManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalRegistry.ts`
- `src/hosts/vscode/terminal/ansiUtils.ts`
- `src/hosts/vscode/terminal/get-latest-output.ts`
- `src/hosts/vscode/vscode-lm-format.ts`
- `src/hosts/vscode/vscode-lm.ts`
- `src/hosts/vscode/vscode-to-file-migration.ts`
- `src/registry.ts`
- `src/shared/services/config/otel-config.ts`

