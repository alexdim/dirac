---
component_id: 5
component_name: Application Controller, Browser & Standalone Services
---

# Application Controller, Browser & Standalone Services

## Component Description

Coordinates top-level controller state, webview lifecycle, browser automation, ignore rules, feature flags, telemetry orchestration, and standalone runtime setup.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/index.ts (lines 55-524)
```
export class Controller implements ITaskHost {
	public discoveredSkillsCache?: SkillMetadata[]
	readonly stateManager: StateManager
	private availableToolsFingerprint?: string

	// NEW: Add workspace manager (optional initially)
	private workspaceManager?: WorkspaceRootManager

	private authController!: AuthController
	private stateController!: StateController
	private workspaceController!: WorkspaceController
	private taskController!: TaskController
	private taskHistoryController!: import("./TaskHistoryController").TaskHistoryController
	private initializerConfig!: InitializerConfig
	private readonly goalController: GoalController
	private goalRoutingEnabled: boolean
	private taskInitializationDefaults?: TaskInitializationOptions

	get task(): Task | undefined {
		return this.goalController?.coordinator ?? this.taskController?.task
	}

	set task(value: Task | undefined) {
		this.taskController.task = value
	}

	// Promise for the in-flight task run; created inside TaskController.initTask (from main).
	get taskRunPromise(): Promise<void> | undefined {
		return this.taskController?.taskRunPromise
	}

	onTaskReplaced(listener: (taskId: string) => void | Promise<void>): () => void {
		return this.taskController.onTaskReplaced(listener)
	}

	private lastPublishedPresentation?: {
		surfaceId?: string
		source?: object
		generation?: number
	}
	private readonly statePublicationQueue = new StatePublicationQueue<OutboundStatePublication, StatePublicationRequest>(
		(request) => this.getStatePublication(request),
		async (publication, sequenceNumber) => {
			await sendStateUpdate(publication.state, sequenceNumber, publication.presentation)
			publication.acknowledge()
		},
		(pending, requested) => (pending === "control" || requested === "control" ? "control" : "presentation"),
	)

	private openAiCodexUsageUnsubscribe?: () => void

	// Public getter for workspace manager with lazy initialization - To get workspaces when task isn't initialized (Used by file mentions)
	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		const manager = await this.workspaceController.ensureWorkspaceManager()
		if (manager && !this.workspaceManager) {
			this.workspaceManager = manager
		}
		return this.workspaceManager
	}

	// Synchronous getter for workspace manager
	getWorkspaceManager(): WorkspaceRootManager | undefined {
		const tm = this.taskController.workspaceManager
		if (tm) {
			this.workspaceManager = tm
		}
		return this.workspaceManager || this.taskController.workspaceManager
	}

	constructor(
		readonly context: DiracExtensionContext,
		options: ControllerOptions = {},
	) {
		const initializer = new Initializer(context)
		this.initializerConfig = initializer.createConfig(this, options.workspaceCwd)
		Object.assign(this, this.initializerConfig)
		this.stateManager = this.initializerConfig.stateManager
		this.goalRoutingEnabled = options.goalRoutingEnabled ?? HostProvider.get().diracType === "extension"
		this.goalController = new GoalController({
			controller: this,
			stateManager: this.stateManager,
			getStandaloneTask: () => this.taskController.task,
			clearStandaloneTask: () => this.taskController.clearTask(),
			updateGoalHistory: (item) => this.taskHistoryController.updateGoalHistory(item),
			postState: () => this.postStateToWebview(),
		})

		this.openAiCodexUsageUnsubscribe = openAiCodexUsageService.subscribe(() => {
			void this.postStateToWebview()
		})

		BannerService.initialize(this)

		// Clean up legacy checkpoints
		cleanupLegacyCheckpoints().catch((error) => {
			Logger.error("Failed to cleanup legacy checkpoints:", error)
		})

		// Check CLI installation status once on startup
		checkCliInstallation(this)

		// Initialize workspace manager in background
		this.ensureWorkspaceManager()
			.then(() => {
				this.postStateToWebview()
			})
			.catch((error) => {
				Logger.error("Failed to initialize workspace manager:", error)
			})
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		this.openAiCodexUsageUnsubscribe?.()
		this.openAiCodexUsageUnsubscribe = undefined
		await this.goalController.dispose()
		await this.taskController.clearTask()

		Logger.debug("Controller disposed")
	}

	// Task lifecycle delegation (via TaskController)

	setTaskInitializationDefaults(options: TaskInitializationOptions): void {
		this.taskInitializationDefaults = options
	}

	private resolveTaskInitializationOptions(options?: TaskInitializationOptions): TaskInitializationOptions | undefined {
		if (!this.taskInitializationDefaults) return options
		return { ...this.taskInitializationDefaults, ...options }
	}

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: any,
		conversationUlid?: string,
		_watcherFactory?: any,
		initializationOptions?: TaskInitializationOptions,
	): Promise<string> {
		if (!historyItem && task !== undefined) {
			const goalRequest = parseGoalRequest(task)
			if (goalRequest.matched) {
				this.assertGoalSurfaceSupported(initializationOptions)
				if (images?.length || files?.length) throw new Error("/goal currently accepts a text objective only")
				return this.goalController.start(goalRequest.objective)
			}
		}
		if (historyItem && isGoalHistoryItem(historyItem)) {
			this.assertGoalSurfaceSupported()
			await this.goalController.select(historyItem.id)
			return historyItem.id
		}
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after starting another run")
		}
		return this.taskController.initTask(
			task,
			images,
			files,
			historyItem,
			taskSettings,
			conversationUlid,
			_watcherFactory,
			this.resolveTaskInitializationOptions(initializationOptions),
		)
	}

	async reinitExistingTaskFromId(taskId: string, initializationOptions?: TaskInitializationOptions): Promise<void> {
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after loading another run")
		}
		return this.taskController.reinitExistingTaskFromId(taskId, this.resolveTaskInitializationOptions(initializationOptions))
	}

	async prepareTaskForFollowUp(initializationOptions?: TaskInitializationOptions): Promise<Task> {
		return this.taskController.prepareTaskForFollowUp(this.resolveTaskInitializationOptions(initializationOptions))
	}

	async cancelTask(): Promise<void> {
		if (this.goalController.hasRunningCoordinator) {
			await this.goalController.cancelCurrentExecution("Cancelled by user")
			return
		}
		return this.taskController.cancelTask()
	}

	updateBackgroundCommandState(running: boolean, taskId?: string): void {
		this.taskController.updateBackgroundCommandState(running, taskId)
	}

	get backgroundCommandRunning(): boolean {
		return this.taskController.backgroundCommandRunning
	}

	get backgroundCommandTaskId(): string | undefined {
		return this.taskController.backgroundCommandTaskId
	}

	async cancelBackgroundCommand(): Promise<void> {
		return this.taskController.cancelBackgroundCommand()
	}

	async clearTask(): Promise<void> {
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after leaving the Goal")
			return
		}
		await this.taskController.clearTask()
	}

	async createTask(prompt: string) {
		await sendChatButtonClickedEvent()
		await this.initTask(prompt)
	}

	// OpenRouter

	async completeOpenRouterAuth(code: string) {
		return this.authController.completeOpenRouterAuth(code)
	}

	// GitHub Copilot
	async completeGithubLogin() {
		return this.authController.completeGithubLogin()
	}

	// Requesty

	async completeRequestyAuth(code: string) {
		return this.authController.completeRequestyAuth(code)
	}

	// Read OpenRouter models from disk cache (delegates to TaskHistoryController)
	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		return this.taskHistoryController.readOpenRouterModels()
	}

	// Task history (delegates to TaskHistoryController)

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		return this.taskHistoryController.getTaskWithId(id)
	}

	async getPromptHistory(workspacePath: string, excludedRunId?: string) {
		return this.taskHistoryController.getPromptHistory(workspacePath, excludedRunId)
	}

	async exportTaskWithId(id: string) {
		return this.taskHistoryController.exportTaskWithId(id)
	}

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		const updated = await this.taskHistoryController.deleteTaskFromState(id)
		await this.postStateToWebview()
		return updated
	}

	async postStateToWebview(): Promise<void> {
		await this.statePublicationQueue.requestPublication("control")
	}

	async postPresentationToWebview(): Promise<void> {
		await this.statePublicationQueue.requestPublication("presentation")
	}

	async waitForGoalStartupReconciliation(): Promise<void> {
		await this.goalController.waitForStartupReconciliation()
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		const presentation = await this.captureSelectedPresentation()
		return this.assembleStateToPostToWebview(true, presentation)
	}

	private async captureSelectedPresentation(): Promise<SelectedPresentation> {
		while (true) {
			const selectedGoalId = this.goalController.selectedGoalId
			const surfaceId = selectedGoalId ?? this.task?.taskId
			const source = selectedGoalId ? this.goalController.coordinator?.messageStateHandler : this.task?.messageStateHandler
			const snapshot = selectedGoalId
				? await this.goalController.selectedPresentationSnapshot()
				: source
					? await source.capturePresentationSnapshot()
					: { messages: [], offset: -1, generation: 0 }
			const currentGoalId = this.goalController.selectedGoalId
			const currentSurfaceId = currentGoalId ?? this.task?.taskId
			const currentSource = currentGoalId
				? this.goalController.coordinator?.messageStateHandler
				: this.task?.messageStateHandler
			if (surfaceId === currentSurfaceId && source === currentSource) {
				return { ...snapshot, surfaceId, source }
			}
		}
	}

	private async getStatePublication(request: StatePublicationRequest): Promise<OutboundStatePublication> {
		const controlState = request === "control" ? await this.assembleStateToPostToWebview(false) : undefined
		const selectedGoalId = this.goalController.selectedGoalId
		const surfaceId = selectedGoalId ?? this.task?.taskId
		const source = selectedGoalId ? this.goalController.coordinator?.messageStateHandler : this.task?.messageStateHandler
		const generation = source?.getPresentationStateGeneration() ?? 0
		const requiresHydration =
			surfaceId !== this.lastPublishedPresentation?.surfaceId ||
			source !== this.lastPublishedPresentation?.source ||
			generation !== this.lastPublishedPresentation?.generation ||
			source?.hasPresentationPublicationGap() === true

		if (!requiresHydration) return this.createPresentationPublication(controlState)
		const presentation = await this.captureSelectedPresentation()
		const fullState = await this.assembleStateToPostToWebview(true, presentation)
		return {
			state: fullState,
			acknowledge: () => {
				this.lastPublishedPresentation = {
					surfaceId: presentation.surfaceId,
					source: presentation.source,
					generation: presentation.generation,
				}
				presentation.source?.acknowledgePresentationOperations(presentation.offset)
			},
		}
	}

	private createPresentationPublication(controlState?: ExtensionState): OutboundStatePublication {
		const selectedGoalId = this.goalController.selectedGoalId
		const task = selectedGoalId ? this.goalController.coordinator : this.task
		const surfaceId = selectedGoalId ?? task?.taskId
		const operations = task?.messageStateHandler.getPendingPresentationOperations() ?? []
		const maxConsecutiveMistakes = this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
		const state: Partial<ExtensionState> = controlState ?? {
			presentationSurfaceId: surfaceId,
			presentationOffset: task?.messageStateHandler.getPresentationOffset(),
			activeVoiceStreamId: task?.stateView.activeVoiceStreamId,
			isApiRequestActive: task?.stateView.isApiRequestActive ?? false,
			taskStatus: task?.stateView.status ?? TaskStatus.IDLE,
			uiActionState: projectUIActionState(
				task?.stateView,
				(id) => task?.messageStateHandler.getMessageById(id),
				maxConsecutiveMistakes,
			),
		}
		const presentation = operations.length > 0 && surfaceId ? { surfaceId, operations } : undefined
		const throughOffset = operations.at(-1)?.offset
		return {
			state,
			presentation,
			acknowledge: () => {
				if (throughOffset !== undefined) task?.messageStateHandler.acknowledgePresentationOperations(throughOffset)
			},
		}
	}

	private async assembleStateToPostToWebview(
		includeMessages: boolean,
		presentation?: SelectedPresentation,
	): Promise<ExtensionState> {
		const previousAvailableToolsFingerprint = this.availableToolsFingerprint

		const goal = await this.goalController.inspect()
		const state = await getUiState({
			stateManager: this.stateManager,
			task: this.task,
			workspaceManager: this.workspaceManager,
			backgroundCommandRunning: this.backgroundCommandRunning,
			backgroundCommandTaskId: this.backgroundCommandTaskId,
			goal,
			goalMessages: includeMessages ? presentation?.messages : undefined,
			presentationOffset: includeMessages ? presentation?.offset : undefined,
			presentationSurfaceId: includeMessages ? presentation?.surfaceId : undefined,
			includeMessages,
		})

		const nextAvailableToolsFingerprint = await fingerprintAvailableTools(state.availableTools)
		if (this.task && previousAvailableToolsFingerprint !== nextAvailableToolsFingerprint) {
			this.task.markToolsDirty("settings_refresh_detected_change")
		}
		this.availableToolsFingerprint = nextAvailableToolsFingerprint

		return state
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		return this.taskHistoryController.updateTaskHistory(item)
	}

	async updateGoalHistory(item: GoalHistoryItem): Promise<HistoryItem[]> {
		return this.taskHistoryController.updateGoalHistory(item)
	}

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		return this.stateController.updateTelemetrySetting(telemetrySetting)
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		if (this.goalController.selectedGoalId) throw new Error("Mode switching is disabled while a Goal is active.")
		return this.stateController.toggleActModeForYoloMode()
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		if (this.goalController.selectedGoalId) throw new Error("Mode switching is disabled while a Goal is active.")
		return this.stateController.togglePlanActMode(modeToSwitchTo, chatContent)
	}

	enableInteractiveGoals(): void {
		this.goalRoutingEnabled = true
	}

	get selectedGoalId(): string | undefined {
		return this.goalController.selectedGoalId
	}

	get hasActiveGoal(): boolean {
		return this.goalController.active
	}

	async selectGoal(goalId: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.select(goalId)
	}

	async resumeGoal(goalId: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.resume(goalId)
	}

	async pauseGoal(goalId: string, reason?: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.pause(goalId, reason)
	}

	async stopGoal(goalId: string, reason?: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.stop(goalId, reason)
	}

	async steerGoal(goalId: string, message: string): Promise<void> {
		this.assertGoalSurfaceSupported()
		return this.goalController.steer(goalId, message)
	}

	async sendGoalMessage(goalId: string, message: string): Promise<void> {
		this.assertGoalSurfaceSupported()
		if (isGoalResumeCommand(message)) {
			await this.goalController.resume(goalId)
			return
		}
		return this.goalController.sendMessage(goalId, message)
	}

	private assertGoalSurfaceSupported(initializationOptions?: TaskInitializationOptions): void {
		const effectiveOptions = this.resolveTaskInitializationOptions(initializationOptions)
		if (effectiveOptions?.toolSelectionPolicy) {
			throw new Error("Invocation tool-selection options cannot be used with Goals.")
		}
		if (!this.goalRoutingEnabled) {
```

### /Users/highlands/pools/Development/dirac/src/core/webview/WebviewProvider.ts (lines 12-297)
```
export abstract class DiracWebviewProvider {
	controller: Controller

	private static instance: DiracWebviewProvider | null = null

	constructor(readonly context: DiracExtensionContext) {
		DiracWebviewProvider.instance = this

		// Create controller with cache service
		this.controller = new Controller(context)
	}

	async dispose() {
		await this.controller.dispose()
		DiracWebviewProvider.instance = null
	}

	public static getInstance(): DiracWebviewProvider {
		if (!DiracWebviewProvider.instance) {
			throw new Error(
				"DiracWebviewProvider instance not initialized. Make sure to create a DiracWebviewProvider instance first.",
			)
		}
		return DiracWebviewProvider.instance
	}

	public static getVisibleInstance(): DiracWebviewProvider | undefined {
		return DiracWebviewProvider.instance?.isVisible() ? DiracWebviewProvider.instance : undefined
	}

	public static async disposeAllInstances() {
		if (DiracWebviewProvider.instance) {
			await DiracWebviewProvider.instance.dispose()
		}
	}

	/**
	 * Converts a local filesystem path to a URL that can be used within the webview.
	 *
	 * @param path - The local path to convert
	 * @returns A URL that can be used within the webview
	 */
	abstract getWebviewUrl(path: string): string

	/**
	 * Gets the Content Security Policy source for the webview.
	 *
	 * @returns The CSP source string to be used in the webview's Content-Security-Policy
	 */
	abstract getCspSource(): string

	/**
	 * Checks if the webview is currently visible to the user.
	 *
	 * @returns True if the webview is visible, false otherwise
	 */
	abstract isVisible(): boolean

	/**
	 * Returns host-specific runtime configuration to inject into the webview.
	 *
	 * This is the seam through which a host (e.g. VSCode) can forward user
	 * settings to the webview without going through the gRPC state pipeline.
	 * The returned object is serialized into `window.__DIRAC_CONFIG__` inside the
	 * webview HTML. The base implementation injects nothing.
	 *
	 * @returns A JSON-serializable config object (empty by default).
	 */
	protected getInjectedConfig(): Record<string, unknown> {
		return {}
	}

	/**
	 * Builds a nonce-guarded inline script that exposes the host-injected runtime
	 * config on `window.__DIRAC_CONFIG__` before the app bundle runs.
	 *
	 * @param nonce - The CSP nonce that authorizes inline scripts in the webview.
	 * @returns An HTML `<script>` tag, or an empty string when there is no config.
	 */
	protected getInjectedConfigScript(nonce: string): string {
		const config = this.getInjectedConfig()
		if (!config || Object.keys(config).length === 0) {
			return ""
		}
		// JSON.stringify is safe to embed in a script as long as we guard the
		// closing-tag sequence, which cannot otherwise appear in JSON output.
		const serialized = JSON.stringify(config).replace(/</g, "\\u003c")
		return /*html*/ `<script nonce="${nonce}">window.__DIRAC_CONFIG__ = ${serialized};</script>`
	}

	/**
	 * Defines and returns the HTML that should be rendered within the webview panel.
	 *
	 * @remarks This is also the place where references to the React webview build files
	 * are created and inserted into the webview HTML.
	 *
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	public getHtmlContent(): string {
		// Get the local path to main script run in the webview,
		// then convert it to a url we can use in the webview.
		// The JS file from the React build output
		const geistSansUrl = this.getExtensionUrl("webview-ui", "build", "fonts", "Geist[wght].woff2")
		const geistMonoUrl = this.getExtensionUrl("webview-ui", "build", "fonts", "GeistMono[wght].woff2")

		const scriptUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.js")

		// The CSS file from the React build output
		const stylesUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.css")

		// The codicon font from the React build output
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-codicons-sample/src/extension.ts
		// we installed this package in the extension so that we can access it how its intended from the extension (the font file is likely bundled in vscode), and we just import the css fileinto our react app we don't have access to it
		// don't forget to add font-src ${webview.cspSource};
		const codiconsUrl = this.getExtensionUrl("node_modules", "@vscode", "codicons", "dist", "codicon.css")

		// Use a nonce to only allow a specific script to be run.
		/*
                content security policy of your webview to only allow scripts that have a specific nonce
                create a content security policy meta tag so that only loading scripts with a nonce is allowed
                As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicitly allow for these resources. E.g.
                                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
        - 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
        - since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

                in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
                */
		const nonce = getNonce()

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
				<meta name="theme-color" content="#000000">
				<style>
					:root {
						--geist-sans-url: url("${geistSansUrl}");
						--geist-mono-url: url("${geistMonoUrl}");
					}
				</style>
				<link rel="stylesheet" type="text/css" href="${stylesUrl}">
				<link href="${codiconsUrl}" rel="stylesheet" />
				<meta http-equiv="Content-Security-Policy" content="default-src 'none';
					connect-src https://*.posthog.com https://*.dirac.run; 
					font-src ${this.getCspSource()} data:; 
					style-src ${this.getCspSource()} 'unsafe-inline'; 
					img-src ${this.getCspSource()} https: data:; 
					script-src 'nonce-${nonce}' 'unsafe-eval';">
				<title>Dirac</title>
			</head>
			<body>
				<noscript>You need to enable JavaScript to run this app.</noscript>
				<div id="root"></div>
				${this.getInjectedConfigScript(nonce)}
				<script type="module" nonce="${nonce}" src="${scriptUrl}"></script>
			</body>
		</html>
		`
	}

	/**
	 * Reads the Vite dev server port from the generated port file to avoid conflicts
	 * Returns a Promise that resolves to the port number
	 * If the file doesn't exist or can't be read, it resolves to the default port
	 */
	private getDevServerPort(): Promise<number> {
		const DEFAULT_PORT = 25463

		const portFilePath = path.join(__dirname, "..", "webview-ui", ".vite-port")

		return readFile(portFilePath, "utf8")
			.then((portFile) => {
				const port = Number.parseInt(portFile.trim()) || DEFAULT_PORT
				Logger.info(`[getDevServerPort] Using dev server port ${port} from .vite-port file`)

				return port
			})
			.catch((_err) => {
				Logger.warn(
					`[getDevServerPort] Port file not found or couldn't be read at ${portFilePath}, using default port: ${DEFAULT_PORT}`,
				)
				return DEFAULT_PORT
			})
	}

	/**
	 * Connects to the local Vite dev server to allow HMR, with fallback to the bundled assets
	 *
	 * @param webview A reference to the extension webview
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	protected async getHMRHtmlContent(): Promise<string> {
		const localPort = await this.getDevServerPort()
		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running.
		try {
			await axios.get(`http://${localServerUrl}`)
		} catch (_error) {
			// Only show the error message when in development mode.
			if (isDev()) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message:
						"Dirac: Local webview dev server is not running, HMR will not work. Please run 'npm run dev:webview' before launching the extension to enable HMR. Using bundled assets.",
				})
			}

			return this.getHtmlContent()
		}

		const nonce = getNonce()
		const geistSansUrl = this.getExtensionUrl("webview-ui", "public", "fonts", "Geist[wght].woff2")
		const geistMonoUrl = this.getExtensionUrl("webview-ui", "public", "fonts", "GeistMono[wght].woff2")

		const stylesUrl = this.getExtensionUrl("webview-ui", "build", "assets", "index.css")
		const codiconsUrl = this.getExtensionUrl("node_modules", "@vscode", "codicons", "dist", "codicon.css")

		const scriptEntrypoint = "src/app/main.tsx"
		const scriptUrl = `http://${localServerUrl}/${scriptEntrypoint}`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://${localServerUrl}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			`font-src ${this.getCspSource()}`,
			`style-src ${this.getCspSource()} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${this.getCspSource()} https: data:`,
			`script-src 'unsafe-eval' https://* http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
			`connect-src https://* ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					${isDev() ? '<script src="http://localhost:8097"></script>' : ""}
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUrl}">
					<link href="${codiconsUrl}" rel="stylesheet" />
					<title>Dirac</title>
					<style>
						:root {
							--geist-sans-url: url("${geistSansUrl}");
							--geist-mono-url: url("${geistMonoUrl}");
						}
					</style>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					${this.getInjectedConfigScript(nonce)}
					<script type="module" src="${scriptUrl}"></script>
				</body>
			</html>
		`
	}
	/**
	 * A helper function which will get the webview URL of a given file or resource in the extension directory.
	 *
	 * @remarks This URL can be used within a webview's HTML as a link to the
	 * given file/resource.
	 *
	 * @param pathList An array of strings representing the path to a file/resource in the extension directory.
	 * @returns A URL pointing to the file/resource
	 */
	private getExtensionUrl(...pathList: string[]): string {
		const assetPath = path.resolve(HostProvider.get().extensionFsPath, ...pathList)
		return this.getWebviewUrl(assetPath)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/TelemetryService.ts (lines 48-397)
```
export class TelemetryService {
	private contextManager: TelemetryContextManager
	private providerManager: TelemetryProviderManager
	private eventEmitter: TelemetryEventEmitter
	private sessionTracker: TelemetrySessionTracker
	private categoryGate: TelemetryCategoryGate
	private grpcResponseCount = 0
	public static readonly METRICS = TELEMETRY_METRICS
	private static readonly EVENTS = TELEMETRY_EVENTS

	private browser: BrowserTelemetry
	private hooks: HookTelemetry
	private mention: MentionTelemetry
	private subagents: SubagentTelemetry
	private task: TaskTelemetry
	private terminal: TerminalTelemetry
	private tool: ToolTelemetry
	private ui: UiTelemetry
	private user: UserTelemetry
	private workspace: WorkspaceTelemetry

	public static async create(): Promise<TelemetryService> {
		const providers = await TelemetryProviderFactory.createProviders()
		const v = await HostProvider.env.getHostVersion({})
		return new TelemetryService(providers, {
			extension_version: extensionVersion,
			platform: v.platform || "unknown",
			platform_version: v.version || "unknown",
			dirac_type: v.diracType || "unknown",
			os_type: os.platform(),
			os_version: os.version(),
			is_dev: process.env.IS_DEV,
		})
	}

	constructor(providers: ITelemetryProvider[], telemetryMetadata: TelemetryMetadata) {
		this.contextManager = new TelemetryContextManager(telemetryMetadata)
		this.providerManager = new TelemetryProviderManager(providers)
		this.sessionTracker = new TelemetrySessionTracker()
		this.eventEmitter = new TelemetryEventEmitter(this.providerManager, this.contextManager)
		this.categoryGate = new TelemetryCategoryGate()
		this.browser = new BrowserTelemetry(this.eventEmitter, this.categoryGate)
		this.hooks = new HookTelemetry(this.eventEmitter, this.categoryGate)
		this.mention = new MentionTelemetry(this.eventEmitter)
		this.subagents = new SubagentTelemetry(this.eventEmitter, this.categoryGate)
		this.task = new TaskTelemetry(this.eventEmitter, this.sessionTracker)
		this.terminal = new TerminalTelemetry(this.eventEmitter)
		this.tool = new ToolTelemetry(this.eventEmitter, this.sessionTracker, this.categoryGate)
		this.ui = new UiTelemetry(this.eventEmitter)
		this.user = new UserTelemetry(this.eventEmitter, this.contextManager, this.providerManager)
		this.workspace = new WorkspaceTelemetry(this.eventEmitter)

		this.capture({ event: TelemetryService.EVENTS.USER.TELEMETRY_ENABLED })
		Logger.info(`[TelemetryService] Initialized with ${providers.length} telemetry provider(s)`)
	}

	// ── Domain delegation — explicit one-line methods, statically verified via Parameters<> ──

	// User
	public captureUserOptOut(...a: Parameters<UserTelemetry["captureUserOptOut"]>) {
		return this.user.captureUserOptOut(...a)
	}
	public captureUserOptIn(...a: Parameters<UserTelemetry["captureUserOptIn"]>) {
		return this.user.captureUserOptIn(...a)
	}
	public captureExtensionActivated(...a: Parameters<UserTelemetry["captureExtensionActivated"]>) {
		return this.user.captureExtensionActivated(...a)
	}
	public captureExtensionStorageError(...a: Parameters<UserTelemetry["captureExtensionStorageError"]>) {
		return this.user.captureExtensionStorageError(...a)
	}
	public captureAuthStarted(...a: Parameters<UserTelemetry["captureAuthStarted"]>) {
		return this.user.captureAuthStarted(...a)
	}
	public captureAuthSucceeded(...a: Parameters<UserTelemetry["captureAuthSucceeded"]>) {
		return this.user.captureAuthSucceeded(...a)
	}
	public captureAuthFailed(...a: Parameters<UserTelemetry["captureAuthFailed"]>) {
		return this.user.captureAuthFailed(...a)
	}
	public captureAuthLoggedOut(...a: Parameters<UserTelemetry["captureAuthLoggedOut"]>) {
		return this.user.captureAuthLoggedOut(...a)
	}
	public captureOnboardingProgress(...a: Parameters<UserTelemetry["captureOnboardingProgress"]>) {
		return this.user.captureOnboardingProgress(...a)
	}
	public identifyAccount(...a: Parameters<UserTelemetry["identifyAccount"]>) {
		return this.user.identifyAccount(...a)
	}
	// Task
	public captureTaskCreated(...a: Parameters<TaskTelemetry["captureTaskCreated"]>) {
		return this.task.captureTaskCreated(...a)
	}
	public captureTaskRestarted(...a: Parameters<TaskTelemetry["captureTaskRestarted"]>) {
		return this.task.captureTaskRestarted(...a)
	}
	public captureTaskCompleted(...a: Parameters<TaskTelemetry["captureTaskCompleted"]>) {
		return this.task.captureTaskCompleted(...a)
	}
	public captureConversationTurnEvent(...a: Parameters<TaskTelemetry["captureConversationTurnEvent"]>) {
		return this.task.captureConversationTurnEvent(...a)
	}
	public captureTokenUsage(...a: Parameters<TaskTelemetry["captureTokenUsage"]>) {
		return this.task.captureTokenUsage(...a)
	}
	public captureModeSwitch(...a: Parameters<TaskTelemetry["captureModeSwitch"]>) {
		return this.task.captureModeSwitch(...a)
	}
	public captureCondense(...a: Parameters<TaskTelemetry["captureCondense"]>) {
		return this.task.captureCondense(...a)
	}
	public captureTaskFeedback(...a: Parameters<TaskTelemetry["captureTaskFeedback"]>) {
		return this.task.captureTaskFeedback(...a)
	}
	public captureTaskInitialization(...a: Parameters<TaskTelemetry["captureTaskInitialization"]>) {
		return this.task.captureTaskInitialization(...a)
	}
	public captureOptionSelected(...a: Parameters<TaskTelemetry["captureOptionSelected"]>) {
		return this.task.captureOptionSelected(...a)
	}
	public captureOptionsIgnored(...a: Parameters<TaskTelemetry["captureOptionsIgnored"]>) {
		return this.task.captureOptionsIgnored(...a)
	}
	public captureSlashCommandUsed(...a: Parameters<TaskTelemetry["captureSlashCommandUsed"]>) {
		return this.task.captureSlashCommandUsed(...a)
	}
	public captureFeatureToggle(...a: Parameters<TaskTelemetry["captureFeatureToggle"]>) {
		return this.task.captureFeatureToggle(...a)
	}
	public captureDiracRuleToggled(...a: Parameters<TaskTelemetry["captureDiracRuleToggled"]>) {
		return this.task.captureDiracRuleToggled(...a)
	}
	public captureAutoCondenseToggle(...a: Parameters<TaskTelemetry["captureAutoCondenseToggle"]>) {
		return this.task.captureAutoCondenseToggle(...a)
	}
	public captureYoloModeToggle(...a: Parameters<TaskTelemetry["captureYoloModeToggle"]>) {
		return this.task.captureYoloModeToggle(...a)
	}
	public captureDiracWebToolsToggle(...a: Parameters<TaskTelemetry["captureDiracWebToolsToggle"]>) {
		return this.task.captureDiracWebToolsToggle(...a)
	}
	// Tool
	public captureToolUsage(...a: Parameters<ToolTelemetry["captureToolUsage"]>) {
		return this.tool.captureToolUsage(...a)
	}
	public captureSkillUsed(...a: Parameters<ToolTelemetry["captureSkillUsed"]>) {
		return this.tool.captureSkillUsed(...a)
	}
	public captureCheckpointUsage(...a: Parameters<ToolTelemetry["captureCheckpointUsage"]>) {
		return this.tool.captureCheckpointUsage(...a)
	}
	public captureProviderApiError(...a: Parameters<ToolTelemetry["captureProviderApiError"]>) {
		return this.tool.captureProviderApiError(...a)
	}
	public captureGeminiApiPerformance(...a: Parameters<ToolTelemetry["captureGeminiApiPerformance"]>) {
		return this.tool.captureGeminiApiPerformance(...a)
	}
	public captureAiOutputAccepted(...a: Parameters<ToolTelemetry["captureAiOutputAccepted"]>) {
		return this.tool.captureAiOutputAccepted(...a)
	}
	public captureAiOutputRejected(...a: Parameters<ToolTelemetry["captureAiOutputRejected"]>) {
		return this.tool.captureAiOutputRejected(...a)
	}
	// UI
	public captureModelSelected(...a: Parameters<UiTelemetry["captureModelSelected"]>) {
		return this.ui.captureModelSelected(...a)
	}
	public captureModelFavoritesUsage(...a: Parameters<UiTelemetry["captureModelFavoritesUsage"]>) {
		return this.ui.captureModelFavoritesUsage(...a)
	}
	public captureButtonClick(...a: Parameters<UiTelemetry["captureButtonClick"]>) {
		return this.ui.captureButtonClick(...a)
	}
	public captureRulesMenuOpened(...a: Parameters<UiTelemetry["captureRulesMenuOpened"]>) {
		return this.ui.captureRulesMenuOpened(...a)
	}
	// Browser
	public captureBrowserToolStart(...a: Parameters<BrowserTelemetry["captureBrowserToolStart"]>) {
		return this.browser.captureBrowserToolStart(...a)
	}
	public captureBrowserToolEnd(...a: Parameters<BrowserTelemetry["captureBrowserToolEnd"]>) {
		return this.browser.captureBrowserToolEnd(...a)
	}
	public captureBrowserError(...a: Parameters<BrowserTelemetry["captureBrowserError"]>) {
		return this.browser.captureBrowserError(...a)
	}
	// Mention
	public captureMentionUsed(...a: Parameters<MentionTelemetry["captureMentionUsed"]>) {
		return this.mention.captureMentionUsed(...a)
	}
	public captureMentionFailed(...a: Parameters<MentionTelemetry["captureMentionFailed"]>) {
		return this.mention.captureMentionFailed(...a)
	}
	public captureMentionSearchResults(...a: Parameters<MentionTelemetry["captureMentionSearchResults"]>) {
		return this.mention.captureMentionSearchResults(...a)
	}
	// Workspace
	public captureWorkspaceInitialized(...a: Parameters<WorkspaceTelemetry["captureWorkspaceInitialized"]>) {
		return this.workspace.captureWorkspaceInitialized(...a)
	}
	public captureWorkspaceInitError(...a: Parameters<WorkspaceTelemetry["captureWorkspaceInitError"]>) {
		return this.workspace.captureWorkspaceInitError(...a)
	}
	public captureMultiRootCheckpoint(...a: Parameters<WorkspaceTelemetry["captureMultiRootCheckpoint"]>) {
		return this.workspace.captureMultiRootCheckpoint(...a)
	}
	public captureWorkspacePathResolved(...a: Parameters<WorkspaceTelemetry["captureWorkspacePathResolved"]>) {
		return this.workspace.captureWorkspacePathResolved(...a)
	}
	public captureWorkspaceSearchPattern(...a: Parameters<WorkspaceTelemetry["captureWorkspaceSearchPattern"]>) {
		return this.workspace.captureWorkspaceSearchPattern(...a)
	}
	public captureWorktreeViewOpened(...a: Parameters<WorkspaceTelemetry["captureWorktreeViewOpened"]>) {
		return this.workspace.captureWorktreeViewOpened(...a)
	}
	public captureWorktreeCreated(...a: Parameters<WorkspaceTelemetry["captureWorktreeCreated"]>) {
		return this.workspace.captureWorktreeCreated(...a)
	}
	public captureWorktreeMergeAttempted(...a: Parameters<WorkspaceTelemetry["captureWorktreeMergeAttempted"]>) {
		return this.workspace.captureWorktreeMergeAttempted(...a)
	}
	// Terminal
	public captureTerminalOutputFailure(...a: Parameters<TerminalTelemetry["captureTerminalOutputFailure"]>) {
		return this.terminal.captureTerminalOutputFailure(...a)
	}
	public captureTerminalUserIntervention(...a: Parameters<TerminalTelemetry["captureTerminalUserIntervention"]>) {
		return this.terminal.captureTerminalUserIntervention(...a)
	}
	public captureTerminalHang(...a: Parameters<TerminalTelemetry["captureTerminalHang"]>) {
		return this.terminal.captureTerminalHang(...a)
	}
	// Subagent
	public captureSubagentToggle(...a: Parameters<SubagentTelemetry["captureSubagentToggle"]>) {
		return this.subagents.captureSubagentToggle(...a)
	}
	public captureSubagentExecution(...a: Parameters<SubagentTelemetry["captureSubagentExecution"]>) {
		return this.subagents.captureSubagentExecution(...a)
	}
	// Hook
	public captureHookCacheAccess(...a: Parameters<HookTelemetry["captureHookCacheAccess"]>) {
		return this.hooks.captureHookCacheAccess(...a)
	}
	public captureHookExecution(...a: Parameters<HookTelemetry["captureHookExecution"]>) {
		return this.hooks.captureHookExecution(...a)
	}
	public captureHookDiscovery(...a: Parameters<HookTelemetry["captureHookDiscovery"]>) {
		return this.hooks.captureHookDiscovery(...a)
	}

	// ── Core infrastructure ──────────────────────────────────────────

	public addProvider(provider: ITelemetryProvider) {
		this.providerManager.addProvider(provider)
	}

	public removeProvider(name: string) {
		this.providerManager.removeProvider(name)
	}

	public async updateTelemetryState(didUserOptIn: boolean): Promise<void> {
		const { isEnabled } = await HostProvider.env.getTelemetrySettings({})
		if (isEnabled !== Setting.DISABLED || !didUserOptIn) return
		void HostProvider.window
			.showMessage({
				type: ShowMessageType.WARNING,
				message:
					"Anonymous Dirac error and usage reporting is enabled, but IDE telemetry is disabled. To enable error and usage reporting for this extension, enable telemetry in IDE settings.",
				options: { items: ["Open Settings"] },
			})
			.then((r: { selectedOption?: string }) => {
				if (r.selectedOption === "Open Settings")
					void HostProvider.window.openSettings({ query: "telemetry.telemetryLevel" })
			})
	}

	public capture(event: { event: string; properties?: TelemetryProperties }): void {
		this.eventEmitter.capture(event)
	}

	public captureRequired(event: string, properties?: TelemetryProperties): void {
		this.eventEmitter.captureRequired(event, properties)
	}

	public isCategoryEnabled(category: TelemetryCategory): boolean {
		return this.categoryGate.isEnabled(category)
	}

	public getProviders(): ITelemetryProvider[] {
		return this.providerManager.getProviders()
	}

	public isEnabled(): boolean {
		return this.providerManager.isEnabled()
	}

	public getSettings() {
		return this.providerManager.getSettings()
	}

	public captureHostEvent(name: string, content: string) {
		this.capture({ event: TelemetryService.EVENTS.HOST.DETECTED, properties: { name, content } })
	}

	public captureGrpcResponseSize(sizeUtf8Bytes: number, service: string, method: string, requestId?: string): void {
		this.grpcResponseCount++
		if (this.grpcResponseCount % 100 !== 0 && !process.env.MOCHA && !process.env.TS_NODE_PROJECT) return
		this.eventEmitter.recordHistogram(
			TelemetryService.METRICS.GRPC.RESPONSE_SIZE_BYTES,
			sizeUtf8Bytes,
			{ service, method, ...(requestId && { request_id: requestId }) },
			"Size of gRPC response messages in bytes",
		)
		if (sizeUtf8Bytes <= 4 * 1024 * 1024) return
		Logger.warn(
			`[TelemetryService] Large gRPC response: ${service}.${method} ` +
				`size=${(sizeUtf8Bytes / (1024 * 1024)).toFixed(1)}MB` +
				(requestId ? ` request_id=${requestId}` : ""),
		)
	}

	public safeCapture(telemetryFn: () => void, context?: string): void {
		try {
			telemetryFn()
		} catch (error) {
			Logger.error(`[Telemetry] Failed to capture telemetry${context ? ` [Context: ${context}]` : ""}:`, error)
		}
	}

	public async dispose(): Promise<void> {
		await this.providerManager.dispose()
	}

	// ── Terminal execution (overloaded — cannot use declare) ─────────

	public captureTerminalExecution(success: boolean, terminalType: "vscode", method: VscodeOutputMethod): void
	public captureTerminalExecution(
		success: boolean,
		terminalType: "standalone",
		method: StandaloneOutputMethod,
		exitCode?: number | null,
	): void
	public captureTerminalExecution(
		success: boolean,
		terminalType: TerminalType,
		method: TerminalOutputMethod,
		exitCode?: number | null,
	): void {
		this.terminal.captureTerminalExecution(success, terminalType, method, exitCode)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/feature-flags/FeatureFlagsService.ts (lines 21-155)
```
export class FeatureFlagsService {
	/**
	 * Constructor that accepts an IFeatureFlagsProvider instance
	 * @param provider IFeatureFlagsProvider instance for retrieving feature flags
	 */
	public constructor(private provider: IFeatureFlagsProvider) {}

	private cache: Map<FeatureFlag, FeatureFlagPayload> = new Map()
	/**
	 * Tracks cache update time and user ID for cache validity
	 */
	private cacheInfo: CacheInfo = { updateTime: 0, userId: null }

	/**
	 * Poll all known feature flags to update their cached values
	 */
	public async poll(userId: string | null): Promise<void> {
		// Do not update cache if last update was less than an hour ago
		const timesNow = Date.now()
		if (timesNow - this.cacheInfo.updateTime < DEFAULT_CACHE_TTL && this.cache.size) {
			// Skip fetch if within TTL and user context is unchanged
			if (this.cacheInfo.userId === userId) {
				return
			}
		}

		// Only update timestamp after successfully populating cache
		this.cacheInfo = { updateTime: timesNow, userId: userId || null }

		try {
			const values = await this.provider.getAllFlagsAndPayloads({
				flagKeys: FEATURE_FLAGS,
			})
			this.cacheInfo.flagsPayload = values

			for (const flag of FEATURE_FLAGS) {
				const payload = await this.getFeatureFlag(flag).catch(() => false)
				this.cache.set(flag, payload ?? false)
			}
		} catch (error) {
			// On error, clear cache info to force refresh on next poll
			this.cacheInfo = { updateTime: 0, userId: null }
			throw error
		}
	}

	private async getFeatureFlag(flagName: FeatureFlag): Promise<FeatureFlagPayload | undefined> {
		try {
			const payload = this.cacheInfo.flagsPayload?.featureFlagPayloads?.[flagName]
			const flagValue = this.cacheInfo.flagsPayload?.featureFlags?.[flagName]
			const value = payload ?? flagValue ?? FeatureFlagDefaultValue[flagName] ?? undefined

			if (!this.cache.has(flagName) || this.cache.get(flagName) !== value) {
				telemetryService.capture({
					event: "$feature_flag_called",
					properties: {
						$feature_flag: flagName,
						$feature_flag_response: flagValue,
					},
				})
			}

			return value
		} catch (error) {
			Logger.error(`Error checking if feature flag ${flagName} is enabled:`, error)
			return FeatureFlagDefaultValue[flagName] ?? false
		}
	}

	/**
	 * Wrapper: safely get boolean flag with default fallback
	 * Only check the cached value of a feature flag. If not cached, return defaultValue.
	 * Useful for performance-sensitive paths where we don't want to await a network call.
	 * Cache is updated periodically via poll(), and is generated on extension startup,
	 * and whenever the user logs in.
	 */
	public getBooleanFlagEnabled(flagName: FeatureFlag): boolean {
		return this.cache.get(flagName) === true
	}

	/**
	 * Get a cached flag payload (or default) without triggering a network call.
	 */
	public getFlagPayload(flagName: FeatureFlag): FeatureFlagPayload | undefined {
		return this.cache.get(flagName) ?? FeatureFlagDefaultValue[flagName]
	}

	public getWebtoolsEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.WEBTOOLS)
	}

	public getWorktreesEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.WORKTREES)
	}

	/**
	 * Get the feature flags provider instance
	 * @returns The current feature flags provider
	 */
	public getProvider(): IFeatureFlagsProvider {
		return this.provider
	}

	/**
	 * Check if feature flags are currently enabled
	 * @returns Boolean indicating whether feature flags are enabled
	 */
	public isEnabled(): boolean {
		return this.provider.isEnabled()
	}

	/**
	 * Get current feature flags settings
	 * @returns Current feature flags settings
	 */
	public getSettings() {
		return this.provider.getSettings()
	}

	/**
	 * For testing: directly set a feature flag in the cache
	 */
	public test(flagName: FeatureFlag, value: boolean) {
		if (process.env.NODE_ENV === "true") {
			this.cache.set(flagName, value)
		}
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		await this.provider.dispose()
	}
}
```


## Source Files:

- `src/core/commands/repairMissingTaskHistory.ts`
- `src/core/controller/browser/discoverBrowser.ts`
- `src/core/controller/browser/getBrowserConnectionInfo.ts`
- `src/core/controller/browser/getDetectedChromePath.ts`
- `src/core/controller/browser/relaunchChromeDebugMode.ts`
- `src/core/controller/browser/testBrowserConnection.ts`
- `src/core/controller/index.ts`
- `src/core/controller/models/refreshBasetenModels.ts`
- `src/core/controller/state/settingsBrowser.ts`
- `src/core/controller/state/updateTaskSettings.ts`
- `src/core/controller/task/exportTaskWithId.ts`
- `src/core/controller/web/openInBrowser.ts`
- `src/core/formatResponse.ts`
- `src/core/goal/GoalController.ts`
- `src/core/ignore/CommandAccessValidator.ts`
- `src/core/ignore/DiracIgnoreController.ts`
- `src/core/ignore/IgnoreFileWatcher.ts`
- `src/core/ignore/IgnorePatternParser.ts`
- `src/core/locks/FolderLockUtils.ts`
- `src/core/mentions/url-mention.ts`
- `src/core/task/tools/ToolValidator.ts`
- `src/core/task/tools/adapters/traits/BrowserTraitBuilder.ts`
- `src/core/task/tools/modules/browser_action/BrowserActionTool.ts`
- `src/core/task/tools/modules/browser_action/tool.ts`
- `src/core/webview/WebviewProvider.ts`
- `src/dev/commands/tasks.ts`
- `src/exports/dirac.d.ts`
- `src/exports/index.ts`
- `src/integrations/misc/export-markdown.ts`
- `src/integrations/terminal/standalone/StandaloneTerminal.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalManager.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalProcess.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalRegistry.ts`
- `src/integrations/terminal/standalone/TerminalProcessManager.ts`
- `src/integrations/terminal/types.ts`
- `src/services/browser/BrowserConnectionManager.ts`
- `src/services/browser/BrowserDiscovery.ts`
- `src/services/browser/BrowserSession.ts`
- `src/services/browser/UrlContentFetcher.ts`
- `src/services/browser/utils.ts`
- `src/services/feature-flags/FeatureFlagsProviderFactory.ts`
- `src/services/feature-flags/FeatureFlagsService.ts`
- `src/services/feature-flags/index.ts`
- `src/services/feature-flags/providers/DiracFeatureFlagsProvider.ts`
- `src/services/feature-flags/providers/IFeatureFlagsProvider.ts`
- `src/services/glob/list-files.ts`
- `src/services/telemetry/BrowserTelemetry.ts`
- `src/services/telemetry/TaskTelemetry.ts`
- `src/services/telemetry/TelemetryService.ts`
- `src/services/telemetry/providers/opentelemetry/otel-exporter-diagnostics.ts`
- `src/shared/BrowserSettings.ts`
- `src/shared/DiracFeatureSetting.ts`
- `src/shared/ignore/DiracIgnorePolicy.ts`
- `src/shared/services/config/dirac-telemetry-config.ts`
- `src/shared/services/feature-flags/feature-flags.ts`
- `src/standalone/dirac-core.ts`
- `src/standalone/hostbridge-client.ts`
- `src/standalone/lock-manager.ts`
- `src/standalone/protobus-service.ts`
- `src/standalone/utils.ts`
- `src/standalone/vscode-context-utils.ts`
- `src/standalone/vscode-context.ts`
- `src/utils/AnchorStateManager.ts`
- `src/utils/github-url-utils.ts`
- `src/utils/open-browser.ts`
- `src/utils/worktree-include.ts`

