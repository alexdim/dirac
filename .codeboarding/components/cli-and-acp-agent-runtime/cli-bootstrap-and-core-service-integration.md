---
component_id: 2.4
component_name: CLI Bootstrap & Core Service Integration
---

# CLI Bootstrap & Core Service Integration

## Component Description

Bootstraps the CLI process, initializes core services and logging, and integrates core API handlers, Unbiased authentication, and CLI state controllers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/index.ts (lines 246-367)
```
	.action(async (prompt, options) => {
		const { printWarning } = await import("./utils/display")
		const { hasToolSelectionOptions } = await import("./utils/tool-options")
		if (hasToolSelectionOptions(options) && (options.kanban || options.acpAuth || options.acp || options.listen)) {
			printWarning("Tool-selection options can only be used with ordinary CLI tasks.")
			exit(1)
		}
		if (options.kanban) {
			if (prompt) {
				printWarning("Use --kanban without a prompt.")
				exit(1)
			}
			const { runKanbanAlias } = await import("./commands/kanban")
			await runKanbanAlias()
			return
		}

		if (options.acpAuth) {
			const { runAuth } = await import("./commands/auth")
			await runAuth({ config: options.config, cwd: options.cwd, verbose: options.verbose })
			return
		}
		// Check for ACP mode first - this takes precedence over everything else
		if (options.acp || options.listen) {
			if (isGoalRequest(prompt)) {
				printWarning(UNSUPPORTED_GOAL_CLI_MESSAGE)
				exit(1)
			}
			releaseCliSignalOwnership()
			const { runAcpMode } = await import("./acp/index.js")
			await runAcpMode({
				config: options.config,
				cwd: options.cwd,
				provider: options.provider,
				model: options.model,
				mode: options.plan ? "plan" : options.act ? "act" : undefined,
				autoApprove: options.autoApproveAll ? true : undefined,
				yolo: options.yolo ? true : undefined,
				thinkingBudgetTokens:
					options.thinking === undefined
						? undefined
						: typeof options.thinking === "boolean"
							? 1024
							: Number(options.thinking),
				reasoningEffort: options.reasoningEffort,
				inferenceSpeed: options.speed,
				hooksDir: options.hooksDir,
				verbose: options.verbose,
				listen: options.listen,
			})
			return
		}

		// Always check for piped stdin content
		const { combinePromptWithPipedInput, isEmptyPipedInput, readStdinIfPiped } = await import("./utils/piped")
		const stdinInput = await readStdinIfPiped()

		// Track whether stdin was actually piped (even if empty) vs not piped (null)
		// stdinInput === null means stdin wasn't piped (TTY or not FIFO/file)
		// Empty or whitespace-only input still counts as piped and is classified below.
		// stdinInput has content means stdin was piped with data
		const stdinWasPiped = stdinInput !== null

		if (options.taskId && options.continue) {
			printWarning("Use either --taskId or --continue, not both.")
			exit(1)
		}

		if (options.continue) {
			if (prompt) {
				printWarning("Use --continue without a prompt.")
				exit(1)
			}
			if (stdinWasPiped) {
				printWarning("Use --continue without piped input.")
				exit(1)
			}
			const { continueTask } = await import("./commands/resume")
			await continueTask(options)
			return
		}

		// Error if stdin was piped but empty AND no prompt was provided
		// This handles:
		// - `echo "" | dirac` -> error (empty stdin, no prompt)
		// - `dirac "prompt"` in GitHub Actions -> OK (empty stdin ignored, has prompt)
		// - `cat file | dirac "explain"` -> OK (has stdin AND prompt)
		if (isEmptyPipedInput(stdinInput) && !prompt && !options.images?.length) {
			printWarning("Empty input received from stdin. Please provide content to process.")
			exit(1)
		}

		// If no prompt argument, check if input is piped via stdin
		const effectivePrompt = combinePromptWithPipedInput(prompt, stdinInput)
		if (stdinInput) {
			// Debug: show that we received piped input
			if (options.verbose) {
				process.stderr.write(`[debug] Received ${stdinInput.length} bytes from stdin\n`)
			}
		}

		// Handle --taskId flag to resume an existing task
		if (options.taskId) {
			const { resumeTask } = await import("./commands/resume")
			await resumeTask(options.taskId, {
				...options,
				initialPrompt: effectivePrompt,
				stdinWasPiped,
			})
			return
		}

		if (effectivePrompt || options.images?.length) {
			const { runTask } = await import("./commands/task")
			// Pass stdinWasPiped flag so runTask knows to use plain text mode
			await runTask(effectivePrompt || "", { ...options, stdinWasPiped })
		} else {
			const { showWelcome } = await import("./commands/welcome")
			// Show welcome prompt if no prompt given
			await showWelcome(options)
		}
	})
```

### /Users/highlands/pools/Development/dirac/cli/src/init.ts (lines 24-143)
```
export async function initializeCli(options: InitOptions): Promise<CliContext> {
	const { createCliOutputChannel } = await import("./utils/output-channel")
	const { setRuntimeHooksDir } = await import("@/core/storage/disk")
	const { initializeCliContext } = await import("./vscode-context")
	const { Logger } = await import("@/shared/services/Logger")
	const { autoUpdateOnStartup } = await import("./utils/update")
	const { Session } = await import("@/shared/services/Session")
	const { AuthHandler } = await import("@/hosts/external/AuthHandler")
	const { HostProvider } = await import("@/hosts/host-provider")
	const { CliWebviewProvider } = await import("./controllers/CliWebviewProvider")
	const { FileEditProvider } = await import("@/integrations/editor/FileEditProvider")
	const { CliCommentReviewController } = await import("./controllers/CliCommentReviewController")
	const { StandaloneTerminalManager } = await import("@/integrations/terminal/standalone/StandaloneTerminalManager")
	const { createCliHostBridgeProvider } = await import("./controllers")
	const { configureCliLogDirectory, getCliBinaryPath, DIRAC_CLI_DIR } = await import("./utils/path")
	const { StateManager } = await import("@/core/storage/StateManager")
	const { initCoreServices } = await import("./initCoreServices")
	const { telemetryService } = await import("@/services/telemetry")
	const { SymbolIndexService } = await import("@/services/symbol-index/SymbolIndexService")

	if (options.config) process.env.DIRAC_DIR = options.config

	const workspacePath = options.cwd || process.cwd()
	setRuntimeHooksDir(options.hooksDir)
	const { extensionContext, storageContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		diracDir: options.config,
		workspaceDir: workspacePath,
	})
	configureCliLogDirectory(storageContext.dataDir)
	await disposeCliLogging()
	const { DiracTempManager } = await import("@/services/temp")
	DiracTempManager.startPeriodicCleanup()

	// Set up output channel and Logger early so DiracEndpoint.initialize logs are captured
	const outputChannel = createCliOutputChannel("Dirac CLI")
	const logToChannel = (message: string) => outputChannel.appendLine(message)

	// Configure the shared Logging class early to capture all initialization logs
	unsubscribeCliLogger = Logger.subscribe(logToChannel)
	Logger.setVerbose(Boolean(options.verbose))
	if (options.verbose) {
		// Also mirror Logger output to stderr so it's visible in CLI output
		unsubscribeVerboseLogger = Logger.subscribe((msg) => process.stderr.write(`[dirac] ${msg}\n`))
	}

	// HostProvider must be initialized before StateManager (initCoreServices →
	// StateManager.initialize → initializeDistinctId reaches into HostProvider.env).
	HostProvider.initialize(
		"cli",
		() => new CliWebviewProvider(extensionContext as any),
		() => new FileEditProvider(),
		() => new CliCommentReviewController(),
		() => new StandaloneTerminalManager(),
		createCliHostBridgeProvider(workspacePath),
		logToChannel,
		async (path: string) => (options.enableAuth ? AuthHandler.getInstance().getCallbackUrl(path) : ""),
		getCliBinaryPath,
		EXTENSION_DIR,
		DATA_DIR,
		async (_cwd: string) => undefined,
	)

	// DiracEndpoint + StateManager + ErrorService go through the shared
	// helper so the ACP entrypoint can't drift out of sync (see initCoreServices).
	await initCoreServices({ extensionDir: EXTENSION_DIR, storageContext })

	const stateManager = StateManager.get()
	const { configureTerminalTheme } = await import("./constants/theme")
	configureTerminalTheme(stateManager.getGlobalSettingsKey("cliTerminalColorMode"))

	// Auto-update check (after endpoints initialized, so we can detect bundled configs)
	autoUpdateOnStartup(CLI_VERSION)

	// Initialize/reset session tracking for this CLI run
	Session.reset()

	if (options.enableAuth) {
		AuthHandler.getInstance().setEnabled(true)
	}

	outputChannel.appendLine(
		`Dirac CLI initialized. Data dir: ${DATA_DIR}, Extension dir: ${EXTENSION_DIR}, Log dir: ${DIRAC_CLI_DIR.log}`,
	)

	const { getProviderFromEnv } = await import("@shared/storage/env-config")
	const envProvider = getProviderFromEnv()
	if (envProvider) {
		if (!stateManager.getGlobalSettingsKey("actModeApiProvider")) {
			stateManager.setSessionOverride("actModeApiProvider", envProvider)
		}
		if (!stateManager.getGlobalSettingsKey("planModeApiProvider")) {
			stateManager.setSessionOverride("planModeApiProvider", envProvider)
		}
	}

	const webview = HostProvider.get().createDiracWebviewProvider() as any
	const controller = webview.controller as any

	await telemetryService.captureExtensionActivated()
	await telemetryService.captureHostEvent("dirac_cli", "initialized")

	// =============== Symbol Index Service ===============
	// Initialize symbol index for the project in background with a delay
	// to avoid blocking UI rendering (matches VS Code extension behavior).
	// Skipped entirely when --no-index is set.
	if (options.index !== false) {
		const INITIALIZATION_DELAY_MS = 5000
		setTimeout(() => {
			SymbolIndexService.getInstance()
				.initialize(workspacePath)
				.catch((error) => {
					Logger.error("[Dirac] Failed to initialize SymbolIndexService:", error)
				})
		}, INITIALIZATION_DELAY_MS)
	}

	const ctx = { extensionContext, dataDir: DATA_DIR, extensionDir: EXTENSION_DIR, workspacePath, controller }
	setActiveContext(ctx)
	return ctx
}
```

### /Users/highlands/pools/Development/dirac/cli/src/init.ts (lines 8-19)
```
export async function disposeCliLogging(): Promise<void> {
	unsubscribeCliLogger?.()
	unsubscribeCliLogger = undefined
	unsubscribeVerboseLogger?.()
	unsubscribeVerboseLogger = undefined

	const { disposeCliOutputLoggers } = await import("./utils/output-channel")
	await disposeCliOutputLoggers()

	const { DiracTempManager } = await import("@/services/temp")
	DiracTempManager.stopPeriodicCleanup()
}
```

### /Users/highlands/pools/Development/dirac/cli/src/initCoreServices.ts (lines 26-30)
```
export async function initCoreServices(opts: CoreServicesInitOptions): Promise<void> {
	await DiracEndpoint.initialize(opts.extensionDir)
	await StateManager.initialize(opts.storageContext)
	await ErrorService.initialize()
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/index.ts (lines 536-604)
```
export function validateApiConfiguration(configuration: ApiConfiguration, mode?: Mode): void {
	const modes = mode === undefined ? (["plan", "act"] as const) : [mode]
	for (const selectedMode of modes) {
		const provider = configuredProvider(configuration, selectedMode)
		assertProviderSupported(provider)
		const modeConfig = resolveModeConfig(configuration, selectedMode)
		const configuredInferenceSpeed = modeConfig.inferenceSpeed
		if (configuredInferenceSpeed !== undefined && !isInferenceSpeed(configuredInferenceSpeed)) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProviderConfigurationIncomplete,
				`Invalid inference speed: ${String(configuredInferenceSpeed)}`,
				"Select Default, Standard, or Fast before retrying.",
			)
		}
		const inferenceSpeed = configuredInferenceSpeed ?? DEFAULT_INFERENCE_SPEED
		if (inferenceSpeed === "standard" && !providerSupportsInferenceSpeed(provider as ApiProvider)) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ModelUnavailable,
				`Provider ${provider} does not support inference speed controls`,
				"Reset inference speed to Default before retrying.",
			)
		}
		if (
			inferenceSpeed === "fast" &&
			(!modeConfig.apiModelId || !modelSupportsInferenceSpeed(provider as ApiProvider, modeConfig.apiModelId))
		) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ModelUnavailable,
				`Model ${modeConfig.apiModelId || "(unconfigured)"} does not support Fast mode`,
				"Select a Fast-capable model or reset inference speed to Default.",
			)
		}
		if (
			provider === "openai" &&
			modeConfig.openAiProfileName &&
			!configuration.openAiCompatibleProfiles?.some((profile) => profile.name === modeConfig.openAiProfileName)
		) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProfileMissing,
				`OpenAI-compatible profile not found: ${modeConfig.openAiProfileName}`,
				"Select an available profile before retrying.",
			)
		}
		if (provider === "dify" && (!configuration.difyApiKey || !configuration.difyBaseUrl)) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProviderConfigurationIncomplete,
				"Dify requires both an API key and base URL",
				"Configure both values before selecting Dify.",
			)
		}
		const dynamicProviderModelId =
			provider === "openrouter"
				? modeConfig.openRouterModelId
				: provider === "together"
					? modeConfig.togetherModelId
					: provider === "vercel-ai-gateway"
						? modeConfig.vercelAiGatewayModelId
						: provider === "aihubmix"
							? modeConfig.aihubmixModelId
							: undefined
		if (["openrouter", "together", "vercel-ai-gateway", "aihubmix"].includes(provider) && !dynamicProviderModelId) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ModelUnavailable,
				`${provider} requires an explicit model ID`,
				"Select a model before retrying.",
			)
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/index.ts (lines 623-645)
```
export function buildApiHandler(configuration: ApiConfiguration, mode: Mode): ApiHandler {
	const { planModeApiProvider, actModeApiProvider, apiProvider: fallbackProvider, ...options } = configuration
	const apiProvider = (mode === "plan" ? planModeApiProvider : actModeApiProvider) ?? fallbackProvider
	const handler = createHandlerForProvider(apiProvider, options, mode)
	const { thinkingBudgetTokens } = resolveModeConfig(options, mode)
	if (!thinkingBudgetTokens || thinkingBudgetTokens <= 0) return handler

	const modelInfo = handler.getModel().info
	const maxBudget = modelInfo.thinkingConfig?.maxBudget
	const isAnthropicFamily = apiProvider === "anthropic" || apiProvider === "vertex" || apiProvider === "bedrock"
	const effectiveCap =
		maxBudget ?? (modelInfo.maxTokens ? (isAnthropicFamily ? modelInfo.maxTokens - 1 : modelInfo.maxTokens) : undefined)

	if (!effectiveCap || thinkingBudgetTokens <= effectiveCap) {
		return handler
	}

	const clippedOptions = {
		...options,
		[mode === "plan" ? "planModeThinkingBudgetTokens" : "actModeThinkingBudgetTokens"]: effectiveCap,
	}
	return createHandlerForProvider(apiProvider, clippedOptions, mode)
}
```


## Source Files:

- `cli/src/index.ts`
- `cli/src/init.ts`
- `cli/src/initCoreServices.ts`
- `cli/src/types.ts`
- `src/core/api/index.ts`
- `src/core/api/providers/unbiased.ts`
- `src/core/api/unbiased/unbiased-models.ts`
- `src/core/controller/models/authenticateUnbiased.ts`
- `src/core/controller/models/refreshUnbiasedModelsRpc.ts`
- `src/core/controller/models/signOutUnbiased.ts`
- `src/core/controller/state/checkCliInstallation.ts`
- `src/core/controller/state/installDiracCli.ts`
- `src/core/controller/state/settingsCli.ts`
- `src/core/controller/state/settingsMode.ts`
- `src/core/controller/state/settingsTelemetry.ts`
- `src/core/controller/state/updateCliBannerVersion.ts`
- `src/core/controller/state/updateSettingsCli.ts`
- `src/core/task/utils.ts`
- `src/integrations/unbiased/device-auth.ts`
- `src/integrations/unbiased/oauth-account.ts`
- `src/utils/cli-detector.ts`

