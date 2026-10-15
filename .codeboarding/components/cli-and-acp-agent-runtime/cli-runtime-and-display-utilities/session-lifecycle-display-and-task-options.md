---
component_id: 2.2.2
component_name: Session Lifecycle, Display & Task Options
---

# Session Lifecycle, Display & Task Options

## Component Description

Manages CLI task option application, plain-text task execution, console and card display formatting, slash command filtering, clipboard access, and process lifecycle cleanup.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/utils/options.ts (lines 58-263)
```
export async function applyTaskOptions(options: TaskOptions, workspaceRoot: string, controller: Controller): Promise<void> {
	const { StateManager } = await import("@/core/storage/StateManager")
	const { telemetryService } = await import("@/services/telemetry")
	const { getProviderModelIdKey } = await import("@/shared/storage")
	const { printWarning, printError, printInfo } = await import("./display")
	const { exit } = await import("node:process")

	const stateManager = StateManager.get()

	try {
		const toolSelectionPolicy = await applyToolSelectionOptions(options, workspaceRoot)
		if (toolSelectionPolicy) controller.setTaskInitializationDefaults({ toolSelectionPolicy })
	} catch (error) {
		printError(`Error: ${error instanceof Error ? error.message : String(error)}`)
		exit(1)
	}

	if (process.env.OPENAI_COMPATIBLE_CUSTOM_KEY) {
		if (!options.provider && !process.env.OPENAI_API_BASE && !stateManager.getGlobalSettingsKey("openAiBaseUrl")) {
			printError("Error: OPENAI_COMPATIBLE_CUSTOM_KEY requires --provider (base URL) or OPENAI_API_BASE to be specified.")
			exit(1)
		}
		if (
			!options.model &&
			!stateManager.getGlobalSettingsKey("actModeOpenAiModelId") &&
			!stateManager.getGlobalSettingsKey("planModeOpenAiModelId")
		) {
			printError("Error: OPENAI_COMPATIBLE_CUSTOM_KEY requires --model to be specified.")
			exit(1)
		}
	}

	// Apply mode flag first so currentMode is correct for overrides
	if (options.plan) {
		stateManager.setSessionOverride("mode", "plan")
		telemetryService.captureHostEvent("mode_flag", "plan")
	} else if (options.act) {
		stateManager.setSessionOverride("mode", "act")
		telemetryService.captureHostEvent("mode_flag", "act")
	}

	// Validate provider/model combination
	if (options.provider && !options.model) {
		printError("Error: --provider requires --model to be specified.")
		exit(1)
	}

	// Apply model override if specified
	if (options.model) {
		const currentMode = (stateManager.getGlobalSettingsKey("mode") || "act") as "act" | "plan"

		if (options.provider) {
			await validateProvider(options.provider)
		}

		// Determine the target provider based on current mode or explicit flag
		let targetProvider: ApiProvider
		if (options.provider && (options.provider.startsWith("http://") || options.provider.startsWith("https://"))) {
			targetProvider = "openai"
			stateManager.setSessionOverride("openAiBaseUrl", options.provider)
		} else {
			const providerKey = currentMode === "act" ? "actModeApiProvider" : "planModeApiProvider"
			targetProvider = (options.provider as ApiProvider) || (stateManager.getGlobalSettingsKey(providerKey) as ApiProvider)
		}

		await setModeScopedState(currentMode, (mode) => {
			const pKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"

			// Ensure the provider is synced if setModeScopedState calls us for multiple modes
			stateManager.setSessionOverride(pKey, targetProvider)

			const modelKey = getProviderModelIdKey(targetProvider, mode)
			if (modelKey) {
				stateManager.setSessionOverride(modelKey, options.model!)
				const speedKey = mode === "act" ? "actModeInferenceSpeed" : "planModeInferenceSpeed"
				const inferenceSpeed = stateManager.getGlobalSettingsKey(speedKey)
				if (
					(inferenceSpeed === "fast" && !modelSupportsInferenceSpeed(targetProvider, options.model!)) ||
					(inferenceSpeed === "standard" && !providerSupportsInferenceSpeed(targetProvider))
				) {
					stateManager.setSessionOverride(speedKey, "default")
				}
			}
		})
		telemetryService.captureHostEvent("model_flag", options.model)
		if (options.provider) {
			telemetryService.captureHostEvent("provider_flag", options.provider)
		}
	}

	const currentMode = (stateManager.getGlobalSettingsKey("mode") || "act") as "act" | "plan"

	// Set thinking budget based on --thinking flag (boolean or number)
	if (options.thinking !== undefined) {
		let thinkingBudget = 1024
		if (typeof options.thinking === "string" || typeof options.thinking === "number") {
			const parsed = typeof options.thinking === "number" ? options.thinking : Number(options.thinking)
			if (!Number.isInteger(parsed) || parsed < 0) {
				printWarning(`Invalid --thinking value '${options.thinking}'. Using default 1024.`)
			} else {
				thinkingBudget = parsed
			}
		}

		await setModeScopedState(currentMode, (mode) => {
			const thinkingKey = mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
			stateManager.setSessionOverride(thinkingKey, thinkingBudget)
		})
		telemetryService.captureHostEvent("thinking_flag", "true")
	}

	const reasoningEffort = await normalizeReasoningEffort(options.reasoningEffort)
	if (reasoningEffort !== undefined) {
		await setModeScopedState(currentMode, (mode) => {
			const reasoningKey = mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"
			stateManager.setSessionOverride(reasoningKey, reasoningEffort)
		})
		telemetryService.captureHostEvent("reasoning_effort_flag", reasoningEffort)
	}

	if (options.speed !== undefined) {
		const { isInferenceSpeed, INFERENCE_SPEED_OPTIONS } = await import("@/shared/storage/types")
		if (!isInferenceSpeed(options.speed)) {
			throw new Error(`Invalid inference speed '${options.speed}'. Valid values: ${INFERENCE_SPEED_OPTIONS.join(", ")}.`)
		}
		const modes = stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
			? [currentMode]
			: (["plan", "act"] as const)
		for (const mode of modes) {
			const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
			const provider = stateManager.getGlobalSettingsKey(providerKey) as ApiProvider | undefined
			const modelKey = provider ? getProviderModelIdKey(provider, mode) : undefined
			const modelId = modelKey ? (stateManager.getGlobalSettingsKey(modelKey) as string | undefined) : undefined
			if (options.speed === "standard" && (!provider || !providerSupportsInferenceSpeed(provider))) {
				throw new Error(`Provider ${provider || "(unconfigured)"} does not support inference speed controls`)
			}
			if (options.speed === "fast" && (!provider || !modelId || !modelSupportsInferenceSpeed(provider, modelId))) {
				throw new Error(`Model ${modelId || "(unconfigured)"} does not support Fast mode`)
			}
		}
		await setModeScopedState(currentMode, (mode) => {
			const speedKey = mode === "act" ? "actModeInferenceSpeed" : "planModeInferenceSpeed"
			stateManager.setSessionOverride(speedKey, options.speed as InferenceSpeed)
		})
		telemetryService.captureHostEvent("inference_speed_flag", options.speed)
	}

	const maxConsecutiveMistakes = await normalizeMaxConsecutiveMistakes(options.maxConsecutiveMistakes)
	if (maxConsecutiveMistakes !== undefined) {
		stateManager.setSessionOverride("maxConsecutiveMistakes", maxConsecutiveMistakes)
		telemetryService.captureHostEvent("max_consecutive_mistakes_flag", String(maxConsecutiveMistakes))
	}

	// Set yolo mode as a session-scoped override so AutoApprove picks it up,
	// but it is never persisted to disk (setSessionOverride never touches pendingGlobalState).
	if (options.yolo) {
		stateManager.setSessionOverride("yoloModeToggled", true)
		telemetryService.captureHostEvent("yolo_flag", "true")
	}

	// Set auto-approve-all as a session-scoped override so CLI flag does not
	// persist user settings to disk.
	if (options.autoApproveAll) {
		stateManager.setSessionOverride("autoApproveAllToggled", true)
		telemetryService.captureHostEvent("auto_approve_all_flag", "true")
	}

	// Set double-check completion based on flag
	if (options.doubleCheckCompletion) {
		stateManager.setSessionOverride("doubleCheckCompletionEnabled", true)
		telemetryService.captureHostEvent("double_check_completion_flag", "true")
	}

	if (options.subagents) {
		stateManager.setSessionOverride("subagentsEnabled", true)
	}

	if (options.autoCondense) {
		stateManager.setSessionOverride("useAutoCondense", true)
	}

	if (options.autoCondenseAt !== undefined) {
		const limit = await normalizeMaxConsecutiveMistakes(options.autoCondenseAt)
		if (!isValidAutoCondenseContextLimit(limit)) {
			throw new Error("Auto-condense context limit must be between 1 and 2,000,000,000 tokens")
		}
		const providerKey = currentMode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const providerId = stateManager.getGlobalSettingsKey(providerKey)
		stateManager.setSessionOverride("autoCondenseContextLimits", {
			...stateManager.getGlobalSettingsKey("autoCondenseContextLimits"),
			[providerId]: limit!,
		})
	}

	if (options.noEmoji || process.env.DIRAC_NO_EMOJI) {
		const { setIconMode } = await import("./icon-mapping")
		setIconMode("unicode")
	}

	const headersString = options.headers || process.env.CUSTOM_HEADERS
	if (headersString) {
		const { parseHeaders } = await import("./parser")
		const parsedHeaders = parseHeaders(headersString)
		stateManager.setSessionOverride("openAiHeaders", parsedHeaders)
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/plain-text-task.ts (lines 111-489)
```
export async function runPlainTextTask(options: PlainTextTaskOptions): Promise<boolean> {
	const { controller, prompt, imageDataUrls, verbose, jsonOutput, yolo } = options

	let completionResolve: () => void
	let completionReject: (reason: Error) => void
	const completionPromise = new Promise<void>((res, rej) => {
		completionResolve = res
		completionReject = rej
	})
	// Subscription callbacks can reject completion while task initialization is
	// still in progress. Attach a handler immediately so Node never reports that
	// legitimate early failure as an unhandled rejection before we await it.
	void completionPromise.catch(() => { })
	let completionSettled = false
	const resolveCompletion = () => {
		if (completionSettled) return
		completionSettled = true
		completionResolve()
	}
	const rejectCompletion = (error: Error) => {
		if (completionSettled) return
		completionSettled = true
		completionReject(error)
	}

	let hasError = false
	let hasEmittedTaskStarted = false
	let taskExecutionStarted = false
	// A resumed task replays its terminal status once after restore; terminal
	// resolution stays suppressed until the new turn posts a divergent status.
	let restoredTerminalStatus: TaskStatus | undefined
	let turnStatusObserved = true
	// Track which messages have been processed (by ID)
	const processedMessages = new Set<string>()
	const streamedApiStatusIds = new Set<string>()
	const completedApiStatusIds = new Set<string>()
	const lastPrintedCardState = new Map<string, string>()
	const autoApprovedCards = new Set<string>()
	let approvalQueue = Promise.resolve()
	let latestState: Partial<ExtensionState> = {}
	let presentationState = createPresentationState()
	let turnStartTs: number | undefined
	const historicalMessageIds = new Set<string>()
	const isHistoricalMessage = (message: DiracMessage) =>
		historicalMessageIds.has(message.id) || (turnStartTs !== undefined && message.ts < turnStartTs)

	const isViewTaskOnly = Boolean(options.taskId) && !prompt && !imageDataUrls?.length

	const emitTaskStarted = () => {
		if (hasEmittedTaskStarted) {
			return
		}

		const taskId = controller.task?.taskId
		if (!taskId) {
			return
		}

		emitTaskStartedMessage(taskId, Boolean(jsonOutput))
		hasEmittedTaskStarted = true
	}

	// Helper to process a message and track completion state
	const processMessage = async (message: DiracMessage, state: ExtensionState) => {
		if (completionSettled) return
		const content = message.content

		const isStreaming =
			state.activeVoiceStreamId === message.id || (content.type === DiracMessageType.API_STATUS && state.isApiRequestActive)
		if (isStreaming) {
			// Special case: allow printing the initial api_req_started message even if it's partial
			// so the user knows the request has begun. Subsequent updates will be skipped until complete.
			if (content.type === DiracMessageType.API_STATUS && !streamedApiStatusIds.has(message.id)) {
				if (jsonOutput) {
					process.stdout.write(JSON.stringify(message) + "\n")
				} else {
					handleMessageForPipeMode(message, state, verbose || false, yolo || false, false)
				}
				streamedApiStatusIds.add(message.id)
				return
			}

			return
		}

		// Message is complete (or is a partial interaction card)
		// Skip if already processed as a complete message.
		// API_STATUS messages may arrive multiple times as they transition from "started"
		// to "finished" with metrics. We let them through until the metrics version prints.
		if (content.type === DiracMessageType.API_STATUS) {
			if (completedApiStatusIds.has(message.id)) {
				return
			}
			const hasMetrics = content.status.cost !== undefined || content.status.tokensIn !== undefined
			if (processedMessages.has(message.id) && !hasMetrics) {
				return
			}
		} else if (content.type !== DiracMessageType.CARD && processedMessages.has(message.id)) {
			return
		}

		const cardStateKey = content.type === DiracMessageType.CARD ? JSON.stringify(content.card) : undefined
		if (cardStateKey !== undefined && lastPrintedCardState.get(message.id) === cardStateKey) return

		// JSON mode: stream all messages to stdout (existing behavior)
		if (jsonOutput) {
			process.stdout.write(JSON.stringify(message) + "\n")
		} else {
			// For cards, avoid duplicate printing of the same state (interaction cards are never "streaming" in this mode)
			if (content.type === DiracMessageType.CARD) {
				handleMessageForPipeMode(message, state, verbose || false, yolo || false, false)
			} else {
				handleMessageForPipeMode(message, state, verbose || false, yolo || false, false)
			}
		}

		// Mark as processed if it's a complete message
		if (cardStateKey !== undefined) {
			lastPrintedCardState.set(message.id, cardStateKey)
		} else if (!isStreaming) {
			processedMessages.add(message.id)
			// For API_STATUS, once metrics are present, mark as completed to stop re-printing
			if (
				content.type === DiracMessageType.API_STATUS &&
				(content.status.cost !== undefined || content.status.tokensIn !== undefined)
			) {
				completedApiStatusIds.add(message.id)
			}
		}

		// Replayed history may be printed, but must not approve cards or settle the new turn.
		if (isHistoricalMessage(message)) return

		// Auto-approve if yolo mode is on and it's an approval request
		if (content.type === DiracMessageType.CARD && content.card.status === CardStatus.WAITING_FOR_INPUT) {
			const disposition = getStandaloneCardDisposition(content.card, Boolean(yolo), isViewTaskOnly)
			if (disposition === StandaloneCardDisposition.AUTO_APPROVE && !autoApprovedCards.has(content.card.id)) {
				autoApprovedCards.add(content.card.id)
				approvalQueue = approvalQueue
					.then(() => new Promise<void>((resolve) => setImmediate(resolve)))
					.then(() => approveCardForPlainTextYolo(controller, content.card))
					.catch((error) => {
						rejectCompletion(
							error instanceof Error ? error : new Error(`Failed to auto-approve card: ${String(error)}`),
						)
					})
				return
			}
			if (disposition === StandaloneCardDisposition.FAIL_FOR_FEEDBACK) {
				rejectCompletion(new Error("Task requires user feedback, which is unavailable in standalone mode."))
				return
			}
			if (disposition === StandaloneCardDisposition.FAIL_FOR_APPROVAL) {
				rejectCompletion(new Error("Task requires approval. Re-run with --yolo or use interactive mode."))
				return
			}
		}

		// Check for task failure card (e.g. YOLO mistake limit reached)
		if (
			content.type === DiracMessageType.CARD &&
			content.card.header === "Task Failed" &&
			content.card.status === CardStatus.ERROR
		) {
			rejectCompletion(new Error(content.card.body || "Mistake limit reached. Task halted in YOLO mode."))
			return
		}

		// Check for API failure (retries exhausted)
		if (
			content.type === DiracMessageType.API_STATUS &&
			content.status.cancelReason === "retries_exhausted"
		) {
			rejectCompletion(new Error("API request failed: retries exhausted"))
		}
	}

	const requestId = `dirac-plain-text-task-${randomUUID()}`
	let subscriptionStarted = false
	let timeout: NodeJS.Timeout | undefined

	try {
		subscriptionStarted = true
		await subscribeToState(
			controller,
			{},
			async ({ stateJson, presentationJson }) => {
				try {
					const previousActiveVoiceStreamId = latestState.activeVoiceStreamId
					const update = JSON.parse(stateJson) as Partial<ExtensionState>
					latestState = { ...latestState, ...update, activeVoiceStreamId: update.activeVoiceStreamId }
					let changedMessages: DiracMessage[] = []
					if (update.diracMessages !== undefined) {
						presentationState = createPresentationState(
							update.diracMessages,
							update.presentationSurfaceId,
							update.presentationOffset,
						)
						changedMessages = update.diracMessages
					}
					if (presentationJson) {
						const applied = applyPresentationBatch(
							presentationState,
							JSON.parse(presentationJson) as PresentationBatch,
						)
						if (applied.result === "gap") {
							const fullState = await controller.getStateToPostToWebview()
							latestState = fullState
							presentationState = createPresentationState(
								fullState.diracMessages,
								fullState.presentationSurfaceId,
								fullState.presentationOffset,
							)
							changedMessages = fullState.diracMessages
						} else if (applied.result === "applied") {
							changedMessages = applied.changedMessages
						}
					}
					latestState.diracMessages = presentationState.messages
					latestState.presentationSurfaceId = presentationState.surfaceId
					latestState.presentationOffset = presentationState.offset
					if (!taskExecutionStarted) return
					const state = latestState as ExtensionState
					const completedVoiceStreamId =
						previousActiveVoiceStreamId !== state.activeVoiceStreamId ? previousActiveVoiceStreamId : undefined
					if (completedVoiceStreamId) {
						const completedIndex = presentationState.messageIndexById.get(completedVoiceStreamId)
						const completedMessage =
							completedIndex === undefined ? undefined : presentationState.messages[completedIndex]
						if (completedMessage) await processMessage(completedMessage, state)
					}
					for (const message of changedMessages) {
						await processMessage(message, state)
					}

					// A restored terminal snapshot is not a terminal event for the follow-up turn.
					if (!turnStatusObserved && state.taskStatus !== undefined && state.taskStatus !== restoredTerminalStatus) {
						turnStatusObserved = true
					}
					if (!turnStatusObserved) return

					const terminalCheck = evaluatePlainTextTaskTerminalState(
						state,
						isViewTaskOnly,
						turnStartTs,
						historicalMessageIds,
					)
					if (terminalCheck.isTerminal) {
						if (terminalCheck.action === "resolve") {
							resolveCompletion()
						} else if (terminalCheck.action === "reject" && terminalCheck.error) {
							rejectCompletion(terminalCheck.error)
						}
					}
				} catch (error) {
					rejectCompletion(error instanceof Error ? error : new Error(String(error)))
				}
			},
			requestId,
		)
		// Either resume an existing task or start a new one
		if (options.taskId) {
			// A historical completed state is terminal only when the caller is
			// viewing history. When sending a follow-up, ignore that snapshot until
			// the new turn has actually been submitted.
			taskExecutionStarted = isViewTaskOnly
			// Load the existing task
			await showTaskWithId(controller, StringRequest.create({ value: options.taskId }))
			emitTaskStarted()

			// If a prompt was provided, send it as a message to the resumed task
			if ((prompt || imageDataUrls?.length) && controller.task) {
				// Capture the terminal status restore replayed; suppressing it stops the
				// stale snapshot from resolving the follow-up turn before it starts.
				// This read must sit after showTaskWithId (restore sets the status) and
				// before submitCardResponse (the new turn may already flip it).
				restoredTerminalStatus = controller.task.taskState?.status
				turnStatusObserved = false
				for (const message of controller.task.messageStateHandler.getDiracMessages()) {
					historicalMessageIds.add(message.id)
				}

				// Send the prompt as a response to any pending ask, or as a new message
				turnStartTs = Date.now()
				taskExecutionStarted = true
				await controller.task.submitCardResponse("", DiracAskResponse.MESSAGE, prompt || "", imageDataUrls)
			}
		} else if (prompt || imageDataUrls?.length) {
			taskExecutionStarted = true
			// Start a new task with the prompt
			await controller.initTask(prompt || "", imageDataUrls)
			emitTaskStarted()
		} else {
			throw new Error("Either taskId or prompt must be provided")
		}

		// Wait for task completion, with optional timeout only when explicitly configured
		if (options.timeoutSeconds) {
			const timeoutMs = options.timeoutSeconds * 1000
			const timeoutPromise = new Promise<void>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`Task timed out after ${options.timeoutSeconds} seconds.`)),
					timeoutMs,
				)
			})
			await Promise.race([completionPromise, timeoutPromise])
		} else {
			await completionPromise
		}
	} catch (error) {
		try {
			await controller.task?.abortTask()
		} catch (abortError) {
			Logger.error("Failed to abort standalone task after an error:", abortError)
		}
		const errMsg = error instanceof Error ? error.message : String(error)
		if (jsonOutput) {
			process.stdout.write(JSON.stringify({ type: "error", message: errMsg }) + "\n")
		} else {
			process.stderr.write(
				stderrStyle.error(`[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] Error: ${errMsg}`) + "\n",
			)
		}
		hasError = true
	} finally {
		if (timeout) clearTimeout(timeout)
		if (subscriptionStarted) getRequestRegistry().cancelRequest(requestId)
		await approvalQueue
	}

	// non json mode outputs only the final complete message
	if (!jsonOutput && !hasError) {
		const messages = controller.task?.messageStateHandler.getDiracMessages() || []
		// Prefer the body of the "Task Completed" card
		const completionCard = [...messages]
			.reverse()
			.find((m) => m.content.type === DiracMessageType.CARD && isTaskCompletionCard(m.content.card))

		if (completionCard && completionCard.content.type === DiracMessageType.CARD) {
			const card = completionCard.content.card
			process.stdout.write(cardBodyForDisplay(card.body, card.renderType) + "\n")
		} else {
			// Fallback to the last markdown message when no completion card exists.
			const lastMarkdown = [...messages]
				.reverse()
				.find((m) => m.content.type === DiracMessageType.MARKDOWN && !m.content.isReasoning)
			if (lastMarkdown && lastMarkdown.content.type === DiracMessageType.MARKDOWN) {
				process.stdout.write(lastMarkdown.content.content + "\n")
			}
		}
	}

	// Print final summary if verbose or yolo
	if (!jsonOutput && (verbose || yolo)) {
		const messages = controller.task?.messageStateHandler.getDiracMessages() || []
		const metrics = getApiMetrics(messages)
		if (metrics.totalTokensIn > 0 || metrics.totalCost > 0) {
			process.stderr.write(`\n${stderrStyle.dim("-".repeat(40))}\n`)
			process.stderr.write(`${stderrStyle.info("Task Summary:")}\n`)
			process.stderr.write(
				`Tokens: ${metrics.totalTokensIn.toLocaleString()} in, ${metrics.totalTokensOut.toLocaleString()} out${metrics.totalReasoningTokens ? ` (+${metrics.totalReasoningTokens.toLocaleString()} thinking)` : ""}\n`,
			)
			if (metrics.totalCacheReads || metrics.totalCacheWrites) {
				process.stderr.write(
					`Cache: ${(metrics.totalCacheReads || 0).toLocaleString()} read, ${(metrics.totalCacheWrites || 0).toLocaleString()} write\n`,
				)
			}
			if (metrics.totalCacheReads || metrics.totalCacheWrites) {
				process.stderr.write(`Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%\n`)
			}
			if (metrics.totalCost > 0) {
				process.stderr.write(`Total Cost: $${metrics.totalCost.toFixed(4)}\n`)
			}
			process.stderr.write(`${stderrStyle.dim("-".repeat(40))}\n`)
		}
	}

	return !hasError
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/slash-commands.ts (lines 186-191)
```
export function filterCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
	if (!query) {
		return commands
	}
	return fuzzyFilter(commands, query, (cmd) => cmd.name)
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/errors.ts (lines 33-55)
```
export async function onUnhandledException(reason: unknown, context: string) {
	const { Logger } = await import("@/shared/services/Logger")
	const { restoreConsole } = await import("./console")
	Logger.error("Unhandled exception:", reason)
	const finalError = reason instanceof Error ? reason : new Error(String(reason))

	restoreConsole()
	console.error(finalError)

	const forcedExit = setTimeout(() => process.exit(1), EXIT_TIMEOUT_MS)
	try {
		await captureUnhandledException(finalError, context)
		const { disposeCliLogging } = await import("../init")
		await disposeCliLogging()
		const { disposeAcpFileLogger } = await import("./acp-file-logger")
		await disposeAcpFileLogger()
	} catch (error) {
		console.error("Failed to flush CLI diagnostics during shutdown:", error)
	} finally {
		clearTimeout(forcedExit)
		process.exit(1)
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/console.ts (lines 38-44)
```
export function restoreConsole() {
	console.log = originalConsoleLog
	console.error = originalConsoleError
	console.warn = originalConsoleWarn
	console.info = originalConsoleInfo
	console.debug = originalConsoleDebug
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/card-body.ts (lines 5-8)
```
export function cardBodyForDisplay(body: string | undefined, renderType: RenderType): string {
	if (!body) return ""
	return renderType === "diff" ? stripHashesFromDiff(body) : stripHashes(body)
}
```


## Source Files:

- `cli/src/utils/card-body.ts`
- `cli/src/utils/cleanup.ts`
- `cli/src/utils/clipboard-image.ts`
- `cli/src/utils/console.ts`
- `cli/src/utils/display.ts`
- `cli/src/utils/errors.ts`
- `cli/src/utils/icon-mapping.ts`
- `cli/src/utils/options.ts`
- `cli/src/utils/plain-text-task.ts`
- `cli/src/utils/shutdown.ts`
- `cli/src/utils/slash-commands.ts`
- `cli/src/utils/standalone-card-policy.ts`
- `cli/src/utils/state.ts`
- `cli/src/utils/update.ts`

