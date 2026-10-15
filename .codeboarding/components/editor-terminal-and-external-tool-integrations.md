---
component_id: 8
component_name: Editor, Terminal & External Tool Integrations
---

# Editor, Terminal & External Tool Integrations

## Component Description

Integrates editor diff views, file editing, terminal command execution, diagnostics feedback, and external coding assistants such as Claude Code, GitHub Copilot, and OpenAI Codex.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/editor/DiffViewProvider.ts (lines 15-347)
```
export abstract class DiffViewProvider {
	editType?: "create" | "modify" | "delete"
	isEditing = false
	protected documentWasOpen = false
	private preDiagnostics: FileDiagnostics[] = []
	protected relPath?: string
	protected absolutePath?: string
	protected fileEncoding = "utf8"
	protected newContent?: string

	protected fileOpManager?: FileOperationManager
	protected readonly contentManager: DiffContentManager

	constructor(
		private readonly textFileAccess: TextFileAccess = new NodeTextFileAccess(),
		private readonly shouldSaveOpenDocumentBeforeRead = true,
	) {
		this.contentManager = new DiffContentManager()
	}

	public async readText(path: string): Promise<string> {
		await this.saveOpenDocumentBeforeTextRead(path)
		return (await this.textFileAccess.readText(path)).content
	}

	private async saveOpenDocumentBeforeTextRead(path: string): Promise<void> {
		if (!this.shouldSaveOpenDocumentBeforeRead) return
		await HostProvider.workspace.saveOpenDocumentIfDirty({ filePath: path })
	}

	public async open(
		relPath: string,
		options?: { displayPath?: string; editType?: "create" | "modify" | "delete" },
	): Promise<void> {
		const editType = options?.editType ?? this.editType ?? "create"
		await this.reset()

		try {
			const cwd = await getCwd()
			const absolutePathResolved = workspaceResolver.resolveWorkspacePath(cwd, relPath, "DiffViewProvider.open.absolutePath")
			this.absolutePath = typeof absolutePathResolved === "string" ? absolutePathResolved : absolutePathResolved.absolutePath
			this.relPath = options?.displayPath ?? relPath
			this.editType = editType
			this.isEditing = true

			if (editType === "modify") {
				await this.saveOpenDocumentBeforeTextRead(this.absolutePath)
			}

			this.fileOpManager = new FileOperationManager(this.absolutePath, editType, this.textFileAccess)
			await this.fileOpManager.setup()
			this.originalContent = this.fileOpManager.originalContent
			this.fileEncoding = this.fileOpManager.fileEncoding

			const providers = getDiagnosticsProviders()
			this.preDiagnostics = (await Promise.all(providers.map((p) => p.capturePreSaveState()))).flat()
			await this.openDiffEditor()
			await this.scrollEditorToLine(0)
			this.contentManager.reset()
		} catch (error) {
			await this.reset()
			throw error
		}
	}

	get originalContent(): string | undefined {
		return this.fileOpManager?.originalContent
	}

	set originalContent(value: string | undefined) {
		if (this.fileOpManager) {
			this.fileOpManager.originalContent = value
		}
	}

	protected abstract openDiffEditor(): Promise<void>
	protected abstract scrollEditorToLine(line: number): Promise<void>
	protected abstract scrollAnimation(startLine: number, endLine: number): Promise<void>
	protected abstract truncateDocument(lineNumber: number): Promise<void>
	protected abstract getDocumentLineCount(): Promise<number>

	private async safelyTruncateDocument(lineNumber: number): Promise<void> {
		const lineCount = await this.getDocumentLineCount()
		if (lineNumber < lineCount) {
			await this.truncateDocument(lineNumber)
		}
	}

	protected abstract getDocumentText(): Promise<string | undefined>

	private async getNewDiagnosticProblems(postSaveContent?: string): Promise<string> {
		if (!this.absolutePath) {
			return ""
		}
		const providers = getDiagnosticsProviders()
		let newProblemsMessage = ""

		for (const provider of providers) {
			const result = await provider.getDiagnosticsFeedback(this.absolutePath, postSaveContent ?? "", this.preDiagnostics)

			if (result.newProblemsMessage) {
				newProblemsMessage = result.newProblemsMessage
				break
			}
		}
		return newProblemsMessage
	}

	protected abstract saveDocument(): Promise<boolean>
	protected abstract closeAllDiffViews(): Promise<void>
	protected abstract resetDiffView(): Promise<void>

	protected async switchToSpecializedEditor(): Promise<void> {}

	async update(
		accumulatedContent: string,
		isFinal: boolean,
		changeLocation?: { startLine: number; endLine: number; startChar: number; endChar: number },
	) {
		if (!this.isEditing) {
			throw new Error("Not editing any file")
		}

		this.newContent = accumulatedContent
		const result = await this.contentManager.update(
			accumulatedContent,
			isFinal,
			async (content, range) => this.replaceText(content, range, undefined),
			async (line) => this.scrollEditorToLine(line),
			() => this.getDocumentLineCount(),
			async (start, end) => this.scrollAnimation(start, end),
		)

		if (isFinal) {
			await this.safelyTruncateDocument(result.lineCount)
			await this.onFinalUpdate()
			await this.switchToSpecializedEditor()
		}
	}

	protected async onFinalUpdate(): Promise<void> {}

	async showFile(absolutePath: string): Promise<void> {
		await openFile(absolutePath, true)
	}

	abstract replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		currentLine: number | undefined,
	): Promise<void>

	protected isNotebookFile(): boolean {
		return this.relPath?.toLowerCase().endsWith(".ipynb") ?? false
	}

	getOriginalContentForLLM(): string | undefined {
		if (this.fileOpManager?.originalContent === undefined) return undefined
		return this.isNotebookFile()
			? sanitizeNotebookForLLM(this.fileOpManager.originalContent, true)
			: this.fileOpManager.originalContent
	}

	async saveChanges(options?: { skipDiagnostics?: boolean }): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		autoFormattingEdits: string | undefined
		finalContent: string | undefined
	}> {
		const preSaveContent = await this.getDocumentText()

		if (!(await this.saveDocument())) {
			throw new Error(
				`Failed to save changes to ${this.relPath}. The file may be read-only or the save operation was cancelled.`,
			)
		}

		if (!this.relPath || !this.absolutePath || this.newContent === undefined || preSaveContent === undefined) {
			return {
				newProblemsMessage: undefined,
				userEdits: undefined,
				autoFormattingEdits: undefined,
				finalContent: undefined,
			}
		}

		const postSaveContent = (await this.getDocumentText()) ?? ""

		await this.showFile(this.absolutePath)
		await this.closeAllDiffViews()

		let userEdits: string | undefined
		if (this.newContent !== undefined && preSaveContent !== undefined) {
			userEdits = this.contentManager.detectUserEdits(this.newContent, preSaveContent, this.relPath)
		}

		let autoFormattingEdits: string | undefined
		if (preSaveContent !== undefined && postSaveContent !== undefined) {
			autoFormattingEdits = this.contentManager.detectAutoFormattingEdits(preSaveContent, postSaveContent, this.relPath)
		}

		const newProblems = options?.skipDiagnostics ? "" : await this.getNewDiagnosticProblems(postSaveContent)
		const finalContent = this.contentManager.getFinalContent(postSaveContent, this.isNotebookFile())

		const newProblemsMessage =
			newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""
		return {
			newProblemsMessage,
			userEdits,
			autoFormattingEdits,
			finalContent,
		}
	}

	async revertChanges(): Promise<void> {
		if (!this.absolutePath || !this.isEditing) {
			return
		}

		const fileExists = this.editType === "modify"

		try {
			if (!fileExists) {
				await this.saveDocument()
				await this.closeAllDiffViews()
				await this.fileOpManager!.deleteFile()
				Logger.log(`File ${this.absolutePath} has been deleted.`)

				await this.fileOpManager!.deleteCreatedDirs()
			} else {
				const currentContents = await this.getDocumentText()
				if (currentContents !== undefined && this.originalContent !== undefined) {
					const lineCount = (currentContents.match(/\n/g) || []).length + 1
					await this.replaceText(this.originalContent, { startLine: 0, endLine: lineCount }, undefined)
					await this.saveDocument()
					Logger.log(`File ${this.absolutePath} has been reverted to its original content.`)
				} else {
					Logger.log(`Skipping content revert for ${this.absolutePath} as it was not successfully initialized.`)
				}

				if (this.documentWasOpen) {
					openFile(this.absolutePath, true)
				}
				await this.closeAllDiffViews()
			}
		} catch (error) {
			Logger.error(`Failed to revert changes for ${this.absolutePath}:`, error)
			throw error
		} finally {
			await this.reset()
		}
	}

	async scrollToFirstDiff() {
		if (!this.isEditing) {
			return
		}
		await this.contentManager.scrollToFirstDiff(
			this.originalContent ?? "",
			async () => (await this.getDocumentText()) ?? "",
			(line) => this.scrollEditorToLine(line),
		)
	}

	async deleteFile(fileName: string) {
		const fileLocation = this.absolutePath
		if (!fileLocation?.endsWith(fileName) || !this.isEditing) {
			return
		}

		await this.closeAllDiffViews()

		try {
			await this.fileOpManager!.deleteFile()
			Logger.log(`File ${fileLocation} has been deleted.`)
		} catch (error) {
			Logger.error(`Failed to delete file ${fileLocation}:`, error)
			throw error
		}

		this.isEditing = false
		this.newContent = undefined
	}

	async reset() {
		this.isEditing = false
		this.editType = undefined
		this.absolutePath = undefined
		this.relPath = undefined
		this.preDiagnostics = []
		this.fileEncoding = "utf8"
		this.documentWasOpen = false
		this.newContent = undefined
		this.fileOpManager?.reset()
		this.fileOpManager = undefined

		this.contentManager.reset()
		await this.resetDiffView()
	}

	abstract applyAndSaveSilently(
		absolutePath: string,
		content: string,
		editType?: "create" | "modify",
	): Promise<{
		finalContent: string | undefined
		autoFormattingEdits: string | undefined
		userEdits: string | undefined
	}>

	abstract applyAndSaveBatchSilently(files: { path: string; content: string }[]): Promise<
		Map<
			string,
			{
				finalContent: string | undefined
				autoFormattingEdits: string | undefined
				userEdits: string | undefined
			}
		>
	>

	async showReview(
		_files: { absolutePath: string; displayPath: string; content: string; originalContent?: string }[],
	): Promise<void> {}
	async undoUserEdits() {
		if (this.newContent !== undefined) {
			await this.update(this.newContent, true)
		}
	}

	async hideReview(): Promise<void> {}
	abstract format(path: string): Promise<string>
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/terminal/CommandExecutor.ts (lines 45-288)
```
export class CommandExecutor {
	private cwd: string
	private taskId: string
	private ulid: string
	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	private terminalManager: ITerminalManager
	private standaloneManager: StandaloneTerminalManager
	private callbacks: CommandExecutorCallbacks

	// Track the currently executing foreground process for cancellation
	private currentProcess: TerminalProcessResultPromise | null = null

	// Flag to track if the current command was cancelled externally
	private wasCancelledExternally = false

	// Track shell integration warnings to determine when to show background terminal suggestion
	private shellIntegrationWarningTracker: ShellIntegrationWarningTracker = {
		timestamps: [],
		lastSuggestionShown: undefined,
	}

	constructor(config: CommandExecutorConfig, callbacks: CommandExecutorCallbacks) {
		this.cwd = config.cwd
		this.taskId = config.taskId
		this.ulid = config.ulid
		this.terminalExecutionMode = config.terminalExecutionMode
		this.terminalManager = config.terminalManager
		this.callbacks = callbacks

		// When in backgroundExec mode, the terminalManager is already a StandaloneTerminalManager
		// created by Task. We should reuse it so that Task.getEnvironmentDetails() can see
		// the terminals and processes we create (for isHot logic, busy terminals, etc.)
		if (config.terminalExecutionMode === "backgroundExec" && config.terminalManager instanceof StandaloneTerminalManager) {
			// Reuse the same instance that Task is using
			this.standaloneManager = config.terminalManager
			Logger.info(`[CommandExecutor] Reusing Task's StandaloneTerminalManager for backgroundExec mode`)
		} else {
			// Create a standalone manager for background execution support.
			this.standaloneManager = new StandaloneTerminalManager()
			Logger.info(`[CommandExecutor] Created new StandaloneTerminalManager`)

			// Copy settings from the provided terminalManager to ensure consistency
			if ("shellIntegrationTimeout" in config.terminalManager) {
				const tm = config.terminalManager as any
				this.standaloneManager.setShellIntegrationTimeout(tm.shellIntegrationTimeout || 4000)
				this.standaloneManager.setTerminalReuseEnabled(tm.terminalReuseEnabled ?? true)
				this.standaloneManager.setTerminalOutputLineLimit(tm.terminalOutputLineLimit || 500)
			}
		}
	}

	async execute(
		command: string,
		timeoutSeconds: number | undefined,
		options?: CommandExecutionOptions,
	): Promise<CommandExecutionResult> {
		const workspaceCdPrefix = `cd ${this.cwd} && `
		if (command.startsWith(workspaceCdPrefix)) {
			command = command.substring(workspaceCdPrefix.length)
		}

		const useStandalone = options?.useBackgroundExecution || this.terminalExecutionMode === "backgroundExec"
		const manager = useStandalone ? this.standaloneManager : this.terminalManager

		const env = await this.callbacks.getEnvironmentVariables(this.cwd)
		Logger.info(`Executing command in ${useStandalone ? "standalone" : "VSCode"} terminal: ${command}`)

		const terminalInfo = await manager.getOrCreateTerminal(this.cwd, env)
		terminalInfo.terminal.show()
		const process = manager.runCommand(terminalInfo, command)

		this.wasCancelledExternally = false
		this.currentProcess = process
		const clearCurrentProcess = () => {
			this.currentProcess = null
		}
		process.once("completed", clearCurrentProcess)
		process.once("error", clearCurrentProcess)

		const result = await orchestrateCommandExecution(process, manager, this.callbacks, {
			command,
			timeoutSeconds,
			suppressUserInteraction: options?.suppressUserInteraction,
			onProceedWhileRunning: useStandalone
				? (existingOutput: string[], existingLogFilePath?: string, existingOutputReady?: Promise<void>) => {
					const backgroundCmd = this.standaloneManager.trackBackgroundCommand(
						process,
						command,
						existingOutput,
						existingLogFilePath,
						existingOutputReady,
					)
					return {
						logFilePath: backgroundCmd.logFilePath,
						outputReady: existingOutputReady,
						completion: waitForTerminalProcessCompletion(process),
					}
				}
				: undefined,
			showShellIntegrationSuggestion: this.shouldShowBackgroundTerminalSuggestion(),
			terminalType: useStandalone ? "standalone" : "vscode",
		})

		const metadata: CommandExecutionMetadata = {
			completed: result.completed,
			exitCode: result.exitCode,
			signal: result.signal,
			logFilePath: result.logFilePath,
			backgroundCompletion: result.backgroundCompletion,
		}

		if (this.wasCancelledExternally) {
			const outputSoFar =
				result.outputLines.length > 0
					? `\nOutput captured before cancellation:\n${manager.processOutput(result.outputLines)}`
					: ""
			return [true, `Command was cancelled by the user.${outputSoFar}`, metadata]
		}

		return [result.userRejected, result.result, metadata]
	}

	/**
	 * Cancel all running commands (both foreground and background).
	 *
	 * This method cancels:
	 * 1. All detached background commands (those that were "proceeded while running")
	 * 2. The current foreground process (if one is actively running)
	 *
	 * @returns true if any commands were cancelled, false otherwise
	 */
	async cancelBackgroundCommand(): Promise<boolean> {
		let cancelled = false

		// 1. Cancel all detached background commands
		const runningCommands = this.standaloneManager.getRunningBackgroundCommands()
		for (const cmd of runningCommands) {
			if (this.standaloneManager.cancelBackgroundCommand(cmd.id)) {
				cancelled = true
				Logger.info(`Cancelled background command: ${cmd.command}`)
			}
		}

		// 2. Cancel the current foreground process (if any)
		if (this.currentProcess && typeof (this.currentProcess as any).terminate === "function") {
			// Set flag so execute() knows the command was cancelled externally
			this.wasCancelledExternally = true
			const process = this.currentProcess
			try {
				await process.terminate?.()
			} finally {
				if (this.currentProcess === process) this.currentProcess = null
			}
			cancelled = true
			Logger.info("Cancelled foreground command")
		}

		// 3. Update UI state and notify user by modifying existing message
		if (cancelled) {
			this.callbacks.updateBackgroundCommandState(false)

			// Wait for terminal buffers to flush before updating the message
			await new Promise((resolve) => setTimeout(resolve, 300))

			// Find the last command_output message and update it
			const messages = this.callbacks.getDiracMessages()
			const lastCommandOutputIndex = findLastIndex(
				messages,
				(m) => m.content.type === "card" && m.content.card.header === "Command Output",
			)
			if (lastCommandOutputIndex !== -1) {
				const msg = messages[lastCommandOutputIndex]
				if (msg.content.type === "card") {
					const existingText = msg.content.card.body || ""
					const cancellationNotice = "\n\nCommand(s) cancelled by user."
					await this.callbacks.updateDiracMessage(lastCommandOutputIndex, {
						content: {
							...msg.content,
							card: {
								...msg.content.card,
								body: existingText + cancellationNotice,
								status: (await import("@shared/ExtensionMessage")).CardStatus.CANCELLED,
							},
						},
					})
				}
			}
		}

		return cancelled
	}

	/**
	 * Check if there are any active background commands.
	 * Delegates to StandaloneTerminalManager.
	 */
	hasActiveBackgroundCommand(): boolean {
		return this.standaloneManager.hasActiveBackgroundCommands()
	}

	/**
	 * Get a summary of background commands for environment details.
	 * Delegates to StandaloneTerminalManager which tracks multiple commands.
	 */
	getBackgroundCommandSummary(): string | undefined {
		const summary = this.standaloneManager.getBackgroundCommandsSummary()
		return summary || undefined
	}

	/**
	 * Determines whether to show the background terminal suggestion.
	 * Shows suggestion if there have been 3+ shell integration warnings in the last hour,
	 * and we haven't shown the suggestion in the last hour.
	 *
	 * @returns true if the suggestion should be shown, false otherwise
	 */
	private shouldShowBackgroundTerminalSuggestion(): boolean {
		const oneHourAgo = Date.now() - 60 * 60 * 1000

		// Clean old timestamps (older than 1 hour)
		this.shellIntegrationWarningTracker.timestamps = this.shellIntegrationWarningTracker.timestamps.filter(
			(ts) => ts > oneHourAgo,
		)

		// Add current warning
		this.shellIntegrationWarningTracker.timestamps.push(Date.now())

		// Check if we've shown suggestion recently (within last hour)
		if (
			this.shellIntegrationWarningTracker.lastSuggestionShown &&
			Date.now() - this.shellIntegrationWarningTracker.lastSuggestionShown < 60 * 60 * 1000
		) {
			return false
		}

		// Show suggestion if 3+ warnings in last hour
		if (this.shellIntegrationWarningTracker.timestamps.length >= 3) {
			this.shellIntegrationWarningTracker.lastSuggestionShown = Date.now()
			return true
		}

		return false
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/claude-code/run.ts (lines 35-174)
```
export async function* runClaudeCode(options: ClaudeCodeOptions): AsyncGenerator<ClaudeCodeMessage | string> {
	const isSystemPromptTooLong = options.systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH
	const uniqueId = crypto.randomUUID()
	const tempFilePath = path.join(os.tmpdir(), `dirac-system-prompt-${uniqueId}.txt`)
	if (os.platform() === "win32" || isSystemPromptTooLong) {
		// Use a temporary file to prevent ENAMETOOLONG and E2BIG errors
		// https://github.com/anthropics/claude-code/issues/3411#issuecomment-3082068547
		await fs.writeFile(tempFilePath, options.systemPrompt, "utf8")
		options.systemPrompt = tempFilePath
		options.shouldUseFile = true
	}

	const cProcess = runProcess(options, await getCwd())

	const rl = readline.createInterface({
		input: cProcess.stdout,
	})

	const processState: ProcessState = {
		error: null,
		stderrLogs: "",
		exitCode: null,
		partialData: null,
		reachedMaxTurns: false,
	}

	try {
		cProcess.stderr.on("data", (data) => {
			processState.stderrLogs += data.toString()
		})

		cProcess.on("close", (code) => {
			processState.exitCode = code
		})

		cProcess.on("error", (err) => {
			processState.error = err
		})

		for await (const line of rl) {
			if (processState.error) {
				throw processState.error
			}

			if (line.trim()) {
				const chunk = parseChunk(line, processState)

				if (!chunk) {
					continue
				}

				// We cap the run at one turn (see --max-turns below). The CLI reports this with an
				// error_max_turns result and exits non-zero; record it so the exit is treated as a
				// normal completion rather than a failure.
				if (chunk.type === "result" && chunk.subtype === "error_max_turns") {
					processState.reachedMaxTurns = true
				}

				yield chunk
			}
		}

		// We rely on the assistant message. If the output was truncated, it's better having a poorly formatted message
		// from which to extract something, than throwing an error/showing the model didn't return any messages.
		if (processState.partialData && processState.partialData.startsWith(`{"type":"assistant"`)) {
			yield processState.partialData
		}

		const { exitCode } = await cProcess
		if (exitCode !== null && exitCode !== 0) {
			const errorOutput = processState.error?.message || processState.stderrLogs?.trim()
			throw new Error(
				`Claude Code process exited with code ${exitCode}.${errorOutput ? ` Error output: ${errorOutput}` : ""}`,
			)
		}
	} catch (err) {
		// Hitting the one-turn cap makes the CLI exit non-zero after it has already streamed the
		// StructuredOutput tool call and a result event. That is the expected end of a run, so we
		// stop here instead of surfacing it as an error.
		if (processState.reachedMaxTurns) {
			return
		}

		Logger.error(`Error during Claude Code execution:`, err)

		if (processState.stderrLogs.includes("unknown option '--system-prompt-file'")) {
			throw new Error(`The Claude Code executable is outdated. Please update it to the latest version.`, {
				cause: err,
			})
		}

		if (err instanceof Error) {
			if (err.message.includes("ENOENT")) {
				throw new Error(
					`Failed to find the Claude Code executable.
Make sure it's installed and available in your PATH or properly set in your provider settings.`,
					{ cause: err },
				)
			}

			if (err.message.includes("E2BIG")) {
				throw new Error(
					`Executing Claude Code failed due to a long system prompt. The maximum argument length is 131072 bytes. 
Rules and workflows contribute to a longer system prompt, consider disabling some of them temporarily to reduce the length.
Anthropic is aware of this issue and is considering a fix: https://github.com/anthropics/claude-code/issues/3411.
`,
					{ cause: err },
				)
			}

			if (err.message.includes("ENAMETOOLONG")) {
				throw new Error(
					`Executing Claude Code failed due to a long system prompt. Windows has a limit of 8191 characters, which makes the integration with Dirac not work properly.
`,
					{ cause: err },
				)
			}

			// When the command fails, execa throws an error with the arguments, which include the whole system prompt.
			// We want to log that, but not show it to the user.
			const startOfCommand = err.message.indexOf(": ")
			if (startOfCommand !== -1) {
				const messageWithoutCommand = err.message.slice(0, startOfCommand).trim()

				throw new Error(`${messageWithoutCommand}\n${processState.stderrLogs?.trim()}`, { cause: err })
			}
		}

		throw err
	} finally {
		rl.close()
		if (!cProcess.killed) {
			cProcess.kill()
		}

		if (options.shouldUseFile) {
			fs.unlink(tempFilePath).catch(Logger.error)
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/openai-codex/OpenAiCodexUsageService.ts (lines 40-260)
```
export class OpenAiCodexUsageService {
	private snapshot: OpenAiCodexUsageSnapshot | undefined
	private refreshPromise: Promise<OpenAiCodexUsageSnapshot> | undefined
	private lastRefreshAttemptAt = 0
	private generation = 0
	private readonly listeners = new Set<UsageListener>()
	private readonly dependencies: OpenAiCodexUsageServiceDependencies

	constructor(dependencies: Partial<OpenAiCodexUsageServiceDependencies> = {}) {
		this.dependencies = {
			fetch: dependencies.fetch ?? fetch,
			oauthManager: dependencies.oauthManager ?? openAiCodexOAuthManager,
			now: dependencies.now ?? Date.now,
			refreshCacheMs: dependencies.refreshCacheMs ?? DEFAULT_REFRESH_CACHE_MS,
		}
	}

	getSnapshot(): OpenAiCodexUsageSnapshot | undefined {
		return this.snapshot
	}

	refresh(options: { force?: boolean } = {}): Promise<OpenAiCodexUsageSnapshot> {
		if (this.refreshPromise) {
			return this.refreshPromise
		}

		const now = this.dependencies.now()
		if (
			!options.force &&
			this.snapshot &&
			this.lastRefreshAttemptAt > 0 &&
			now - this.lastRefreshAttemptAt < this.dependencies.refreshCacheMs
		) {
			return Promise.resolve(this.snapshot)
		}

		this.lastRefreshAttemptAt = now
		const refreshGeneration = this.generation
		const refreshPromise = this.performRefresh(refreshGeneration).finally(() => {
			if (this.refreshPromise === refreshPromise) {
				this.refreshPromise = undefined
			}
		})
		this.refreshPromise = refreshPromise
		return refreshPromise
	}

	applyRollingUpdate(update: OpenAiCodexRollingUsageUpdate): void {
		const previous = this.snapshot ?? { rateLimits: [] }
		this.snapshot = {
			...mergeOpenAiCodexRollingUsage(previous, update),
			quotaFetchedAt: this.dependencies.now(),
			quotaError: undefined,
		}
		this.notifyListeners()
	}

	applyResponseHeaders(headers: Headers): void {
		const update = parseOpenAiCodexRateLimitHeaders(headers)
		if (update) {
			this.applyRollingUpdate(update)
		}
	}

	applyRateLimitEvent(event: unknown): void {
		const update = parseOpenAiCodexRateLimitEvent(event)
		if (update) {
			this.applyRollingUpdate(update)
		}
	}

	clear(): void {
		this.generation += 1
		this.snapshot = undefined
		this.lastRefreshAttemptAt = 0
		this.refreshPromise = undefined
		this.notifyListeners()
	}

	subscribe(listener: UsageListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	private async performRefresh(refreshGeneration: number): Promise<OpenAiCodexUsageSnapshot> {
		const accessToken = await this.dependencies.oauthManager.getAccessToken()
		if (!accessToken) {
			throw new Error("ChatGPT subscription usage is available after signing in with ChatGPT.")
		}

		const accountId = await this.dependencies.oauthManager.getAccountId()
		const [quotaResponse, activityResponse] = await this.fetchSectionsWithAuthRetry(accessToken, accountId)
		const fetchedAt = this.dependencies.now()
		const [quotaResult, activityResult] = await Promise.allSettled([
			this.normalizeQuotaResponse(quotaResponse, fetchedAt),
			this.normalizeActivityResponse(activityResponse, fetchedAt),
		])

		const previous = this.snapshot
		let next: OpenAiCodexUsageSnapshot = previous ? { ...previous } : { rateLimits: [] }

		if (quotaResult.status === "fulfilled") {
			const quota = quotaResult.value
			next = {
				planType: quota.planType,
				rateLimits: quota.rateLimits,
				credits: quota.credits,
				spendControl: quota.spendControl,
				rateLimitReachedType: quota.rateLimitReachedType,
				resetCreditsAvailable: quota.resetCreditsAvailable,
				quotaFetchedAt: quota.quotaFetchedAt,
				activity: next.activity,
				activityFetchedAt: next.activityFetchedAt,
				activityError: next.activityError,
			}
		} else {
			next.quotaError = this.describeFailure(quotaResult.reason, "ChatGPT subscription quota is unavailable")
		}

		if (activityResult.status === "fulfilled") {
			const activity = activityResult.value
			next.activity = activity.activity
			next.activityFetchedAt = activity.activityFetchedAt
			next.activityError = undefined
		} else {
			next.activityError = this.describeFailure(activityResult.reason, "ChatGPT account activity is unavailable")
		}

		if (refreshGeneration !== this.generation) {
			return this.snapshot ?? { rateLimits: [] }
		}

		this.snapshot = next
		this.notifyListeners()
		return next
	}

	private async fetchSectionsWithAuthRetry(
		accessToken: string,
		accountId: string | null,
	): Promise<[SettledResponse, SettledResponse]> {
		const urls = [OPENAI_CODEX_USAGE_URL, OPENAI_CODEX_ACTIVITY_URL] as const
		const initialResults = await Promise.allSettled(urls.map((url) => this.fetchSection(url, accessToken, accountId)))
		const unauthorizedIndexes = initialResults.flatMap((result, index) =>
			result.status === "fulfilled" && result.value.status === 401 ? [index] : [],
		)

		if (unauthorizedIndexes.length === 0) {
			return initialResults as [SettledResponse, SettledResponse]
		}

		const refreshedToken = await this.dependencies.oauthManager.forceRefreshAccessToken()
		if (!refreshedToken) {
			return initialResults as [SettledResponse, SettledResponse]
		}

		const retriedResults = await Promise.allSettled(
			unauthorizedIndexes.map((index) => this.fetchSection(urls[index], refreshedToken, accountId)),
		)
		const results = [...initialResults]
		unauthorizedIndexes.forEach((originalIndex, retryIndex) => {
			results[originalIndex] = retriedResults[retryIndex]
		})
		return results as [SettledResponse, SettledResponse]
	}

	private fetchSection(url: string, accessToken: string, accountId: string | null): Promise<Response> {
		const headers: Record<string, string> = {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
			originator: "dirac",
			...buildExternalBasicHeaders(),
			...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
		}
		return this.dependencies.fetch(url, { method: "GET", headers })
	}

	private async normalizeQuotaResponse(
		result: SettledResponse,
		fetchedAt: number,
	): Promise<OpenAiCodexUsageSnapshot> {
		const response = this.unwrapResponse(result)
		const payload = await response.json()
		return normalizeOpenAiCodexUsagePayload(payload, fetchedAt)
	}

	private async normalizeActivityResponse(
		result: SettledResponse,
		fetchedAt: number,
	): Promise<Pick<OpenAiCodexUsageSnapshot, "activity" | "activityFetchedAt">> {
		const response = this.unwrapResponse(result)
		const payload = await response.json()
		return normalizeOpenAiCodexActivityPayload(payload, fetchedAt)
	}

	private unwrapResponse(result: SettledResponse): Response {
		if (result.status === "rejected") {
			throw result.reason
		}
		if (!result.value.ok) {
			const statusText = result.value.statusText ? ` ${result.value.statusText}` : ""
			throw new Error(`ChatGPT usage request failed with HTTP ${result.value.status}${statusText}`)
		}
		return result.value
	}

	private describeFailure(error: unknown, fallback: string): string {
		if (error instanceof Error && error.message) {
			return error.message
		}
		return fallback
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			listener(this.snapshot)
		}
	}
}
```


## Source Files:

- `src/integrations/claude-code/message-filter.ts`
- `src/integrations/claude-code/run.ts`
- `src/integrations/claude-code/structured-output.ts`
- `src/integrations/diagnostics/IDiagnosticsProvider.ts`
- `src/integrations/diagnostics/LinterFeedbackProvider.ts`
- `src/integrations/diagnostics/SyntaxFeedbackProvider.ts`
- `src/integrations/diagnostics/getDiagnosticsProviders.ts`
- `src/integrations/diagnostics/index.ts`
- `src/integrations/editor/CommentReviewController.ts`
- `src/integrations/editor/DiffContentManager.ts`
- `src/integrations/editor/DiffViewProvider.ts`
- `src/integrations/editor/FileEditProvider.ts`
- `src/integrations/editor/FileOperationManager.ts`
- `src/integrations/editor/NodeTextFileAccess.ts`
- `src/integrations/editor/TextFileAccess.ts`
- `src/integrations/editor/detect-omission.ts`
- `src/integrations/github-copilot/api.ts`
- `src/integrations/github-copilot/auth.ts`
- `src/integrations/misc/extract-file-content.ts`
- `src/integrations/misc/extract-images.ts`
- `src/integrations/misc/extract-text.ts`
- `src/integrations/misc/link-preview.ts`
- `src/integrations/misc/notebook-utils.ts`
- `src/integrations/misc/open-file.ts`
- `src/integrations/misc/process-files.ts`
- `src/integrations/misc/read-text-file-window.ts`
- `src/integrations/notifications/index.ts`
- `src/integrations/openai-codex/OAuthFlowHandler.ts`
- `src/integrations/openai-codex/OAuthTokenManager.ts`
- `src/integrations/openai-codex/OpenAiCodexUsageService.ts`
- `src/integrations/openai-codex/oauth-shared.ts`
- `src/integrations/openai-codex/oauth.ts`
- `src/integrations/terminal/CommandExecutor.ts`
- `src/integrations/terminal/CommandOrchestrator.ts`
- `src/integrations/terminal/buildResult.ts`
- `src/integrations/terminal/constants.ts`
- `src/integrations/terminal/file-logging.ts`
- `src/integrations/terminal/process-listeners.ts`

