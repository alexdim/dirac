---
component_id: 4.3
component_name: Host Provider & VS Code Terminal Execution
---

# Host Provider & VS Code Terminal Execution

## Component Description

Manages the singleton HostProvider facade, VS Code terminal lifecycle and command execution, and native VS Code language model integration.

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

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/terminal/VscodeTerminalLifecycleManager.ts (lines 22-51)
```
	async getOrCreateTerminal(cwd: string, env?: { [key: string]: string | undefined }): Promise<RegTerminalInfo> {
		if (!env) {
			env = await getPythonEnvironmentVariables(vscode.Uri.file(cwd))
		}

		const expectedShellPath =
			this.options.defaultTerminalProfile !== "default"
				? getShellForProfile(this.options.defaultTerminalProfile)
				: undefined

		const allTerminals = TerminalRegistry.getAllTerminals()
		Logger.log(`[TerminalLifecycleManager] Looking for terminal in cwd: ${cwd}`)
		Logger.log(`[TerminalLifecycleManager] Available terminals: ${allTerminals.length}`)

		const matchingTerminal = this.findMatchingTerminal(allTerminals, expectedShellPath, cwd)
		if (matchingTerminal) {
			Logger.log(`[TerminalLifecycleManager] Found matching terminal ${matchingTerminal.id} in correct cwd`)
			return matchingTerminal as unknown as RegTerminalInfo
		}

		if (this.options.terminalReuseEnabled) {
			const availableTerminal = this.findAvailableTerminal(allTerminals, expectedShellPath)
			if (availableTerminal) {
				return await this.reuseTerminalWithCwd(availableTerminal, cwd)
			}
		}

		const newTerminalInfo = TerminalRegistry.createTerminal(cwd, expectedShellPath, env)
		return newTerminalInfo as unknown as RegTerminalInfo
	}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/terminal/VscodeTerminalRegistry.ts (lines 24-56)
```
	static createTerminal(
		cwd?: string | vscode.Uri | undefined,
		shellPath?: string,
		env?: { [key: string]: string | undefined },
	): TerminalInfo {
		const terminalOptions: vscode.TerminalOptions = {
			cwd,
			name: "Dirac",
			iconPath: getDiracIconUri(),
			env: {
				DIRAC_ACTIVE: "true",
				...env,
			},
		}

		// If a specific shell path is provided, use it
		if (shellPath) {
			terminalOptions.shellPath = shellPath
		}

		const terminal = vscode.window.createTerminal(terminalOptions)
		TerminalRegistry.nextTerminalId++
		const newInfo: TerminalInfo = {
			terminal,
			busy: false,
			lastCommand: "",
			id: TerminalRegistry.nextTerminalId,
			shellPath,
			lastActive: Date.now(),
		}
		TerminalRegistry.terminals.push(newInfo)
		return newInfo
	}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/vscode-lm.ts (lines 284-431)
```
	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: DiracTool[]): ApiStream {
		// Ensure clean state before starting a new request
		this.ensureCleanState()
		const client: vscode.LanguageModelChat = await this.getClient()

		// Clean system prompt and messages
		const cleanedSystemPrompt = this.cleanTerminalOutput(systemPrompt)
		const cleanedMessages = messages.map((msg) => ({
			...msg,
			content: this.cleanMessageContent(msg.content),
		}))

		// Convert Anthropic messages to VS Code LM messages
		const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.Assistant(cleanedSystemPrompt),
			...convertToVsCodeLmMessages(cleanedMessages),
		]

		// Initialize cancellation token for the request
		this.currentRequestCancellation = new vscode.CancellationTokenSource()

		// Calculate input tokens before starting the stream
		const totalInputTokens: number = await this.calculateTotalInputTokens(vsCodeLmMessages)

		// Accumulate the text and count at the end of the stream to reduce token counting overhead.
		let accumulatedText = ""

		try {
			// Create the response stream with minimal required options
			const requestOptions: vscode.LanguageModelChatRequestOptions = {
				justification: `Dirac would like to use '${client.name}' from '${client.vendor}', Click 'Allow' to proceed.`,
				tools: tools?.map((tool: any) => {
					const func = tool.function || tool
					return {
						name: func.name,
						description: func.description,
						inputSchema: func.parameters || func.input_schema,
					}
				}),
			}

			// Note: Tool support is currently provided by the VSCode Language Model API directly
			// Extensions can register tools using vscode.lm.registerTool()

			const response: vscode.LanguageModelChatResponse = await client.sendRequest(
				vsCodeLmMessages,
				requestOptions,
				this.currentRequestCancellation.token,
			)

			// Consume the stream and handle both text and tool call chunks
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					// Validate text part value
					if (typeof chunk.value !== "string") {
						Logger.warn("Dirac <Language Model API>: Invalid text part value received:", chunk.value)
						continue
					}

					accumulatedText += chunk.value
					yield {
						type: "text",
						text: chunk.value,
					}
				} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
					try {
						// Validate tool call parameters
						if (!chunk.name || typeof chunk.name !== "string") {
							Logger.warn("Dirac <Language Model API>: Invalid tool name received:", chunk.name)
							continue
						}

						if (!chunk.callId || typeof chunk.callId !== "string") {
							Logger.warn("Dirac <Language Model API>: Invalid tool callId received:", chunk.callId)
							continue
						}

						// Ensure input is a valid object
						if (!chunk.input || typeof chunk.input !== "object") {
							Logger.warn("Dirac <Language Model API>: Invalid tool input received:", chunk.input)
							continue
						}

						// Log tool call for debugging
						Logger.debug("Dirac <Language Model API>: Processing tool call:", {
							name: chunk.name,
							callId: chunk.callId,
							inputSize: JSON.stringify(chunk.input).length,
						})

						yield {
							type: "tool_calls",
							tool_call: {
								call_id: chunk.callId,
								function: {
									id: chunk.callId,
									name: chunk.name,
									arguments: JSON.stringify(chunk.input),
								},
							},
						}
					} catch (error) {
						Logger.error("Dirac <Language Model API>: Failed to process tool call:", error)
					}
				} else {
					Logger.warn("Dirac <Language Model API>: Unknown chunk type received:", chunk)
				}
			}

			// Count tokens in the accumulated text after stream completion
			const totalOutputTokens: number = await this.countTokens(accumulatedText)

			// Report final usage after stream completion
			yield {
				type: "usage",
				inputTokens: totalInputTokens,
				outputTokens: totalOutputTokens,
				totalCost: calculateApiCostAnthropic(this.getModel().info, totalInputTokens, totalOutputTokens),
			}
		} catch (error: unknown) {
			this.ensureCleanState()

			if (error instanceof vscode.CancellationError) {
				throw new Error("Dirac <Language Model API>: Request cancelled by user")
			}

			if (error instanceof Error) {
				Logger.error("Dirac <Language Model API>: Stream error details:", {
					message: error.message,
					stack: error.stack,
					name: error.name,
				})

				// Return original error if it's already an Error instance
				throw error
			}
			if (typeof error === "object" && error !== null) {
				// Handle error-like objects
				const errorDetails = JSON.stringify(error, null, 2)
				Logger.error("Dirac <Language Model API>: Stream error object:", errorDetails)
				throw new Error(`Dirac <Language Model API>: Response stream error: ${errorDetails}`)
			}
			// Fallback for unknown error types
			const errorMessage = String(error)
			Logger.error("Dirac <Language Model API>: Unknown stream error:", errorMessage)
			throw new Error(`Dirac <Language Model API>: Response stream error: ${errorMessage}`)
		}
	}
```


## Source Files:

- `src/hosts/host-provider.ts`
- `src/hosts/vscode/terminal/VscodeCommandExecutor.ts`
- `src/hosts/vscode/terminal/VscodeShellIntegrationManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalLifecycleManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalProcess.ts`
- `src/hosts/vscode/terminal/VscodeTerminalProfileManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalRegistry.ts`
- `src/hosts/vscode/terminal/ansiUtils.ts`
- `src/hosts/vscode/terminal/get-latest-output.ts`
- `src/hosts/vscode/vscode-lm.ts`

