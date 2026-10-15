---
component_id: 5.1
component_name: Browser Automation & Telemetry Service
---

# Browser Automation & Telemetry Service

## Component Description

Manages headless and remote browser sessions, browser action tool execution, URL content fetching, and central telemetry event dispatching.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/browser/getBrowserConnectionInfo.ts (lines 12-47)
```
export async function getBrowserConnectionInfo(controller: Controller, _: EmptyRequest): Promise<BrowserConnectionInfo> {
	try {
		// Get browser settings from extension state
		const browserSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")

		// Check if there's an active browser session by using the controller's handleWebviewMessage approach
		// This is similar to what's done in controller/index.ts for the "getBrowserConnectionInfo" message
		if (controller.task?.browserSession) {
			// Access the browser session through the controller's task property
			// Using indexer notation to access private property
			const browserSession = controller.task.browserSession
			const connectionInfo = browserSession.getConnectionInfo()

			// Convert from BrowserSession.BrowserConnectionInfo to proto.BrowserConnectionInfo
			return BrowserConnectionInfo.create({
				isConnected: connectionInfo.isConnected,
				isRemote: connectionInfo.isRemote,
				host: connectionInfo.host || "", // Ensure host is never undefined
			})
		}

		// Fallback to browser settings if no active browser session
		return BrowserConnectionInfo.create({
			isConnected: false,
			isRemote: !!browserSettings.remoteBrowserEnabled,
			host: browserSettings.remoteBrowserHost || "",
		})
	} catch (error: unknown) {
		Logger.error("Error getting browser connection info:", error)
		return BrowserConnectionInfo.create({
			isConnected: false,
			isRemote: false,
			host: "",
		})
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/tools/modules/browser_action/BrowserActionTool.ts (lines 47-241)
```
export class BrowserActionTool implements IDiracTool {
	spec(): DiracToolSpec {
		return browser_action_spec
	}

	supportedSurfaces(): SurfaceType[] {
		return ["all"]
	}

	async processCall(args: any, env: IToolEnvironment): Promise<string | Array<DiracTextContentBlock | DiracImageContentBlock>> {
		const { action, url, coordinate, text } = args
		const isSubagent = env.config.isSubagentExecution
		const example = '{"action": "launch", "url": "https://google.com"}'
		const utilityPermissionHandlingEnabled = env.config.permissionDecisionBinding !== undefined

		if (!action) {
			return this.reportMissingActionParameter(env, example)
		}

		const card = !isSubagent
			? await env.ui.createCard({
				icon: DiracIcon.BROWSER,
				header: `Browser: ${action}${action === "launch" && url ? ` ${url}` : action === "click" && coordinate ? ` at ${coordinate}` : action === "type" && text ? ` "${text.substring(0, 30)}"` : ""}`,
				collapsed: true,
			})
			: undefined
		try {
			let result: BrowserActionResult

			switch (action) {
				case "launch":
					if (!url) return this.reportMissingUrlParameter(env, card, example)
					const permissionDisposition = utilityPermissionHandlingEnabled
						? this.resolveLaunchPermission(env, url)
						: undefined
					if (permissionDisposition !== "auto_approve") {
						const permissionCard = await env.ui.createCard({
							header: `Launch browser: ${url}`,
							icon: DiracIcon.BROWSER,
							status: CardStatus.WAITING_FOR_INPUT,
							requireApproval: true,
							permissionRequestKind:
								utilityPermissionHandlingEnabled && permissionDisposition === "manual_only"
									? "manual_tool"
									: "tool",
							collapsed: false,
							body: `Dirac wants to launch a browser at ${url}`,
						})
						const interaction = await permissionCard.waitForInteraction()
						const approved = interaction.action === DiracAskResponse.APPROVE
						if (interaction.action === DiracAskResponse.MESSAGE) {
							if (interaction.text) await env.ui.upsertText(interaction.text, false, "user")
							await permissionCard.finalize(CardStatus.SKIPPED)
							if (card) {
								await card.update({ body: `↩ Skipped — user sent a message instead` })
								await card.finalize(CardStatus.SKIPPED)
							}
							return interaction.text
								? formatResponse.toolDeniedWithFeedback(interaction.text)
								: formatResponse.toolDenied()
						}
						await permissionCard.finalize(approved ? CardStatus.SUCCESS : CardStatus.CANCELLED)
						if (!approved) return this.formatLaunchDenialResponse(interaction.value, card)
					}
					if (card) await card.update({ body: `Launching ${url}...` })
					result = await env.browser.launch(url)
					break

				case "click":
					if (!coordinate) return this.reportMissingCoordinateParameter(env, card, example)
					result = await env.browser.click(coordinate)
					break

				case "type":
					if (!text) return this.reportMissingTextParameter(env, card, example)
					result = await env.browser.type(text)
					break

				case "scroll_down":
					result = await env.browser.scroll("down")
					break

				case "scroll_up":
					result = await env.browser.scroll("up")
					break

				case "close":
					await env.browser.close()
					if (card) {
						await card.update({ body: "Browser closed." })
						await card.finalize(CardStatus.SUCCESS)
					}
					return "The browser has been closed. You may now proceed to using other tools."

				default:
					throw new Error(`Unknown browser action: ${action}`)
			}

			return this.formatBrowserActionResult(action, result, card)
		} catch (error: any) {
			return this.abortBrowserWithError(error, card, env)
		}
	}

	private resolveLaunchPermission(env: IToolEnvironment, url: string): ToolPermissionDisposition {
		const ruleResult = env.config.services.commandPermissionController.validateTool(DiracDefaultTool.BROWSER, url)
		if (!ruleResult.allowed) return "manual_only"
		if (env.config.autoApprover.isUnrestrictedAutoApprove()) return "auto_approve"
		if (ruleResult.reason === "allowed" && ruleResult.matchedPattern) return "auto_approve"
		if (env.config.autoApprover.shouldAutoApproveTool(DiracDefaultTool.BROWSER) === true) return "auto_approve"
		return "utility_eligible"
	}

	private async reportMissingActionParameter(env: IToolEnvironment, example: string): Promise<string> {
		const currentMistakeCount = env.orchestration.getTaskState("consecutiveMistakeCount")
		env.orchestration.setTaskState("consecutiveMistakeCount", currentMistakeCount + 1)
		await env.browser.close()
		return `Missing value for required parameter 'action'. Please retry with complete response.\n\nExample of correct usage (arguments JSON):\n${example}\n`
	}

	private async reportMissingUrlParameter(env: IToolEnvironment, card: any, example: string): Promise<string> {
		const currentMistakeCount = env.orchestration.getTaskState("consecutiveMistakeCount")
		env.orchestration.setTaskState("consecutiveMistakeCount", currentMistakeCount + 1)
		await env.browser.close()
		if (card) {
			await card.update({ body: "Missing required parameter 'url' for 'launch' action." })
			await card.finalize(CardStatus.ERROR)
		}
		return `Missing value for required parameter 'url'. Please retry with complete response.\n\nExample of correct usage (arguments JSON):\n${example}\n`
	}

	private async reportMissingCoordinateParameter(env: IToolEnvironment, card: any, example: string): Promise<string> {
		const currentMistakeCount = env.orchestration.getTaskState("consecutiveMistakeCount")
		env.orchestration.setTaskState("consecutiveMistakeCount", currentMistakeCount + 1)
		await env.browser.close()
		if (card) {
			await card.update({ body: "Missing required parameter 'coordinate' for 'click' action." })
			await card.finalize(CardStatus.ERROR)
		}
		return `Missing value for required parameter 'coordinate'. Please retry with complete response.\n\nExample of correct usage (arguments JSON):\n${example}\n`
	}

	private async reportMissingTextParameter(env: IToolEnvironment, card: any, example: string): Promise<string> {
		const currentMistakeCount = env.orchestration.getTaskState("consecutiveMistakeCount")
		env.orchestration.setTaskState("consecutiveMistakeCount", currentMistakeCount + 1)
		await env.browser.close()
		if (card) {
			await card.update({ body: "Missing required parameter 'text' for 'type' action." })
			await card.finalize(CardStatus.ERROR)
		}
		return `Missing value for required parameter 'text'. Please retry with complete response.\n\nExample of correct usage (arguments JSON):\n${example}\n`
	}

	private async formatLaunchDenialResponse(reason: string | undefined, card: any): Promise<string> {
		if (card) {
			await card.update({
				body: `User denied browser launch: ${reason || "No reason provided"}`,
			})
			await card.finalize(CardStatus.CANCELLED)
		}
		return reason ? formatResponse.toolDeniedWithFeedback(reason) : formatResponse.toolDenied()
	}

	private async formatBrowserActionResult(
		action: string,
		result: BrowserActionResult,
		card: any,
	): Promise<Array<DiracTextContentBlock | DiracImageContentBlock>> {
		const responseText = `The browser action has been executed. The console logs and screenshot have been captured for your analysis.\n\nConsole logs:\n${result.logs || "(No new logs)"
			}\n\n(REMEMBER: if you need to proceed to using non-\`browser_action\` tools or launch a new browser, you MUST first close this browser. For example, if after analyzing the logs and screenshot you need to edit a file, you must first close the browser before you can use the write_to_file tool.)`

		if (card) {
			await card.update({
				header: `Browser: ${action} (Success)`,
				body: `Action: ${action}\nURL: ${result.currentUrl || "N/A"}\nLogs: ${result.logs || "none"}`,
			})
			await card.finalize(CardStatus.SUCCESS)
		}

		const blocks: Array<DiracTextContentBlock | DiracImageContentBlock> = [{ type: "text", text: responseText }]
		if (result.screenshot) {
			blocks.push(...formatResponse.imageBlocks([result.screenshot]))
		}
		return blocks
	}

	private async abortBrowserWithError(error: any, card: any, env: IToolEnvironment): Promise<never> {
		await env.browser.close()
		if (card) {
			await card.update({ body: error.message })
			await card.finalize(CardStatus.ERROR)
		}
		throw error
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

### /Users/highlands/pools/Development/dirac/src/core/controller/state/updateTaskSettings.ts (lines 150-166)
```
export async function updateTaskSettings(controller: Controller, request: UpdateTaskSettingsRequest): Promise<Empty> {
	if (controller.selectedGoalId && request.settings?.mode !== undefined) {
		throw new Error("Mode switching is disabled while a Goal is active.")
	}
	const taskId = resolveTaskId(controller, request)
	if (request.settings) {
		const activeTask = controller.task?.taskId === taskId ? controller.task : undefined
		const prepared = prepareTaskSettings(controller, request.settings, activeTask?.getWorkingConfiguration().settings)
		const taskPatch: TaskWorkingConfigurationPatch = { settings: prepared.settingsPatch }
		const persist = () => persistTaskSettings(controller, taskId, prepared)

		if (activeTask) await activeTask.applyWorkingConfigurationUpdate(taskPatch, persist)
		else persist()
	}
	await controller.postStateToWebview()
	return Empty.create()
}
```


## Source Files:

- `src/core/controller/browser/discoverBrowser.ts`
- `src/core/controller/browser/getBrowserConnectionInfo.ts`
- `src/core/controller/browser/getDetectedChromePath.ts`
- `src/core/controller/browser/relaunchChromeDebugMode.ts`
- `src/core/controller/browser/testBrowserConnection.ts`
- `src/core/controller/state/settingsBrowser.ts`
- `src/core/controller/state/updateTaskSettings.ts`
- `src/core/controller/web/openInBrowser.ts`
- `src/core/mentions/url-mention.ts`
- `src/core/task/tools/adapters/traits/BrowserTraitBuilder.ts`
- `src/core/task/tools/modules/browser_action/BrowserActionTool.ts`
- `src/core/task/tools/modules/browser_action/tool.ts`
- `src/services/browser/BrowserConnectionManager.ts`
- `src/services/browser/BrowserDiscovery.ts`
- `src/services/browser/BrowserSession.ts`
- `src/services/browser/UrlContentFetcher.ts`
- `src/services/browser/utils.ts`
- `src/services/telemetry/BrowserTelemetry.ts`
- `src/services/telemetry/TelemetryService.ts`
- `src/shared/BrowserSettings.ts`
- `src/utils/github-url-utils.ts`
- `src/utils/open-browser.ts`

