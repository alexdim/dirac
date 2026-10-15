---
component_id: 2.1.1
component_name: Interactive Terminal Views & Settings UI
---

# Interactive Terminal Views & Settings UI

## Component Description

Renders interactive terminal views, chat interfaces, modular task cards, authentication flows, and configuration settings panels using Ink UI components.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/components/App.tsx (lines 104-251)
```
const InternalApp: React.FC<AppProps> = ({
	view: initialView,
	taskId,
	verbose = false,
	controller,
	onComplete,
	onError,
	historyItems = [],
	historyAllItems,
	historyPagination,
	onHistoryPageChange,
	dataDir = "",
	globalState = {},
	workspaceState = {},
	// Rules
	globalDiracRulesToggles,
	localDiracRulesToggles,
	localCursorRulesToggles,
	localWindsurfRulesToggles,
	localAgentsRulesToggles,
	onToggleRule,
	// Workflows
	globalWorkflowToggles,
	localWorkflowToggles,
	onToggleWorkflow,
	// Hooks
	hooksEnabled,
	globalHooks,
	workspaceHooks,
	onToggleHook,
	// Skills
	skillsEnabled,
	globalSkills,
	localSkills,
	onToggleSkill,
	onWelcomeExit,
	initialPrompt,
	initialImages,
	timeoutSeconds,
	isRawModeSupported = true,
}) => {
	const { resizeKey } = useTerminalSize()
	const [currentView, setCurrentView] = useState<ViewType>(initialView)
	const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(taskId)
	const [pendingInitialPrompt, setPendingInitialPrompt] = useState<string | undefined>(initialPrompt)
	const [pendingInitialImages, setPendingInitialImages] = useState<string[] | undefined>(initialImages)

	useEffect(() => {
		if (!pendingInitialPrompt && (!pendingInitialImages || pendingInitialImages.length === 0)) {
			return
		}

		setPendingInitialPrompt(undefined)
		setPendingInitialImages(undefined)
	}, [pendingInitialPrompt, pendingInitialImages])

	const handleSelectTask = useCallback((taskId: string) => {
		setSelectedTaskId(taskId)
		setCurrentView("task")
	}, [])

	const handleNavigateToWelcome = useCallback(() => {
		setCurrentView("welcome")
	}, [])

	let content: ReactNode

	switch (currentView) {
		case "history":
			content = (
				<HistoryView
					allItems={historyAllItems}
					controller={controller}
					items={historyItems}
					onPageChange={onHistoryPageChange}
					onSelectTask={handleSelectTask}
					pagination={historyPagination}
				/>
			)
			break

		case "config":
			content = (
				<ConfigView
					dataDir={dataDir}
					globalDiracRulesToggles={globalDiracRulesToggles}
					globalHooks={globalHooks}
					globalSkills={globalSkills}
					globalState={globalState}
					globalWorkflowToggles={globalWorkflowToggles}
					hooksEnabled={hooksEnabled}
					localAgentsRulesToggles={localAgentsRulesToggles}
					localDiracRulesToggles={localDiracRulesToggles}
					localCursorRulesToggles={localCursorRulesToggles}
					localSkills={localSkills}
					localWindsurfRulesToggles={localWindsurfRulesToggles}
					localWorkflowToggles={localWorkflowToggles}
					onToggleHook={onToggleHook}
					onToggleRule={onToggleRule}
					onToggleSkill={onToggleSkill}
					onToggleWorkflow={onToggleWorkflow}
					skillsEnabled={skillsEnabled}
					workspaceHooks={workspaceHooks}
					workspaceState={workspaceState}
				/>
			)
			break

		case "auth":
			content = (
				<AuthView
					controller={controller}
					onComplete={onComplete}
					onError={onError}
					onNavigateToWelcome={handleNavigateToWelcome}
				/>
			)
			break

		case "task":
		case "welcome":
			content = (
				<TaskContextProvider controller={controller}>
					<ChatView
						controller={controller}
						initialImages={pendingInitialImages}
						initialPrompt={pendingInitialPrompt}
						verbose={verbose}
						timeoutSeconds={timeoutSeconds}
						onComplete={onComplete}
						onError={onError}
						onExit={onWelcomeExit}
						taskId={selectedTaskId}
					/>
				</TaskContextProvider>
			)
			break

		default:
			content = null
	}

	return (
		<StdinProvider isRawModeSupported={isRawModeSupported}>
			<Box key={resizeKey}>{content}</Box>
		</StdinProvider>
	)
}
```

### /Users/highlands/pools/Development/dirac/cli/src/components/AuthView.tsx (lines 149-787)
```
export const AuthView: React.FC<AuthViewProps> = ({ controller, onComplete, onError, onNavigateToWelcome }) => {
	const { exit } = useApp()
	const quote = useMemo(() => getRandomQuote(), [])

	const providers = useValidProviders()

	const [step, setStep] = useState<AuthStep>("menu")
	const [selectedProvider, setSelectedProvider] = useState<string>(
		StateManager.get().getApiConfiguration().actModeApiProvider ||
		StateManager.get().getApiConfiguration().planModeApiProvider ||
		"",
	)
	const [apiKey, setApiKey] = useState("")
	const [modelId, setModelId] = useState("")
	const [baseUrl, setBaseUrl] = useState("")
	const [errorMessage, setErrorMessage] = useState("")
	const [providerSearch, setProviderSearch] = useState("")
	const [providerIndex, setProviderIndex] = useState(0)
	const [importSources, setImportSources] = useState<DetectedSources>({ codex: false, opencode: false })
	const [importSource, setImportSource] = useState<ImportSource | null>(null)
	const [bedrockConfig, setBedrockConfig] = useState<BedrockConfig | null>(null)

	// Main menu items - conditionally include import options
	const mainMenuItems: SelectItem[] = useMemo(() => {
		const items: SelectItem[] = []

		// Add OpenAI Codex options for ChatGPT subscribers
		items.push({ label: "Sign in with ChatGPT Subscription", value: "openai_codex_auth" })
		items.push({ label: "Sign in with Unbiased", value: "unbiased_auth" })
		items.push({ label: "Sign in with GitHub Copilot", value: "github_copilot_auth" })

		// Add import options if detected
		if (importSources.codex) {
			items.push({ label: "Import from Codex CLI", value: "import_codex" })
		}
		if (importSources.opencode) {
			items.push({ label: "Import from OpenCode", value: "import_opencode" })
		}

		items.push({ label: "Use your own API key", value: "configure_byo" })
		items.push({ label: "Exit", value: "exit" })

		return items
	}, [importSources])

	// Provider menu items - filtered by search (searches both ID and display name)
	const providerItems: SelectItem[] = useMemo(() => {
		const search = providerSearch.toLowerCase()
		const filtered = providerSearch
			? providers.filter(
				(p: string) => p.toLowerCase().includes(search) || getProviderLabel(p).toLowerCase().includes(search),
			)
			: providers
		return filtered.map((p: string) => ({
			label: getProviderLabel(p),
			value: p,
		}))
	}, [providers, providerSearch])

	// Use shared scrollable list hook for provider windowing
	const TOTAL_PROVIDER_ROWS = 8
	const {
		visibleStart: providerVisibleStart,
		visibleCount: providerVisibleCount,
		showTopIndicator: showProviderTopIndicator,
		showBottomIndicator: showProviderBottomIndicator,
	} = useScrollableList(providerItems.length, providerIndex, TOTAL_PROVIDER_ROWS)

	const visibleProviderItems = useMemo(() => {
		return providerItems.slice(providerVisibleStart, providerVisibleStart + providerVisibleCount)
	}, [providerItems, providerVisibleStart, providerVisibleCount])

	// Detect import sources on mount
	useEffect(() => {
		setImportSources(detectImportSources())
	}, [])

	// Reset provider index when search changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: we want to reset here
	useEffect(() => {
		setProviderIndex(0)
	}, [providerSearch])

	// Set default model when entering model step
	useEffect(() => {
		if (step === "modelid" && hasModelPicker(selectedProvider)) {
			setModelId(getDefaultModelId(selectedProvider))
		}
	}, [step, selectedProvider])


	const handleMainMenuSelect = useCallback(
		(value: string) => {
			if (value === "exit") {
				exit()
				onComplete?.()
			} else if (value === "openai_codex_auth") {
				setStep("openai_codex_auth")
			} else if (value === "unbiased_auth") {
				setStep("unbiased_auth")
			} else if (value === "github_copilot_auth") {
				setStep("github_copilot_auth")
			} else if (value === "configure_byo") {
				setStep("provider")
			} else if (value === "import_codex") {
				setImportSource(ImportSource.CODEX)
				setStep("import")
			} else if (value === "import_opencode") {
				setImportSource(ImportSource.OPENCODE)
				setStep("import")
			}
		},
		[exit, onComplete],
	)

	const handleProviderSelect = useCallback(
		(value: string) => {
			setSelectedProvider(value)
			if (value === "openai-codex") {
				setStep("openai_codex_auth")
			} else if (value === "github-copilot") {
				setStep("github_copilot_auth")
			} else if (value === "bedrock") {
				setStep("bedrock")
			} else {
				setStep("apikey")
			}
		},
		[],
	)

	const handleApiKeySubmit = useCallback(
		(value: string) => {
			if (!value.trim() || !selectedProvider) {
				// Don't allow empty
				return
			}

			// Store in local state - will be saved via StateManager in saveConfiguration
			setApiKey(value)
			setStep("modelid")
		},
		[selectedProvider],
	)

	// Save custom Bedrock ARN configuration with base model for capability detection
	const saveCustomBedrockConfiguration = useCallback(
		async (arn: string, baseModelId: string) => {
			try {
				if (!bedrockConfig) {
					throw new Error("Bedrock configuration is missing")
				}
				await applyBedrockConfig({
					bedrockConfig,
					modelId: arn,
					customModelBaseId: baseModelId,
					controller,
				})

				const stateManager = StateManager.get()
				stateManager.setGlobalState("welcomeViewCompleted", true)
				await stateManager.flushPendingState()

				setStep("success")
			} catch (error) {
				setErrorMessage(error instanceof Error ? error.message : String(error))
				setStep("error")
			}
		},
		[bedrockConfig, controller],
	)

	const saveConfiguration = useCallback(
		async (model: string, base: string) => {
			try {
				if (selectedProvider === "bedrock" && bedrockConfig) {
					await applyBedrockConfig({
						bedrockConfig,
						modelId: model,
						controller,
					})
				} else {
					await applyProviderConfig({
						providerId: selectedProvider,
						apiKey,
						modelId: model,
						baseUrl: base,
						controller,
					})
				}

				const stateManager = StateManager.get()
				stateManager.setGlobalState("welcomeViewCompleted", true)
				await stateManager.flushPendingState()

				setStep("success")
			} catch (error) {
				setErrorMessage(error instanceof Error ? error.message : String(error))
				setStep("error")
			}
		},
		[selectedProvider, apiKey, bedrockConfig, controller],
	)

	const handleModelIdSubmit = useCallback(
		(value: string) => {
			// Intercept "Custom" selection for Bedrock — redirect to custom ARN input flow
			if (value === CUSTOM_MODEL_ID && selectedProvider === "bedrock") {
				setStep("bedrock_custom")
				return
			}

			if (value.trim()) {
				setModelId(value)
			}
			// Only show baseurl step for providers that support it
			if (ProviderToBaseUrlKeyMap[selectedProvider as ApiProvider]) {
				setStep("baseurl")
			} else {
				setStep("saving")
				saveConfiguration(value, "")
			}
		},
		[selectedProvider, saveConfiguration],
	)

	const handleBaseUrlSubmit = useCallback(
		(value: string) => {
			setBaseUrl(value)
			setStep("saving")
			saveConfiguration(modelId, value)
		},
		[modelId, saveConfiguration],
	)

	const handleBedrockComplete = useCallback((config: BedrockConfig) => {
		setBedrockConfig(config)
		setStep("modelid")
	}, [])

	const handleImportComplete = useCallback(() => {
		setStep("success")
	}, [])

	const handleImportCancel = useCallback(() => {
		setImportSource(null)
		setStep("menu")
	}, [])

	// Auto-navigate to welcome after success (immediate)
	// For quick setup mode (no onNavigateToWelcome), exit the Ink app
	useEffect(() => {
		if (step === "success") {
			if (onNavigateToWelcome) {
				onNavigateToWelcome()
			} else {
				// Quick setup mode - exit Ink app after successful configuration
				// The cleanup handler in runInkApp will handle process exit
				exit()
			}
		}
	}, [step, onNavigateToWelcome, exit])

	// Error screen menu items
	const errorMenuItems: SelectItem[] = useMemo(() => {
		const items: SelectItem[] = [{ label: "Try again", value: "retry" }]
		if (onNavigateToWelcome) {
			items.push({ label: "Start a task", value: "welcome" })
		}
		items.push({ label: "Exit", value: "exit" })
		return items
	}, [onNavigateToWelcome])

	const handleErrorMenuSelect = useCallback(
		(value: string) => {
			if (value === "retry") {
				// Reset state and go back to menu
				setErrorMessage("")
				setApiKey("")
				setModelId("")
				setBaseUrl("")
				setSelectedProvider("")
				setStep("menu")
			} else if (value === "welcome") {
				onNavigateToWelcome?.()
			} else if (value === "exit") {
				onError?.()
				exit()
			}
		},
		[onNavigateToWelcome, onError, exit],
	)

	// Handle going back to previous step
	const goBack = useCallback(() => {
		switch (step) {
			case "provider":
				setProviderSearch("")
				setProviderIndex(0)
				setStep("menu")
				break
			case "apikey":
				setApiKey("")
				setStep("provider")
				break
			case "modelid":
				setModelId("")
				if (selectedProvider === "bedrock") {
					// Bedrock skips the API key step — go back to Bedrock setup
					setStep("bedrock")
				} else {
					setStep("apikey")
				}
				break
			case "baseurl":
				setBaseUrl("")
				setStep("modelid")
				break
			case "openai_codex_auth":
				setStep("menu")
				break
			case "unbiased_auth":
				setStep("menu")
				break
			case "github_copilot_auth":
				setStep("menu")
				break
			case "bedrock":
				setBedrockConfig(null)
				setStep("provider")
				break
			case "import":
				setImportSource(null)
				setStep("menu")
				break
			case "error":
				setErrorMessage("")
				setStep("menu")
				break
			// menu, saving, success - no back action
		}
	}, [step, selectedProvider])

	// Render the auth box content based on current step
	// Note: "menu" step is rendered separately in the main return for proper menuIndex tracking
	const renderAuthContent = () => {
		switch (step) {
			case "provider": {
				return (
					<Box flexDirection="column">
						<Text color={theme.text}>Select a provider</Text>
						<Text> </Text>
						<Box>
							<Text color={theme.muted}>Search: </Text>
							<Text color={theme.text}>{providerSearch}</Text>
							<Text backgroundColor={theme.cursorBg} color={theme.cursorText}> </Text>
						</Box>
						<Text> </Text>
						{showProviderTopIndicator && <Text color={theme.muted}>... {providerVisibleStart} more above</Text>}
						{visibleProviderItems.map((item, i) => {
							const actualIndex = providerVisibleStart + i
							return (
								<Box key={item.value}>
									<Text color={actualIndex === providerIndex ? COLORS.primaryBlue : undefined}>
										{actualIndex === providerIndex ? "❯ " : "  "}
										{item.label}
									</Text>
								</Box>
							)
						})}
						{showProviderBottomIndicator && (
							<Text color={theme.muted}>
								... {providerItems.length - providerVisibleStart - providerVisibleCount} more below
							</Text>
						)}
						{providerItems.length === 0 && <Text color={theme.muted}>No providers match "{providerSearch}"</Text>}
						<Text> </Text>
						<Text color={theme.muted}>Type to search, arrows to navigate, Enter to select, Esc to go back</Text>
					</Box>
				)
			}

			case "apikey":
				return (
					<ApiKeyInput
						isActive={step === "apikey"}
						onCancel={goBack}
						onChange={setApiKey}
						onSubmit={handleApiKeySubmit}
						providerName={getProviderLabel(selectedProvider)}
						value={apiKey}
					/>
				)

			case "modelid":
				// Show model picker for providers with static model lists
				if (hasModelPicker(selectedProvider)) {
					return (
						<Box flexDirection="column">
							<Text color={theme.text}>Select a model</Text>
							<Text> </Text>
							<ModelPicker
								controller={controller}
								isActive={step === "modelid"}
								onChange={setModelId}
								onSubmit={handleModelIdSubmit}
								provider={selectedProvider}
							/>
							<Text> </Text>
							<Text color={theme.muted}>Type to search, arrows to navigate, Enter to select, Esc to go back</Text>
						</Box>
					)
				}
				// Fall back to text input for providers without static model lists
				return (
					<Box flexDirection="column">
						<Text color={theme.text}>Model ID</Text>
						<Text> </Text>
						<Text color={theme.muted}>e.g., claude-sonnet-4-6, gpt-4o</Text>
						<Text> </Text>
						<TextInput onChange={setModelId} onSubmit={handleModelIdSubmit} placeholder="model-id" value={modelId} />
						<Text> </Text>
						<Text color={theme.muted}>Enter to continue, Esc to go back</Text>
					</Box>
				)

			case "baseurl":
				return (
					<Box flexDirection="column">
						<Text color={theme.text}>Base URL (optional)</Text>
						<Text> </Text>
						<Text color={theme.muted}>For self-hosted or proxy endpoints</Text>
						<Text> </Text>
						<TextInput
							onChange={setBaseUrl}
							onSubmit={handleBaseUrlSubmit}
							placeholder="https://api.example.com/v1"
							value={baseUrl}
						/>
						<Text> </Text>
						<Text color={theme.muted}>Enter to skip or continue, Esc to go back</Text>
					</Box>
				)

			case "saving":
				return (
					<Box>
						<Text color={COLORS.primaryBlue}>
							<Spinner type="dots" />
						</Text>
						<Text color={theme.text}> Saving configuration...</Text>
					</Box>
				)

			case "openai_codex_auth":
				return (
					<OpenAiCodexAuthView
						onCancel={goBack}
						onComplete={async () => {
							await applyProviderConfig({ providerId: "openai-codex", controller })
							const stateManager = StateManager.get()
							stateManager.setGlobalState("welcomeViewCompleted", true)
							await stateManager.flushPendingState()
							setSelectedProvider("openai-codex")
							setModelId(openAiCodexDefaultModelId)
							setStep("success")
						}}
					/>
				)

			case "unbiased_auth":
				return <UnbiasedAuthView controller={controller} onCancel={goBack} onComplete={async () => {
					const stateManager = StateManager.get()
					stateManager.setGlobalState("welcomeViewCompleted", true)
					await stateManager.flushPendingState()
					setSelectedProvider("unbiased")
					setModelId("pareto")
					setStep("success")
				}} />

			case "github_copilot_auth":
				return (
					<GithubAuthView
						onCancel={goBack}
						onComplete={async () => {
							await applyProviderConfig({ providerId: "github-copilot", controller })
							const stateManager = StateManager.get()
							stateManager.setGlobalState("welcomeViewCompleted", true)
							await stateManager.flushPendingState()
							setSelectedProvider("github-copilot")
							setStep("success")
						}}
					/>
				)

			case "bedrock":
				return (
					<BedrockSetup
						isActive={step === "bedrock"}
						onCancel={() => {
							setBedrockConfig(null)
							setStep("provider")
						}}
						onComplete={handleBedrockComplete}
					/>
				)

			case "bedrock_custom":
				return (
					<BedrockCustomModelFlow
						isActive={step === "bedrock_custom"}
						onCancel={() => setStep("modelid")}
						onComplete={(arn, baseModelId) => {
							setStep("saving")
							saveCustomBedrockConfiguration(arn, baseModelId)
						}}
					/>
				)

			case "import":
				if (!importSource) {
					return null
				}
				return <ImportView onCancel={handleImportCancel} onComplete={handleImportComplete} source={importSource} />

			case "error":
				return (
					<Box flexDirection="column">
						<Text bold color={theme.error}>
							Something went wrong
						</Text>
						<Text> </Text>
						<Text color={theme.warning}>{errorMessage}</Text>
						<Text> </Text>
						<Select items={errorMenuItems} onSelect={handleErrorMenuSelect} />
					</Box>
				)

			default:
				return null
		}
	}

	// For menu step, we need to handle input at the top level
	const { isRawModeSupported } = useStdinContext()
	const [menuIndex, setMenuIndex] = useState(0)

	// Steps that allow going back with escape (apikey handled by ApiKeyInput component)
	// OcaEmployeeCheck handles its own escape key, so oca_employee_check is not in this list
	const canGoBack = [
		"provider",
		"modelid",
		"baseurl",
		"bedrock",
		"error",
	].includes(step)

	useInput(
		(input, key) => {
			// Handle escape to go back (except on menu)

			if (key.escape && canGoBack) {
				goBack()
				return
			}

			if (step === "menu") {
				if (key.upArrow) {
					setMenuIndex((prev) => (prev > 0 ? prev - 1 : mainMenuItems.length - 1))
				} else if (key.downArrow) {
					setMenuIndex((prev) => (prev < mainMenuItems.length - 1 ? prev + 1 : 0))
				} else if (key.return) {
					handleMainMenuSelect(mainMenuItems[menuIndex].value)
				}
			} else if (step === "provider") {
				if (key.upArrow) {
					setProviderIndex((prev) => (prev > 0 ? prev - 1 : providerItems.length - 1))
				} else if (key.downArrow) {
					setProviderIndex((prev) => (prev < providerItems.length - 1 ? prev + 1 : 0))
				} else if (key.return) {
					if (providerItems[providerIndex]) {
						handleProviderSelect(providerItems[providerIndex].value)
					}
				} else if (key.backspace || key.delete) {
					setProviderSearch((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					setProviderSearch((prev) => prev + input)
				}
			}
			// Note: modelid step input is handled by ModelPicker component
		},
		{ isActive: isRawModeSupported && (step === "menu" || step === "provider" || canGoBack) },
	)

	return (
		<Box flexDirection="column" paddingLeft={1} paddingRight={1} width="100%">
			{/* Dirac robot - centered */}
			<StaticRobotFrame />

			<Box justifyContent="center" marginTop={1} paddingX={4}>
				<Text color={theme.info} italic>
					“{quote}”
				</Text>
			</Box>

			{/* Auth box with border */}
			<Box
				borderColor={theme.border}
				borderStyle="round"
				flexDirection="column"
				marginTop={1}
				paddingBottom={1}
				paddingLeft={2}
				paddingRight={2}
				paddingTop={1}>
				{step === "menu" ? (
					<Box flexDirection="column">
						<Text color={theme.muted}>How would you like to get started?</Text>
						<Text> </Text>
						{mainMenuItems.map((item, index) => (
							<Box key={item.value}>
								<Text>
									<Text color={index === menuIndex ? COLORS.primaryBlue : undefined}>
										{index === menuIndex ? "❯ " : "  "}
										{item.label}
									</Text>
								</Text>
							</Box>
						))}
						<Text> </Text>
						<Text color={theme.muted}>Use arrow keys, Enter to select</Text>
					</Box>
				) : (
					renderAuthContent()
				)}
			</Box>
		</Box>
	)
}
```

### /Users/highlands/pools/Development/dirac/cli/src/components/ApiKeyInput.tsx (lines 22-75)
```
export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
	providerName,
	value,
	onChange,
	onSubmit,
	onCancel,
	isActive = true,
}) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			// Filter out mouse escape sequences
			if (shouldIgnoreTerminalInput(input, key)) {
				return
			}

			if (key.escape) {
				onCancel()
				return
			}
			if (key.return) {
				onSubmit(value)
				return
			}
			if (key.backspace || key.delete) {
				onChange(value.slice(0, -1))
				return
			}
			if (input && !key.ctrl && !key.meta) {
				onChange(value + input)
			}
		},
		{ isActive: isRawModeSupported && isActive },
	)

	return (
		<Box flexDirection="column">
			<Text bold color={COLORS.primaryBlue}>
				{providerName} API Key
			</Text>
			<Box marginTop={1}>
				<Text color={theme.muted}>Paste your API key below</Text>
			</Box>
			<Box marginTop={1}>
				<Text color={theme.text}>{"•".repeat(value.length)}</Text>
				<Text backgroundColor={theme.cursorBg} color={theme.cursorText}> </Text>
			</Box>
			<Box marginTop={1}>
				<Text color={theme.muted}>Enter to save, Esc to cancel</Text>
			</Box>
		</Box>
	)
}
```


## Source Files:

- `cli/src/components/ActionButtons.tsx`
- `cli/src/components/AgentPanelContent.tsx`
- `cli/src/components/ApiKeyInput.tsx`
- `cli/src/components/App.tsx`
- `cli/src/components/AsciiMotionCli.tsx`
- `cli/src/components/AuthView.tsx`
- `cli/src/components/BedrockCustomModelFlow.tsx`
- `cli/src/components/BedrockSetup.tsx`
- `cli/src/components/ChatFooter.tsx`
- `cli/src/components/ChatHeader.tsx`
- `cli/src/components/ChatInputBar.tsx`
- `cli/src/components/ChatMessage.tsx`
- `cli/src/components/ChatView.tsx`
- `cli/src/components/Checkbox.tsx`
- `cli/src/components/ConfigView.tsx`
- `cli/src/components/ConfigViewComponents.tsx`
- `cli/src/components/ConfigViewWrapper.tsx`
- `cli/src/components/ErrorBoundary.tsx`
- `cli/src/components/FileMentionMenu.tsx`
- `cli/src/components/GithubAuthView.tsx`
- `cli/src/components/GoalSummary.tsx`
- `cli/src/components/HelpPanelContent.tsx`
- `cli/src/components/HighlightedInput.tsx`
- `cli/src/components/HistoryPanelContent.tsx`
- `cli/src/components/HistoryView.tsx`
- `cli/src/components/ImportView.tsx`
- `cli/src/components/LanguagePicker.tsx`
- `cli/src/components/ModelPicker.tsx`
- `cli/src/components/OpenAiCodexAuthView.tsx`
- `cli/src/components/OpenAiCodexUsagePanel.tsx`
- `cli/src/components/Panel.tsx`
- `cli/src/components/PermissionModal.tsx`
- `cli/src/components/ProviderPicker.tsx`
- `cli/src/components/SearchableList.tsx`
- `cli/src/components/SkillsPanelContent.tsx`
- `cli/src/components/SlashCommandMenu.tsx`
- `cli/src/components/Spinner.tsx`
- `cli/src/components/ThinkingIndicator.tsx`
- `cli/src/components/UnbiasedAuthView.tsx`
- `cli/src/components/modular-ui/CardBody.tsx`
- `cli/src/components/modular-ui/CardHeader.tsx`
- `cli/src/components/modular-ui/CardInteractions.tsx`
- `cli/src/components/modular-ui/Diff.tsx`
- `cli/src/components/modular-ui/Markdown.tsx`
- `cli/src/components/modular-ui/ModularCard.tsx`
- `cli/src/components/modular-ui/TaskCompletionCard.tsx`
- `cli/src/components/modular-ui/TaskStatusIndicator.tsx`
- `cli/src/components/settings/SettingsHomeView.tsx`
- `cli/src/components/settings/SettingsListView.tsx`
- `cli/src/components/settings/SettingsPanelContent.tsx`
- `cli/src/components/settings/SettingsSearchView.tsx`
- `cli/src/components/settings/UserApprovedCommandsPage.tsx`
- `cli/src/components/settings/constants.ts`
- `cli/src/components/settings/hooks/useAuthStatus.ts`
- `cli/src/components/settings/hooks/useSettingsActions.ts`
- `cli/src/components/settings/hooks/useSettingsItems.ts`
- `cli/src/components/settings/navigation.ts`
- `cli/src/components/settings/settingsTransaction.ts`
- `cli/src/components/settings/subpages/AuthPages.tsx`
- `cli/src/components/settings/subpages/EditPages.tsx`
- `cli/src/components/settings/subpages/OpenRouterRoutingPage.tsx`
- `cli/src/components/settings/subpages/PickerPages.tsx`
- `cli/src/components/settings/subpages/SetupPages.tsx`
- `cli/src/components/settings/types.ts`
- `cli/src/components/settings/utils.ts`

