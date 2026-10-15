---
component_id: 6.1.3
component_name: Hook Discovery & Stdio Runner
---

# Hook Discovery & Stdio Runner

## Component Description

Discovers, configures, and executes lifecycle hooks over stdio with workspace security checks.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/hooks/hook-factory.ts (lines 150-258)
```
	override async [exec](input: HookInput): Promise<HookOutput> {
		const startTime = performance.now()
		const taskId = this.taskId // Local const for type narrowing in closures
		const telemetryCtx: HookTelemetryContext = { hookName: this.hookName, source: this.source, toolName: this.toolName }

		// Capture telemetry at the start of individual hook execution
		if (taskId) HookTelemetryRecorder.captureStarted(taskId, telemetryCtx)

		// Check if already aborted before starting
		if (this.abortSignal?.aborted) throw HookExecutionError.cancellation(this.scriptPath)

		let launchPath = this.scriptPath
		let snapshotDir: string | undefined
		if (this.source === "workspace") {
			if (!this.cwd) return HookOutput.create({ cancel: false })
			const approved = await approvedWorkspaceCode(this.cwd, this.scriptPath, undefined, true)
			if (!approved) return HookOutput.create({ cancel: false })
			const base = path.join(HostProvider.get().globalStorageFsPath, "security", "hook-snapshots")
			await fs.mkdir(base, { recursive: true })
			snapshotDir = await fs.mkdtemp(path.join(base, "hook-"))
			launchPath = path.join(snapshotDir, path.basename(this.scriptPath))
			await fs.writeFile(launchPath, approved.source, { mode: 0o700 })
		}

		// Serialize input to JSON — manually construct to preserve empty string fields (proto3 omits defaults)
		const jsonObj = HookInput.toJSON(input) as Record<string, any>
		if (jsonObj.userPromptSubmit && jsonObj.userPromptSubmit.prompt === undefined) {
			jsonObj.userPromptSubmit.prompt = ""
		}
		const inputJson = JSON.stringify(jsonObj)

		// Create HookProcess for execution with streaming
		const hookProcess = new HookProcess(launchPath, HOOK_EXECUTION_TIMEOUT_MS, this.abortSignal, this.cwd)
		if (this.streamCallback) {
			const callback = this.streamCallback
			hookProcess.on("line", (line: string, stream: "stdout" | "stderr") => {
				// NOTE: HookProcess emits a synthetic empty line ("") as a "start of output" marker — preserve it
				callback(line, stream, { source: this.source, scriptPath: this.scriptPath })
			})
		}

		try {
			await hookProcess.run(inputJson)

			const stdout = hookProcess.getStdout()
			const stderr = hookProcess.getStderr()
			const exitCode = hookProcess.getExitCode()

			// Parse JSON output from stdout (handles mixed debug output and validation)
			const parsedOutput = HookResponseParser.parse(stdout, this.hookName)

			// If we have valid JSON, honor it regardless of exit code
			if (parsedOutput) {
				const durationMs = performance.now() - startTime

				// Log warning if non-zero exit but valid JSON (for developers)
				if (exitCode !== 0) {
					Logger.warn(`[Hook ${this.hookName}] Exited with code ${exitCode} but provided valid JSON response`)
					if (stderr) Logger.warn(`[Hook ${this.hookName}] stderr: ${stderr}`)
				}

				// Capture success/cancellation telemetry
				if (taskId) HookTelemetryRecorder.captureCompleted(taskId, telemetryCtx, parsedOutput, exitCode, durationMs)

				return parsedOutput
			}

			// No valid JSON found — hook succeeded but didn't provide JSON, allow execution
			if (exitCode === 0) {
				Logger.warn(`[Hook ${this.hookName}] Completed successfully but no JSON response found`)
				const durationMs = performance.now() - startTime
				if (taskId) HookTelemetryRecorder.captureNoJson(taskId, telemetryCtx, durationMs)
				return HookOutput.create({ cancel: false })
			}

			// Hook failed with non-zero exit — include hook name in error
			throw HookExecutionError.execution(this.scriptPath, exitCode ?? 1, stderr, this.hookName)
		} catch (error) {
			const durationMs = performance.now() - startTime

			// If it's already a HookExecutionError, capture telemetry and re-throw
			if (HookExecutionError.isHookError(error)) {
				if (taskId) HookTelemetryRecorder.captureHookError(taskId, telemetryCtx, error, durationMs)
				throw error
			}

			// Hook execution failed — categorize the error
			const stderr = hookProcess.getStderr()
			const exitCode = hookProcess.getExitCode()

			// Check for timeout
			if (error instanceof Error && error.message.includes("timed out")) {
				if (taskId) HookTelemetryRecorder.captureTimeout(taskId, telemetryCtx, durationMs, error)
				throw HookExecutionError.timeout(this.scriptPath, HOOK_EXECUTION_TIMEOUT_MS, stderr, this.hookName)
			}

			// Check for cancellation
			if (error instanceof Error && error.message.includes("cancelled")) {
				if (taskId) HookTelemetryRecorder.captureCancellation(taskId, telemetryCtx)
				throw HookExecutionError.cancellation(this.scriptPath, this.hookName)
			}

			// Generic execution error — include hook name
			if (taskId) HookTelemetryRecorder.captureGenericError(taskId, telemetryCtx, durationMs, exitCode, error)
			throw HookExecutionError.execution(this.scriptPath, exitCode ?? 1, stderr, this.hookName)
		} finally {
			if (snapshotDir) await fs.rm(snapshotDir, { recursive: true, force: true })
		}
	}
```


## Source Files:

- `src/core/hooks/HookConfigBuilder.ts`
- `src/core/hooks/HookDiscoveryCache.ts`
- `src/core/hooks/hook-factory.ts`
- `src/core/hooks/utils.ts`

