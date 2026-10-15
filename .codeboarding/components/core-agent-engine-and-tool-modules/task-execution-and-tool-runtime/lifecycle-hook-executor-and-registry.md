---
component_id: 1.1.2
component_name: Lifecycle Hook Executor & Registry
---

# Lifecycle Hook Executor & Registry

## Component Description

Executes lifecycle, pre-tool-use, and pre-compaction hooks while managing hook processes, registries, and output parsing.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/hooks/hook-executor.ts (lines 59-264)
```
export async function executeHook<Name extends keyof Hooks>(options: HookExecutionOptions<Name>): Promise<HookExecutionResult> {
	const {
		hookName,
		hookInput,
		isCancellable,
		messenger,

		setActiveHookExecution,
		clearActiveHookExecution,
		messageStateHandler,
		taskId,
		hooksEnabled,
	} = options

	// Early return if hooks are disabled
	if (!hooksEnabled) {
		return {
			wasCancelled: false,
		}
	}

	// Check if the hook exists
	const hookFactory = new HookFactory()
	const hasHook = await hookFactory.hasHook(hookName)

	if (!hasHook) {
		return { wasCancelled: false }
	}

	let hookMessageId: string | undefined
	const abortController = new AbortController()

	// Declare hookInfo with empty default - populated inside try block.
	// If getHookInfo throws, error handlers will use the empty default.
	let hookInfo: { scriptPaths: string[] } = { scriptPaths: [] }

	try {
		// Get hook info including script paths
		hookInfo = await hookFactory.getHookInfo(hookName)

		// Show hook execution indicator and capture timestamp
		const hookMetadata = {
			hookName,
			...(options.toolName && { toolName: options.toolName }),
			status: "running",
			scriptPaths: hookInfo.scriptPaths,
			...(options.pendingToolInfo && { pendingToolInfo: options.pendingToolInfo }),
		}
		const cardHandle = await messenger.createCard({
			header: `${hookName} Hook`,
			status: CardStatus.RUNNING,
			body: JSON.stringify(hookMetadata),
		})
		hookMessageId = cardHandle.id

		// Reorder messages immediately so hook UI appears above tool UI
		// This must happen right after creating the hook message, before the hook runs
		if (hookName === "PreToolUse") {
			await reorderHookAndToolMessages(messageStateHandler)
		}

		// Track active hook execution for cancellation (only if cancellable and message was created)
		if (isCancellable && hookMessageId !== undefined && setActiveHookExecution) {
			await setActiveHookExecution({
				hookName,
				toolName: options.toolName,
				messageId: hookMessageId,
				abortController,
			})
		}

		// Create streaming callback
		const streamCallback = async (line: string, stream: "stdout" | "stderr", meta?: HookOutputStreamMeta) => {
			// Preserve script identity for multi-hook (global + workspace) scenarios.
			// Without this, concurrent hooks interleave output and it's hard to tell which
			// script produced which line (and can look like only one hook is printing).
			//
			// NOTE: We keep backward compatibility by encoding metadata into the string.
			// The CLI prints this as-is in verbose mode.
			const prefixParts: string[] = []
			if (meta?.source) prefixParts.push(meta.source)
			prefixParts.push(stream)
			// Use a shortened path for readability; full path is still available in hook_status.
			if (meta?.scriptPath) {
				const parts = meta.scriptPath.split(/[/\\]/).filter(Boolean)
				prefixParts.push(parts.slice(-3).join("/"))
			}
			const prefix = prefixParts.length ? `[${prefixParts.join(" ")}] ` : ""
			await messenger.upsertText(prefix + line)
		}

		// Create and execute hook
		const hook = await hookFactory.createWithStreaming(
			hookName,
			streamCallback,
			isCancellable ? abortController.signal : undefined,
			taskId,
			options.toolName,
		)

		const result = await hook.run({
			taskId,
			...hookInput,
			model: options.model,
		})

		Logger.log(`[${hookName} Hook]`, result)

		// NoOp hooks return proto defaults; preserve the minimal legacy return shape.
		if (result.cancel === false && result.contextModification === "" && result.errorMessage === "") {
			return { wasCancelled: false }
		}

		// Check if hook wants to cancel
		if (result.cancel === true) {
			// Update hook status to cancelled
			if (hookMessageId !== undefined) {
				await updateHookMessage(messageStateHandler, hookMessageId, {
					hookName,
					...(options.toolName && { toolName: options.toolName }),
					status: "cancelled",
					exitCode: 130,
					hasJsonResponse: true,
					scriptPaths: hookInfo.scriptPaths,
				})
			}

			return fromHookOutput(result)
		}

		// Clear active hook execution after successful completion (only if cancellable)
		if (isCancellable && clearActiveHookExecution) {
			await clearActiveHookExecution()
		}

		// Update hook status to completed (only if not cancelled)
		if (hookMessageId !== undefined) {
			await updateHookMessage(messageStateHandler, hookMessageId, {
				hookName,
				...(options.toolName && { toolName: options.toolName }),
				status: "completed",
				exitCode: 0,
				hasJsonResponse: true,
				scriptPaths: hookInfo.scriptPaths,
			})
		}

		return fromHookOutput(result)
	} catch (hookError) {
		// Clear active hook execution (only if cancellable)
		if (isCancellable && clearActiveHookExecution) {
			await clearActiveHookExecution()
		}

		// Check if this was a user cancellation via abort controller
		if (abortController.signal.aborted) {
			// Update hook status to cancelled
			if (hookMessageId !== undefined) {
				await updateHookMessage(messageStateHandler, hookMessageId, {
					hookName,
					status: "cancelled",
					exitCode: 130,
					scriptPaths: hookInfo.scriptPaths,
				})
			}

			return {
				cancel: true,
				wasCancelled: true,
			}
		}

		// Update hook status to failed for actual errors
		// Extract structured error info if available
		const isStructuredError = HookExecutionError.isHookError(hookError)
		const errorInfo = isStructuredError ? hookError.errorInfo : null

		if (hookMessageId !== undefined) {
			await updateHookMessage(messageStateHandler, hookMessageId, {
				hookName,
				status: "failed",
				exitCode: errorInfo?.exitCode ?? 1,
				scriptPaths: hookInfo.scriptPaths,
				...(errorInfo && {
					error: {
						type: errorInfo.type,
						message: errorInfo.message,
						details: errorInfo.details,
						scriptPath: errorInfo.scriptPath,
					},
				}),
			})
		}

		// Log error for non-cancellable hooks or unexpected errors
		Logger.error(`${hookName} hook failed:`, hookError)

		// Return safe defaults for all fields to avoid undefined property access
		return {
			cancel: false,
			contextModification: undefined,
			errorMessage: undefined,
			wasCancelled: false,
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/hooks/precompact-executor.ts (lines 180-290)
```
export async function executePreCompactHookWithCleanup(params: PreCompactHookParams): Promise<PreCompactHookResult> {
	const { executeHook } = await import("./hook-executor")
	const { cleanupConversationHistoryFile } = await import("../storage/disk")

	let contextJsonPath: string | undefined
	let contextRawPath: string | undefined

	try {
		// Get current active context (respects previous compactions)
		const currentContext = params.contextManager.getTruncatedMessages(
			params.apiConversationHistory,
			params.conversationHistoryDeletedRange,
		)

		// Write context files for hook access
		const contextFiles = await writePreCompactContextFiles(params.taskId, currentContext as any)
		contextJsonPath = contextFiles.contextJsonPath
		contextRawPath = contextFiles.contextRawPath

		// Extract token usage from the most recent API request
		const previousApiReqIndex = findLastIndex(params.diracMessages, (m) => m.content.type === DiracMessageType.API_STATUS)
		const previousRequest = previousApiReqIndex !== -1 ? params.diracMessages[previousApiReqIndex] : undefined
		const { tokensIn, tokensOut, tokensInCache, tokensOutCache } = extractTokenUsageFromMessage(previousRequest)

		// Extract truncation range - use provided range or extract from conversationHistoryDeletedRange
		let deletedRangeStart = 0
		let deletedRangeEnd = 0
		if (params.deletedRange) {
			;[deletedRangeStart, deletedRangeEnd] = params.deletedRange
		} else if (params.conversationHistoryDeletedRange) {
			;[deletedRangeStart, deletedRangeEnd] = params.conversationHistoryDeletedRange
		}

		// Execute the hook
		const preCompactResult = await executeHook({
			hookName: "PreCompact",
			hookInput: {
				preCompact: {
					taskId: params.taskId,
					ulid: params.ulid,
					contextSize: currentContext.length,
					compactionStrategy: params.compactionStrategy,
					previousApiReqIndex: previousApiReqIndex,
					tokensIn,
					tokensOut,
					tokensInCache,
					tokensOutCache,
					deletedRangeStart,
					deletedRangeEnd,
					contextJsonPath: contextJsonPath,
					contextRawPath: contextRawPath,
				},
			},
			isCancellable: true,
			setActiveHookExecution: params.setActiveHookExecution,
			clearActiveHookExecution: params.clearActiveHookExecution,
			messenger: params.messenger,

			messageStateHandler: params.messageStateHandler,
			taskId: params.taskId,
			hooksEnabled: params.hooksEnabled,
			model: params.modelContext,
		})

		// Handle cancellation from hook
		if (preCompactResult.cancel === true) {
			// Log cancellation for debugging
			const cancellationSource = preCompactResult.wasCancelled ? "user" : "PreCompact hook"
			Logger.log(`[PreCompact] Context compaction cancelled by ${cancellationSource} for task ${params.taskId}`)

			if (params.cancelTaskOnCancellation !== false) {
				// Always save state before cancelling, regardless of cancellation source
				params.taskState.markStreamAbortFinished()
				await params.messageStateHandler.saveDiracMessagesAndUpdateHistory()
				await params.messageStateHandler.overwriteApiConversationHistory(
					params.messageStateHandler.getApiConversationHistory(),
				)
				await params.postStateToWebview()
				await params.cancelTask()
			}
			// Throw error to signal cancellation to caller
			throw new HookCancellationError(preCompactResult.wasCancelled)
		}

		// Hook completed successfully - log if context modification provided
		if (preCompactResult.contextModification) {
			Logger.log(`[PreCompact] Hook provided context modification for task ${params.taskId}`)
		}

		return {
			contextModification: preCompactResult.contextModification,
		}
	} catch (error) {
		// Re-throw error for caller to handle
		throw error
	} finally {
		// Clean up temporary files - always executed regardless of success or error
		// Wrap in try-catch to prevent cleanup failures from masking original errors
		try {
			if (contextJsonPath) {
				await cleanupConversationHistoryFile(contextJsonPath)
			}
			if (contextRawPath) {
				await cleanupConversationHistoryFile(contextRawPath)
			}
		} catch (cleanupError) {
			Logger.error("[PreCompact] Failed to cleanup context files:", cleanupError)
			// Don't throw - cleanup failure shouldn't mask original error
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/hooks/hooks-utils.ts (lines 6-8)
```
export function getHooksEnabledSafe(userSetting: boolean | undefined): boolean {
	return userSetting ?? true
}
```


## Source Files:

- `src/core/hooks/HookError.ts`
- `src/core/hooks/HookLaunchConfig.ts`
- `src/core/hooks/HookOutputParser.ts`
- `src/core/hooks/HookProcess.ts`
- `src/core/hooks/HookProcessRegistry.ts`
- `src/core/hooks/HookRegistry.ts`
- `src/core/hooks/HookResponseParser.ts`
- `src/core/hooks/HookTelemetryRecorder.ts`
- `src/core/hooks/PreToolUseHookCancellationError.ts`
- `src/core/hooks/hook-executor.ts`
- `src/core/hooks/hook-model-context.ts`
- `src/core/hooks/hooks-utils.ts`
- `src/core/hooks/precompact-executor.ts`
- `src/core/hooks/shell-escape.ts`
- `src/core/hooks/templates.ts`

