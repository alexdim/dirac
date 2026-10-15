---
component_id: 5.2.2
component_name: Standalone Terminal Integration
---

# Standalone Terminal Integration

## Component Description

Implements subprocess-based terminal emulation, terminal instance registration, and background command process tracking for non-VSCode standalone environments.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/terminal/standalone/StandaloneTerminalManager.ts (lines 29-302)
```
export class StandaloneTerminalManager implements ITerminalManager {
	/** Registry for tracking terminals */
	private registry: StandaloneTerminalRegistry = new StandaloneTerminalRegistry()

	/** Process manager for spawning commands and tracking background commands */
	private processManager: TerminalProcessManager = new TerminalProcessManager()

	/** Set of terminal IDs managed by this instance */
	private terminalIds: Set<number> = new Set()

	/** Timeout for shell integration (kept for interface compatibility, not used in standalone) */
	private shellIntegrationTimeout = 4000

	/** Whether terminal reuse is enabled */
	private terminalReuseEnabled = true

	/** Maximum output lines to keep */
	private terminalOutputLineLimit: number = DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT

	/** Default terminal profile */
	private defaultTerminalProfile = "default"

	/** Disposables array (for VSCode compatibility) */
	disposables: any[] = []

	// --- Process Spawning (delegated to TerminalProcessManager) ---

	/** Run a command in the specified terminal. */
	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		return this.processManager.runCommand(terminalInfo, command)
	}

	// --- Terminal Lifecycle ---

	/** Get or create a terminal for the specified working directory. */
	async getOrCreateTerminal(cwd: string, env?: { [key: string]: string | undefined }): Promise<TerminalInfo> {
		const terminals = this.registry.getAllTerminals()

		// Find available terminal with matching CWD
		const matchingTerminal = terminals.find((t) => {
			if (t.busy) {
				return false
			}
			return t.terminal._cwd === cwd
		})

		if (matchingTerminal) {
			this.terminalIds.add(matchingTerminal.id)
			return matchingTerminal
		}

		// Find any available terminal if reuse is enabled
		if (this.terminalReuseEnabled) {
			const availableTerminal = terminals.find((t) => !t.busy)
			if (availableTerminal) {
				await this.runCommand(availableTerminal, `cd "${cwd}"`)
				availableTerminal.terminal._cwd = cwd
				availableTerminal.terminal._env = env
				if (availableTerminal.terminal.shellIntegration?.cwd) {
					availableTerminal.terminal.shellIntegration.cwd.fsPath = cwd
				}
				this.terminalIds.add(availableTerminal.id)
				return availableTerminal
			}
		}

		// Create new terminal
		const newTerminalInfo = this.registry.createTerminal({
			cwd: cwd,
			name: `Dirac Terminal ${this.registry.size + 1}`,
			env: env,
		})
		this.terminalIds.add(newTerminalInfo.id)
		return newTerminalInfo
	}

	/** Get terminals filtered by busy state. */
	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		const allTerminalIds = Array.from(this.terminalIds)

		return allTerminalIds
			.map((id) => this.registry.getTerminal(id))
			.filter((t): t is TerminalInfo => t !== undefined && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	// --- Process State Queries (delegated to TerminalProcessManager) ---

	/** Get output that hasn't been retrieved yet from a terminal. */
	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		return this.processManager.getUnretrievedOutput(terminalId)
	}

	/** Check if a terminal's process is actively outputting. */
	isProcessHot(terminalId: number): boolean {
		return this.processManager.isProcessHot(terminalId)
	}

	// --- Output Processing ---

	/** Process output lines, truncating if over limit. */
	processOutput(outputLines: string[], overrideLimit?: number): string {
		const limit = overrideLimit !== undefined ? overrideLimit : this.terminalOutputLineLimit
		if (outputLines.length > limit) {
			const halfLimit = Math.floor(limit / 2)
			const start = outputLines.slice(0, halfLimit)
			const end = outputLines.slice(outputLines.length - halfLimit)
			return `${start.join("\n")}\n... (output truncated) ...\n${end.join("\n")}`.trim()
		}
		return outputLines.join("\n").trim()
	}

	// --- Cleanup ---

	/** Dispose of all terminals and clean up resources. */
	disposeAll(): void {
		// Dispose background commands first
		this.processManager.disposeBackgroundCommands()

		// Terminate all processes
		this.processManager.terminateAll()

		// Clear all tracking
		this.terminalIds.clear()
		this.processManager.clearProcesses()

		// Dispose all terminals
		for (const terminalInfo of this.registry.getAllTerminals()) {
			terminalInfo.terminal.dispose()
		}

		this.registry.clear()
	}

	// --- Configuration Setters ---

	/** Set the timeout for waiting for shell integration. */
	setShellIntegrationTimeout(timeout: number): void {
		this.shellIntegrationTimeout = timeout
	}

	/** Enable or disable terminal reuse. */
	setTerminalReuseEnabled(enabled: boolean): void {
		this.terminalReuseEnabled = enabled
	}

	/** Set the maximum number of output lines to keep. */
	setTerminalOutputLineLimit(limit: number): void {
		this.terminalOutputLineLimit = limit
	}

	/** Set the default terminal profile. Returns info about closed and remaining busy terminals. */
	setDefaultTerminalProfile(profile: string): TerminalProfileChangeResult {
		const previousProfile = this.defaultTerminalProfile
		this.defaultTerminalProfile = profile

		if (previousProfile !== profile) {
			return this.handleTerminalProfileChange(profile)
		}

		return { closedCount: 0, busyTerminals: [] }
	}

	// --- Terminal Management ---

	/** Find a TerminalInfo by its terminal instance. */
	findTerminalInfoByTerminal(terminal: any): TerminalInfo | undefined {
		return this.registry.getAllTerminals().find((t) => t.terminal === terminal)
	}

	/** Check if a terminal's CWD matches its expected pending change. */
	isCwdMatchingExpected(terminalInfo: TerminalInfo): boolean {
		if (!terminalInfo.pendingCwdChange) {
			return false
		}
		const currentCwd = terminalInfo.terminal._cwd
		const targetCwd = terminalInfo.pendingCwdChange
		return currentCwd === targetCwd
	}

	/** Filter terminals based on a provided criteria function. */
	filterTerminals(filterFn: (terminal: TerminalInfo) => boolean): TerminalInfo[] {
		return this.registry.getAllTerminals().filter(filterFn)
	}

	/** Close terminals that match the provided criteria. Returns number of terminals closed. */
	closeTerminals(filterFn: (terminal: TerminalInfo) => boolean, force = false): number {
		const terminalsToClose = this.filterTerminals(filterFn)
		let closedCount = 0

		for (const terminalInfo of terminalsToClose) {
			if (terminalInfo.busy && !force) {
				continue
			}

			this.terminalIds.delete(terminalInfo.id)
			this.processManager.removeProcess(terminalInfo.id)
			terminalInfo.terminal.dispose()
			this.registry.removeTerminal(terminalInfo.id)
			closedCount++
		}

		return closedCount
	}

	/** Handle terminal management when the terminal profile changes. */
	handleTerminalProfileChange(newShellPath: string | undefined): TerminalProfileChangeResult {
		const closedCount = this.closeTerminals((terminal) => !terminal.busy && terminal.shellPath !== newShellPath, false)
		const busyTerminals = this.filterTerminals((terminal) => terminal.busy && terminal.shellPath !== newShellPath)
		return { closedCount, busyTerminals }
	}

	/** Force closure of all terminals (including busy ones). Returns number closed. */
	closeAllTerminals(): number {
		return this.closeTerminals(() => true, true)
	}

	// --- Background Command Tracking (delegated to TerminalProcessManager) ---

	/** Track a command running in the background. */
	trackBackgroundCommand(
		process: TerminalProcessResultPromise,
		command: string,
		existingOutput: string[] = [],
		existingLogFilePath?: string,
		existingOutputReady?: Promise<void>,
	): BackgroundCommand {
		return this.processManager.trackBackgroundCommand(
			process,
			command,
			existingOutput,
			existingLogFilePath,
			existingOutputReady,
		)
	}

	/** Get a specific background command by ID. */
	getBackgroundCommand(id: string): BackgroundCommand | undefined {
		return this.processManager.getBackgroundCommand(id)
	}

	/** Get all tracked background commands. */
	getAllBackgroundCommands(): BackgroundCommand[] {
		return this.processManager.getAllBackgroundCommands()
	}

	/** Get only running background commands. */
	getRunningBackgroundCommands(): BackgroundCommand[] {
		return this.processManager.getRunningBackgroundCommands()
	}

	/** Check if there are any active background commands. */
	hasActiveBackgroundCommands(): boolean {
		return this.processManager.hasActiveBackgroundCommands()
	}

	/** Cancel/terminate a specific background command. */
	cancelBackgroundCommand(id: string): boolean {
		return this.processManager.cancelBackgroundCommand(id)
	}

	/** Get a summary string for environment details. */
	getBackgroundCommandsSummary(): string {
		return this.processManager.getBackgroundCommandsSummary()
	}

	/** Clean up all background command resources. */
	disposeBackgroundCommands(): void {
		this.processManager.disposeBackgroundCommands()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/terminal/standalone/StandaloneTerminalRegistry.ts (lines 16-109)
```
export class StandaloneTerminalRegistry {
	/** Map of terminal ID to terminal info */
	private terminals: Map<number, TerminalInfo> = new Map()

	/** Next available terminal ID */
	private nextId = 1

	/**
	 * Create a new terminal and register it.
	 * @param options Terminal creation options
	 * @returns The created terminal info
	 */
	createTerminal(options: StandaloneTerminalOptions = {}): TerminalInfo {
		const terminal = new StandaloneTerminal(options)
		const id = this.nextId++

		const terminalInfo: TerminalInfo = {
			id: id,
			terminal: terminal as ITerminal,
			busy: false,
			lastCommand: "",
			shellPath: options.shellPath,
			lastActive: Date.now(),
			pendingCwdChange: undefined,
			cwdResolved: undefined,
		}

		this.terminals.set(id, terminalInfo)
		Logger.log(`[StandaloneTerminalRegistry] Created terminal ${id}`)
		return terminalInfo
	}

	/**
	 * Get a terminal by ID.
	 * @param id The terminal ID
	 * @returns The terminal info or undefined if not found
	 */
	getTerminal(id: number): TerminalInfo | undefined {
		return this.terminals.get(id)
	}

	/**
	 * Get all registered terminals.
	 * @returns Array of all terminal info objects
	 */
	getAllTerminals(): TerminalInfo[] {
		return Array.from(this.terminals.values())
	}

	/**
	 * Remove a terminal from the registry and dispose it.
	 * @param id The terminal ID to remove
	 */
	removeTerminal(id: number): void {
		const terminalInfo = this.terminals.get(id)
		if (terminalInfo) {
			terminalInfo.terminal.dispose()
			this.terminals.delete(id)
			Logger.log(`[StandaloneTerminalRegistry] Removed terminal ${id}`)
		}
	}

	/**
	 * Update a terminal's properties.
	 * @param id The terminal ID
	 * @param updates Partial terminal info to update
	 */
	updateTerminal(id: number, updates: Partial<TerminalInfo>): void {
		const terminalInfo = this.terminals.get(id)
		if (terminalInfo) {
			Object.assign(terminalInfo, updates)
		}
	}

	/**
	 * Clear all terminals from the registry.
	 */
	clear(): void {
		for (const terminalInfo of this.terminals.values()) {
			terminalInfo.terminal.dispose()
		}
		this.terminals.clear()
		this.nextId = 1
		Logger.log(`[StandaloneTerminalRegistry] Cleared all terminals`)
	}

	/**
	 * Get the count of registered terminals.
	 * @returns Number of terminals
	 */
	get size(): number {
		return this.terminals.size
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/terminal/standalone/TerminalProcessManager.ts (lines 52-351)
```
export class TerminalProcessManager {
	/** Map of terminal ID to process */
	private processes: Map<number, StandaloneTerminalProcess> = new Map()

	/** Map of background command ID to command info */
	private backgroundCommands: Map<string, BackgroundCommand> = new Map()

	/** Map of background command ID to log file write stream */
	private logStreams: Map<string, fs.WriteStream> = new Map()
	private backgroundLogFinalizers: Map<string, (suffix?: string) => void> = new Map()

	/** Map of background command ID to timeout handle */
	private backgroundTimeouts: Map<string, NodeJS.Timeout> = new Map()

	// =========================================================================
	// Process Spawning
	// =========================================================================

	/** Spawn a command in the specified terminal, returning a merged promise/process object. */
	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command

		const process = new StandaloneTerminalProcess()
		this.processes.set(terminalInfo.id, process)

		process.once("completed", () => {
			terminalInfo.busy = false
		})

		process.once("error", (_error: Error) => {
			terminalInfo.busy = false
		})

		// Create promise that resolves on continue or rejects on error
		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => resolve())
			process.once("error", (error: Error) => reject(error))
		})

		// Run the command immediately (no shell integration wait needed)
		process.run(terminalInfo.terminal, command)

		return mergePromise(process, promise)
	}

	// =========================================================================
	// Process State Queries
	// =========================================================================

	/** Get output that hasn't been retrieved yet from a terminal's process. */
	getUnretrievedOutput(terminalId: number): string {
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	/** Check if a terminal's process is actively outputting. */
	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	// =========================================================================
	// Process Cleanup
	// =========================================================================

	/** Remove a process from tracking (used when closing a terminal). */
	removeProcess(terminalId: number): void {
		this.processes.delete(terminalId)
	}

	/** Terminate all tracked processes. */
	terminateAll(): void {
		for (const [_terminalId, process] of this.processes) {
			if (process?.terminate) {
				process.terminate()
			}
		}
	}

	/** Clear all process tracking (does not terminate — call terminateAll first). */
	clearProcesses(): void {
		this.processes.clear()
	}

	trackBackgroundCommand(
		process: TerminalProcessResultPromise,
		command: string,
		existingOutput: string[] = [],
		existingLogFilePath?: string,
		existingOutputReady: Promise<void> = Promise.resolve(),
	): BackgroundCommand {
		const id = `background-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
		const logFilePath = existingLogFilePath ?? DiracTempManager.createTempFilePath("background")

		const backgroundCommand: BackgroundCommand = {
			id,
			command,
			startTime: Date.now(),
			status: "running",
			logFilePath,
			lineCount: existingOutput.length,
			process,
		}

		const logStream = fs.createWriteStream(logFilePath, { flags: "a" })
		this.logStreams.set(id, logStream)
		const pendingLines: string[] = []
		let backgroundLoggingReady = false
		let finalizationRequested = false
		let finalizationPerformed = false
		let finalizationSuffix = ""

		const onLine = (line: string) => {
			backgroundCommand.lineCount++
			if (backgroundLoggingReady) {
				logStream.write(`${line}\n`)
			} else {
				pendingLines.push(line)
			}
		}
		process.on("line", onLine)

		const performFinalization = () => {
			if (!backgroundLoggingReady || !finalizationRequested || finalizationPerformed) return
			finalizationPerformed = true
			process.off("line", onLine)
			if (finalizationSuffix) logStream.write(finalizationSuffix)
			logStream.end()
			this.logStreams.delete(id)
			this.backgroundLogFinalizers.delete(id)
		}
		const requestFinalization = (suffix = "") => {
			if (finalizationRequested) return
			finalizationRequested = true
			finalizationSuffix = suffix
			setTimeout(performFinalization, 50)
		}
		this.backgroundLogFinalizers.set(id, requestFinalization)

		const markLoggingReady = (handoffError?: unknown) => {
			backgroundLoggingReady = true
			if (handoffError) {
				backgroundCommand.status = "error"
				logStream.write(`\n[LOG_HANDOFF_ERROR] ${getErrorMessage(handoffError)}\n`)
				requestFinalization()
			}
			for (const line of pendingLines) logStream.write(`${line}\n`)
			pendingLines.length = 0
			performFinalization()
		}

		let logReady = existingOutputReady
		if (!existingLogFilePath && existingOutput.length > 0) {
			logReady = logReady.then(
				() =>
					new Promise<void>((resolve, reject) => {
						logStream.write(`${existingOutput.join("\n")}\n`, (error) => (error ? reject(error) : resolve()))
					}),
			)
		}
		void logReady.then(() => markLoggingReady(), (error) => markLoggingReady(error))

		logStream.on("error", () => {
			backgroundCommand.status = "error"
			process.off("line", onLine)
			const timeout = this.backgroundTimeouts.get(id)
			if (timeout) clearTimeout(timeout)
			this.backgroundTimeouts.delete(id)
			this.logStreams.delete(id)
			this.backgroundLogFinalizers.delete(id)
		})

		const timeoutId = setTimeout(() => {
			if (backgroundCommand.status === "running") {
				backgroundCommand.status = "timed_out"
				requestFinalization("\n[TIMEOUT] Process killed after 10 minutes\n")
				if (process?.terminate) process.terminate()
			}
		}, BACKGROUND_COMMAND_TIMEOUT_MS)
		this.backgroundTimeouts.set(id, timeoutId)

		process.on("completed", (details) => {
			if (backgroundCommand.status !== "running") return
			const timeout = this.backgroundTimeouts.get(id)
			if (timeout) clearTimeout(timeout)
			this.backgroundTimeouts.delete(id)
			const exitCode = details?.exitCode
			const signal = details?.signal
			if (typeof exitCode === "number") backgroundCommand.exitCode = exitCode

			if ((typeof exitCode === "number" && exitCode !== 0) || signal) {
				backgroundCommand.status = "error"
				requestFinalization(
					[
						typeof exitCode === "number" && exitCode !== 0
							? `\n[EXIT_CODE] Process exited with code ${exitCode}\n`
							: "",
						signal ? `\n[SIGNAL] Process terminated by signal ${signal}\n` : "",
					].join(""),
				)
			} else {
				backgroundCommand.status = "completed"
				requestFinalization()
			}
		})

		process.on("error", (error: Error) => {
			if (backgroundCommand.status !== "running") return
			const timeout = this.backgroundTimeouts.get(id)
			if (timeout) clearTimeout(timeout)
			this.backgroundTimeouts.delete(id)
			backgroundCommand.status = "error"
			const exitCodeMatch = error.message.match(/exit code (\d+)/)
			if (exitCodeMatch) backgroundCommand.exitCode = Number.parseInt(exitCodeMatch[1], 10)
			requestFinalization()
		})

		this.backgroundCommands.set(id, backgroundCommand)
		return backgroundCommand
	}

	/** Get a specific background command by ID. */
	getBackgroundCommand(id: string): BackgroundCommand | undefined {
		return this.backgroundCommands.get(id)
	}

	/** Get all tracked background commands. */
	getAllBackgroundCommands(): BackgroundCommand[] {
		return Array.from(this.backgroundCommands.values())
	}

	/** Get only running background commands. */
	getRunningBackgroundCommands(): BackgroundCommand[] {
		return this.getAllBackgroundCommands().filter((c) => c.status === "running")
	}

	/** Check if there are any active background commands. */
	hasActiveBackgroundCommands(): boolean {
		return this.getRunningBackgroundCommands().length > 0
	}

	/** Cancel/terminate a specific background command. Returns true if cancelled, false if not found or already completed. */
	cancelBackgroundCommand(id: string): boolean {
		const command = this.backgroundCommands.get(id)
		if (!command || command.status !== "running") {
			return false
		}

		// Clear timeout
		const timeout = this.backgroundTimeouts.get(id)
		if (timeout) {
			clearTimeout(timeout)
			this.backgroundTimeouts.delete(id)
		}

		// Close the log after any foreground-output handoff has finished.
		this.backgroundLogFinalizers.get(id)?.("\n[CANCELLED] Command cancelled by user\n")
		this.backgroundLogFinalizers.delete(id)

		// Terminate process
		if (command.process?.terminate) {
			command.process.terminate()
		}

		command.status = "error"
		return true
	}

	/** Get a summary string for environment details showing running background commands. */
	getBackgroundCommandsSummary(): string {
		const running = this.getRunningBackgroundCommands()
		if (running.length === 0) {
			return ""
		}

		const lines = [`# Background Commands (${running.length} running)`]
		for (const c of running) {
			const duration = Math.round((Date.now() - c.startTime) / 1000 / 60)
			lines.push(`- ${c.command} (running ${duration}m, ${c.lineCount} lines, log: ${c.logFilePath})`)
		}
		return lines.join("\n")
	}

	/** Clean up all background command resources (timeouts, log streams, tracking maps). */
	disposeBackgroundCommands(): void {
		// Clear all timeouts
		for (const [_id, timeout] of this.backgroundTimeouts) {
			clearTimeout(timeout)
		}
		this.backgroundTimeouts.clear()

		// Request orderly closure after any pending output handoff is complete.
		for (const finalizeLog of this.backgroundLogFinalizers.values()) finalizeLog()
		this.backgroundLogFinalizers.clear()

		// Clear command tracking
		this.backgroundCommands.clear()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/terminal/standalone/StandaloneTerminalProcess.ts (lines 39-354)
```
export class StandaloneTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	/** We don't need to wait since we control the process directly */
	waitForShellIntegration = false

	/** Whether we're actively listening for output */
	isListening = true

	/** Buffer for incomplete lines */
	private buffer = ""

	/** Full output captured from the process */
	private fullOutput = ""

	/** Index of last retrieved output position */
	private lastRetrievedIndex = 0

	/** Whether the process is actively outputting */
	isHot = false

	/** Timer for tracking hot state */
	private hotTimer: NodeJS.Timeout | null = null

	/** The spawned child process */
	private childProcess: ChildProcess | null = null

	/** Exit code from the process */
	private exitCode: number | null = null

	/** Exit signal from the process */
	private signal: NodeJS.Signals | null = null

	/** Whether the process has completed */
	private isCompleted = false

	/** Detected shell info */
	private shellInfo: ShellInfo = detectBestShell()

	constructor() {
		super()
	}

	/**
	 * Run a command in the terminal.
	 * @param terminal The terminal instance to run in
	 * @param command The command to execute
	 */
	async run(terminal: ITerminal, command: string): Promise<void> {
		// Get shell and working directory from terminal
		const shell = (terminal as any)._shellPath || this.shellInfo.path
		const cwd = (terminal as any)._cwd || process.cwd()

		// Prepare command for execution
		const shellArgs = getShellArgs(this.shellInfo, command)

		try {
			// Create shell options
			const shellOptions: {
				cwd: string
				stdio: ["ignore", "pipe", "pipe"]
				env: NodeJS.ProcessEnv
				shell?: boolean
			} = {
				cwd: cwd,
				stdio: ["ignore", "pipe", "pipe"], // Disable STDIN to prevent interactivity
				env: {
					...process.env,
					...(terminal as any)._env,
					TERM: "xterm-256color",
					PAGER: "cat", // Prevent less from being used, reducing interactivity
					EDITOR: process.env.EDITOR || "cat", // Set EDITOR if not already set
					GIT_PAGER: "cat", // Prevent git from using less
					SYSTEMD_PAGER: "", // Disable systemd pager
					MANPAGER: "cat", // Disable man pager
				},
			}

			// Enable the shell option for "cmd.exe" to prevent double quotes from being over escaped
			if (shell.toLowerCase().includes("cmd")) {
				shellOptions.shell = true

				// Spawn the process with special handling for "cmd.exe"
				this.childProcess = spawn("cmd.exe", shellArgs, shellOptions)
			} else {
				// Spawn the process with detached: true to create a process group
				// This allows us to kill the entire process tree when terminating
				this.childProcess = spawn(shell, shellArgs, {
					...shellOptions,
					detached: true,
				})
			}

			// Track process state
			let didEmitEmptyLine = false

			// Handle stdout
			this.childProcess.stdout?.on("data", (data: Buffer) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "") // Signal start of output
					didEmitEmptyLine = true
				}
			})

			// Handle stderr
			this.childProcess.stderr?.on("data", (data: Buffer) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "")
					didEmitEmptyLine = true
				}
			})

			// Handle process completion
			this.childProcess.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
				this.exitCode = code
				this.signal = signal
				this.isCompleted = true
				this.emitRemainingBuffer()

				// Clear hot timer
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
					this.isHot = false
				}

				// Track terminal execution telemetry with exit code for failure diagnosis
				const success = code === 0 || code === null
				telemetryService.captureTerminalExecution(success, "standalone", "child_process", code)

				this.emit("completed", { exitCode: this.exitCode, signal: this.signal })
				this.emit("continue")
			})

			// Handle process errors (spawn failures)
			this.childProcess.on("error", (error: Error) => {
				// Track terminal execution error telemetry
				// method: "child_process_error" already indicates spawn failure
				telemetryService.captureTerminalExecution(false, "standalone", "child_process_error")
				this.emit("error", error)
			})

			// Update terminal's process reference
			;(terminal as any)._process = this.childProcess
			;(terminal as any)._processId = this.childProcess.pid
		} catch (error) {
			this.emit("error", error)
		}
	}

	/**
	 * Handle output from the process.
	 * @param data The output data
	 * @param _didEmitEmptyLine Whether we've already emitted an empty line
	 */
	private handleOutput(data: string, _didEmitEmptyLine: boolean): void {
		// Set process as hot (actively outputting)
		this.isHot = true
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		// Check for compilation markers to adjust hot timeout
		const isCompiling = isCompilingOutput(data)
		const hotTimeout = isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL
		this.hotTimer = setTimeout(() => {
			this.isHot = false
		}, hotTimeout)

		// Store full output with size cap to prevent memory exhaustion
		this.fullOutput += data

		// Cap fullOutput at MAX_FULL_OUTPUT_SIZE to prevent memory exhaustion
		if (this.fullOutput.length > MAX_FULL_OUTPUT_SIZE) {
			// Keep last half of max size
			this.fullOutput = this.fullOutput.slice(-MAX_FULL_OUTPUT_SIZE / 2)
			// Reset lastRetrievedIndex since we truncated the beginning
			this.lastRetrievedIndex = 0
		}

		if (this.isListening) {
			this.emitLines(data)
		}
	}

	/**
	 * Emit lines from the buffer.
	 * @param chunk The chunk of data to process
	 */
	private emitLines(chunk: string): void {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	/**
	 * Emit any remaining content in the buffer.
	 */
	private emitRemainingBuffer(): void {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	/**
	 * Continue execution without waiting for completion.
	 * Emits "continue" event but keeps emitting "line" events for background tracking.
	 *
	 * Note: We intentionally do NOT call removeAllListeners("line") or set isListening=false
	 * because background command tracking needs to continue receiving output lines
	 * after the user clicks "Proceed While Running".
	 */
	continue(): void {
		this.emitRemainingBuffer()
		// Keep isListening = true so we continue emitting "line" events
		// This is needed for background command tracking to log output to file
		this.emit("continue")
	}

	/**
	 * Get output that hasn't been retrieved yet.
	 * Truncates if output is too large to prevent context window overflow.
	 * @returns The unretrieved output (truncated if necessary)
	 */
	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length

		// Truncate if too many lines to prevent context overflow
		const lines = unretrieved.split("\n")
		if (lines.length > MAX_UNRETRIEVED_LINES) {
			const first = lines.slice(0, 10) // TRUNCATE_KEEP_LINES is 10
			const last = lines.slice(-10)
			const skipped = lines.length - first.length - last.length
			return this.removeLastLineArtifacts([...first, `\n... (${skipped} lines truncated) ...\n`, ...last].join("\n"))
		}

		return this.removeLastLineArtifacts(unretrieved)
	}

	getCompletionDetails(): TerminalCompletionDetails {
		return {
			exitCode: this.exitCode,
			signal: this.signal,
		}
	}

	/**
	 * Remove shell prompt artifacts from the end of output.
	 * @param output The output to clean
	 * @returns Cleaned output
	 */
	private removeLastLineArtifacts(output: string): string {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}

	/**
	 * Get the default shell for the current platform.
	 * @returns The default shell path
	 */
	private getDefaultShell(): string {
		return this.shellInfo.path
	}

	/**
	 * Get shell arguments for executing a command.
	 * @param shell The shell path
	 * @param command The command to execute
	 * @returns Array of shell arguments
	 */
	private getShellArgs(shell: string, command: string): string[] {
		return getShellArgs(this.shellInfo, command)
	}

	/**
	 * Terminate the process and all its children.
	 *
	 * Uses terminateProcessTree utility which handles:
	 * - Cross-platform process tree termination via tree-kill
	 * - Graceful shutdown with SIGTERM
	 * - SIGKILL fallback after 2 second timeout
	 */
	async terminate(): Promise<void> {
		if (!this.childProcess || this.isCompleted) {
			return
		}

		const pid = this.childProcess.pid
		if (!pid) {
			// Fallback: try to kill the process directly if PID is unavailable
			this.childProcess.kill("SIGTERM")
			return
		}

		await terminateProcessTree({
			pid,
			childProcess: this.childProcess,
			isCompleted: () => this.isCompleted,
		})
	}
}
```


## Source Files:

- `src/integrations/terminal/standalone/StandaloneTerminal.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalManager.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalProcess.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalRegistry.ts`
- `src/integrations/terminal/standalone/TerminalProcessManager.ts`
- `src/integrations/terminal/types.ts`

