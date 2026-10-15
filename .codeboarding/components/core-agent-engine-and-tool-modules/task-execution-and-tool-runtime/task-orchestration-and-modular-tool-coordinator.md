---
component_id: 1.1.1
component_name: Task Orchestration & Modular Tool Coordinator
---

# Task Orchestration & Modular Tool Coordinator

## Component Description

Manages task state, streaming API responses, conversation compaction, subagent execution, and modular tool coordination.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/task/HookManager.ts (lines 140-190)
```
	public async runUserPromptSubmitHook(
		userContent: DiracContent[],
		_context: "initial_task" | "resume" | "feedback",
	): Promise<UserPromptHookResult> {
		const hooksEnabled = getHooksEnabledSafe(this.dependencies.getWorkingConfiguration().settings.hooksEnabled)

		if (!hooksEnabled) {
			return {}
		}

		const { extractUserPromptFromContent } = await import("./utils/extractUserPromptFromContent")

		// Extract clean user prompt from content, stripping system wrappers and metadata
		const promptText = extractUserPromptFromContent(userContent)

		const userPromptResult = await executeHook({
			hookName: "UserPromptSubmit",
			hookInput: {
				userPromptSubmit: {
					prompt: promptText,
					attachments: [],
				},
			},
			isCancellable: true,
			messenger: this.dependencies.taskMessenger,
			setActiveHookExecution: this.setActiveHookExecution.bind(this),
			clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
			messageStateHandler: this.dependencies.messageStateHandler,
			taskId: this.dependencies.taskId,
			hooksEnabled,
			model: getTaskHookModelContext(this.dependencies.api!, this.dependencies.getWorkingConfiguration()),
		})

		// Handle cancellation from hook
		if (userPromptResult.cancel === true && userPromptResult.wasCancelled) {
			// Set flag to allow Controller.cancelTask() to proceed
			this.dependencies.taskState.markStreamAbortFinished()
			// Save BOTH files so Controller.cancelTask() can find the task
			await this.dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory()
			await this.dependencies.messageStateHandler.overwriteApiConversationHistory(
				this.dependencies.messageStateHandler.getApiConversationHistory(),
			)
			await this.dependencies.postStateToWebview()
		}

		return {
			cancel: userPromptResult.cancel,
			contextModification: userPromptResult.contextModification,
			errorMessage: userPromptResult.errorMessage,
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/core/task/LocalConversationCompaction.ts (lines 201-224)
```
	private async generateSummary(
		selection: ModelProviderSelection,
		createHandler: UtilityModelHandlerFactory,
		templates: ReturnType<typeof createDefaultTextCondensationTemplateRegistry>,
		onRetry: UtilityModelRunnerOptions["onRetry"],
		currentTurnUserRequests: readonly string[],
	): Promise<string> {
		const runner = new UtilityModelRunner(selection, createHandler, {
			onRetry,
			onUsage: (event) => recordUtilityModelUsage(this.dependencies.taskState, this.dependencies.ulid, event),
		})
		const textCondenser = new UtilityModelTextCondenser(runner, templates)
		const service = new ConversationCondensationService({
			messageState: this.dependencies.messageStateHandler,
			contextManager: this.dependencies.contextManager,
			getConversationHistoryDeletedRange: () => this.dependencies.taskState.conversationHistoryDeletedRange,
			textCondenser,
		})
		return await service.condenseConversation(CONVERSATION_CONTINUATION_TEMPLATE_ID, {
			historyScope: "effective",
			signal: this.dependencies.taskState.abortSignal,
			additionalSourceText: formatCurrentTurnUserRequests(currentTurnUserRequests),
		})
	}
```

### /Users/highlands/pools/Development/dirac/src/core/task/tools/ToolExecutorCoordinator.ts (lines 80-218)
```
	private async executeModularTool(tool: IDiracTool, config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const startTime = Date.now()
		const requestSnapshot = config.activeToolSnapshot
		const nativeTool = requestSnapshot?.nativeTools.find(
			(candidate) => "function" in candidate && candidate.function.name === block.name,
		)
		if (requestSnapshot && nativeTool && "function" in nativeTool && nativeTool.function.strict === true) {
			const requestSpec = requestSnapshot.promptVisibleSpecs.find((spec) => spec.name === block.name) ?? tool.spec()
			block.params = normalizeOptionalToolParameters(block.params, requestSpec)
		}

		// 1. Initialize Tool Environment (Surface Adapter)
		// Preserve live task-setting accessors while adding call-specific metadata.
		const toolConfig = Object.create(Object.getPrototypeOf(config), Object.getOwnPropertyDescriptors(config)) as TaskConfig
		toolConfig.toolUse = { name: block.name, params: block.params }
		const env = this.environmentFactory.create(toolConfig, block.name)

		// 2. Filter (Surface Check)
		const supported = tool.supportedSurfaces()
		const currentSurface: SurfaceType = config.vscodeTerminalExecutionMode === "vscodeTerminal" ? "ide" : "cli"

		if (supported.length > 0 && !supported.includes("all") && !supported.includes(currentSurface)) {
			const error = new Error(`Surface mismatch: ${currentSurface}`)
			return `Tool '${block.name}' is not supported on the current surface (${currentSurface}).`
		}

		// 3. Pre-tool Hooks
		try {
			const { ToolHookUtils } = await import("./utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error: any) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return `Cancelled by pre-tool hook: ${error.message}`
			}
			throw error
		}

		// 4. Observability: "Calling..." (Removed redundant message)

		let executionSuccess = false
		let response!: ToolResponse
		let executionError: Error | undefined

		const initialMistakeCount = config.taskState.consecutiveMistakeCount
		const unfinalizedCards: { id: string; status: CardStatus }[] = []
		try {
			// 5. Execute (Dispatcher)
			const result = await tool.processCall(block.params, env)
			assertValidToolResponse(result, block.name)
			executionSuccess = true

			// 6. Persist Context
			await env.context.save()

			// 7. Observability: "Finished..." (Removed redundant message)

			// 8. Update Mistake Count (Success)
			config.taskState.consecutiveMistakeCount =
				config.taskState.consecutiveMistakeCount > initialMistakeCount ? initialMistakeCount + 1 : 0

			// 9. Store Result
			response = result
		} catch (error: any) {
			executionSuccess = false

			if (error instanceof ToolSkippedByUserMessage) {
				config.taskState.consecutiveMistakeCount = initialMistakeCount
				config.taskState.pendingUserMessage = error.userMessage
				config.taskState.pendingUserImages = error.userImages
				config.taskState.pendingUserFiles = error.userFiles

				for (const card of env.getCreatedCards()) {
					if (!isFinalStatus(card.status)) {
						await card.finalize(CardStatus.SKIPPED)
					}
				}

				env.telemetry.captureCustomMetadata({ skippedByUser: true, userMessageLength: error.userMessage.length })
				response = `[Tool '${block.name}' skipped by user with message: "${error.userMessage}"]`
			} else {
				executionError = error instanceof Error ? error : new Error(String(error))
				config.taskState.consecutiveMistakeCount = initialMistakeCount + 1
				if (executionError instanceof ToolTimeoutError) {
					env.telemetry.captureCustomMetadata({
						timedOut: true,
						timeoutMs: executionError.timeoutMs,
						timeoutOperation: executionError.operation,
					})
					response = formatResponse.toolTimeout(
						executionError.toolName,
						executionError.operation,
						executionError.timeoutMs,
					)
				} else {
					response = `Execution failed: ${error.message || error}`
				}
			}
		} finally {
			// 12. Telemetry
			const duration = Date.now() - startTime
			const customMetadata = env.getCustomMetadata()

			const { telemetryService } = await import("@/services/telemetry")

			const modelId = config.model.id
			const providerId = config.providerId

			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				modelId,
				providerId,
				false, // didAutoApprove
				executionSuccess,
				{
					...customMetadata,
					durationMs: duration,
					modular: true,
				},
				block.isNativeToolCall,
			)

			// 13. Collect unfinalized cards — assert after finally to avoid unsafe throw
			for (const card of env.getCreatedCards()) {
				if (!isFinalStatus(card.status) && card.cleanupStrategy !== "keep_running") {
					unfinalizedCards.push({ id: card.id, status: card.status })
				}
			}
		}

		// Assert tools finalized their own cards — no defensive finalization
		if (unfinalizedCards.length > 0) {
			throw new Error(
				`Tool '${block.name}' left nonterminal card(s): ${unfinalizedCards.map((c) => `${c.id} (${c.status})`).join(", ")}${executionError ? `. Original execution error: ${executionError.message}` : ""}`,
			)
		}
		return response
	}
```

### /Users/highlands/pools/Development/dirac/src/core/task/tools/adapters/DelegatingCardHandle.ts (lines 5-41)
```
export class DelegatingCardHandle implements ICardHandle {
	constructor(protected readonly card: ICardHandle) {}

	get collapsed() { return this.card.collapsed }
	get id() { return this.card.id }
	get header() { return this.card.header }
	get icon() { return this.card.icon }
	get renderType() { return this.card.renderType }
	get body() { return this.card.body }
	get rawInput() { return this.card.rawInput }
	get rawOutput() { return this.card.rawOutput }
	get locations() { return this.card.locations }
	get requireApproval() { return this.card.requireApproval }
	get requireFeedback() { return this.card.requireFeedback }
	get feedbackPlaceholder() { return this.card.feedbackPlaceholder }
	get actions() { return this.card.actions }
	get maxHeight() { return this.card.maxHeight }
	get cleanupStrategy() { return this.card.cleanupStrategy }
	get status() { return this.card.status }
	get requiresUserInteraction() { return this.card.requiresUserInteraction }

	update(patch: Parameters<ICardHandle["update"]>[0]): Promise<void> {
		return this.card.update(patch)
	}

	waitForInteraction(): ReturnType<ICardHandle["waitForInteraction"]> {
		return this.card.waitForInteraction()
	}

	appendBody(chunk: string): Promise<void> {
		return this.card.appendBody(chunk)
	}

	finalize(status: CardStatus, doNotAutoCollapse?: boolean): Promise<void> {
		return this.card.finalize(status, doNotAutoCollapse)
	}
}
```


## Source Files:

- `src/core/task/AssistantStreamManager.ts`
- `src/core/task/ContextLoader.ts`
- `src/core/task/HookManager.ts`
- `src/core/task/ITaskContext.ts`
- `src/core/task/LocalConversationCompaction.ts`
- `src/core/task/ResponseProcessor.ts`
- `src/core/task/StreamChunkCoordinator.ts`
- `src/core/task/StreamResponseHandler.ts`
- `src/core/task/StreamingMetricsManager.ts`
- `src/core/task/TaskApiRequestAttempt.ts`
- `src/core/task/TaskConversationPersistence.ts`
- `src/core/task/TaskExecutionProfile.ts`
- `src/core/task/TaskLockUtils.ts`
- `src/core/task/TaskMistakeLimit.ts`
- `src/core/task/TaskPromptArtifacts.ts`
- `src/core/task/TaskRequestBuilder.ts`
- `src/core/task/TaskRequestOutcome.ts`
- `src/core/task/TaskRunOutcome.ts`
- `src/core/task/TaskState.ts`
- `src/core/task/TaskSteering.ts`
- `src/core/task/TaskUserInput.ts`
- `src/core/task/activateTaskSkill.ts`
- `src/core/task/context/FileContextLoader.ts`
- `src/core/task/lifecycle/TaskAbortManager.ts`
- `src/core/task/recordUtilityModelUsage.ts`
- `src/core/task/response/EmptyResponseHandler.ts`
- `src/core/task/response/ResponseFormatter.ts`
- `src/core/task/response/StreamStateSync.ts`
- `src/core/task/response/ToolCallExtractor.ts`
- `src/core/task/runtime/TaskRequestRuntime.ts`
- `src/core/task/runtime/TaskRuntimeModelContext.ts`
- `src/core/task/runtime/TaskWorkingConfiguration.ts`
- `src/core/task/steering.ts`
- `src/core/task/stream/ReasoningHandler.ts`
- `src/core/task/stream/ToolUseHandler.ts`
- `src/core/task/stream/types.ts`
- `src/core/task/tools/ToolExecutorCoordinator.ts`
- `src/core/task/tools/adapters/ApprovedPermissionCardHandle.ts`
- `src/core/task/tools/adapters/CardHandle.ts`
- `src/core/task/tools/adapters/DelegatingCardHandle.ts`
- `src/core/task/tools/adapters/SurfaceAdapter.ts`
- `src/core/task/tools/adapters/traits/ConversationCondensationTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/DiagnosticsTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/EditorTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/LoggingTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/SkillsTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/SourceAstTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/SubagentUsagePublisher.ts`
- `src/core/task/tools/adapters/traits/SystemTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/TelemetryTraitBuilder.ts`
- `src/core/task/tools/adapters/traits/UiTraitBuilder.ts`
- `src/core/task/tools/discovery/DiscoveredTool.ts`
- `src/core/task/tools/discovery/UserToolLoader.ts`
- `src/core/task/tools/goal/GoalTaskActionCard.ts`
- `src/core/task/tools/goal/GoalToolInput.ts`
- `src/core/task/tools/interfaces/IDiracContext.ts`
- `src/core/task/tools/interfaces/IDiracTool.ts`
- `src/core/task/tools/interfaces/ToolEnvironmentFactory.ts`
- `src/core/task/tools/interfaces/ValidationResult.ts`
- `src/core/task/tools/modules/block_goal/BlockGoalTool.ts`
- `src/core/task/tools/modules/block_goal/tool.ts`
- `src/core/task/tools/modules/cancel_task/CancelTaskTool.ts`
- `src/core/task/tools/modules/cancel_task/tool.ts`
- `src/core/task/tools/modules/condense/CondenseTool.ts`
- `src/core/task/tools/modules/condense/tool.ts`
- `src/core/task/tools/modules/diagnostics_scan/index.ts`
- `src/core/task/tools/modules/diagnostics_scan/tool.ts`
- `src/core/task/tools/modules/edit_ast/AstEditApplier.ts`
- `src/core/task/tools/modules/edit_ast/AstEditApproval.ts`
- `src/core/task/tools/modules/edit_ast/AstEditFormatter.ts`
- `src/core/task/tools/modules/edit_ast/EditAstTool.ts`
- `src/core/task/tools/modules/edit_ast/EditAstValidator.ts`
- `src/core/task/tools/modules/edit_ast/tool.ts`
- `src/core/task/tools/modules/edit_file/EditFileApplier.ts`
- `src/core/task/tools/modules/edit_file/EditFileApprovalFlow.ts`
- `src/core/task/tools/modules/edit_file/EditFileBatchPreparer.ts`
- `src/core/task/tools/modules/edit_file/EditFileFormatter.ts`
- `src/core/task/tools/modules/edit_file/EditFileTool.ts`
- `src/core/task/tools/modules/edit_file/EditFileValidator.ts`
- `src/core/task/tools/modules/edit_file/tool.ts`
- `src/core/task/tools/modules/edit_file/types.ts`
- `src/core/task/tools/modules/edit_file/utils/EditExecutor.ts`
- `src/core/task/tools/modules/edit_file/utils/EditFormatter.ts`
- `src/core/task/tools/modules/execute_command/path-display.ts`
- `src/core/task/tools/modules/execute_command/tool.ts`
- `src/core/task/tools/modules/inspect_ast/InspectAstFormatter.ts`
- `src/core/task/tools/modules/inspect_ast/InspectAstResultReducer.ts`
- `src/core/task/tools/modules/inspect_ast/InspectAstTool.ts`
- `src/core/task/tools/modules/inspect_ast/InspectAstValidator.ts`
- `src/core/task/tools/modules/inspect_ast/tool.ts`
- `src/core/task/tools/modules/list_files/index.ts`
- `src/core/task/tools/modules/list_files/tool.ts`
- `src/core/task/tools/modules/list_skills/ListSkillsTool.ts`
- `src/core/task/tools/modules/list_skills/tool.ts`
- `src/core/task/tools/modules/list_tasks/ListTasksTool.ts`
- `src/core/task/tools/modules/list_tasks/tool.ts`
- `src/core/task/tools/modules/new_task/NewTaskTool.ts`
- `src/core/task/tools/modules/new_task/tool.ts`
- `src/core/task/tools/modules/read_file/ReadFileTool.ts`
- `src/core/task/tools/modules/read_file/tool.ts`
- `src/core/task/tools/modules/read_task_transcript/ReadTaskTranscriptTool.ts`
- `src/core/task/tools/modules/read_task_transcript/tool.ts`
- `src/core/task/tools/modules/resolve_task_interaction/ResolveTaskInteractionTool.ts`
- `src/core/task/tools/modules/resolve_task_interaction/tool.ts`
- `src/core/task/tools/modules/respond/CompletionResponseOperation.ts`
- `src/core/task/tools/modules/respond/CompletionVerificationContext.ts`
- `src/core/task/tools/modules/respond/PlanResponseOperation.ts`
- `src/core/task/tools/modules/respond/ProgressResponseOperation.ts`
- `src/core/task/tools/modules/respond/QuestionResponseOperation.ts`
- `src/core/task/tools/modules/respond/RespondTool.ts`
- `src/core/task/tools/modules/respond/ResponseArgumentsValidator.ts`
- `src/core/task/tools/modules/respond/tool.ts`
- `src/core/task/tools/modules/search_files/tool.ts`
- `src/core/task/tools/modules/send_task_message/SendTaskMessageTool.ts`
- `src/core/task/tools/modules/send_task_message/tool.ts`
- `src/core/task/tools/modules/start_task/StartTaskTool.ts`
- `src/core/task/tools/modules/start_task/tool.ts`
- `src/core/task/tools/modules/update_goal/UpdateGoalTool.ts`
- `src/core/task/tools/modules/update_goal/tool.ts`
- `src/core/task/tools/modules/upsert_tool/UpsertTool.ts`
- `src/core/task/tools/modules/upsert_tool/builder-validation.ts`
- `src/core/task/tools/modules/upsert_tool/constants.ts`
- `src/core/task/tools/modules/upsert_tool/scaffold-generator.ts`
- `src/core/task/tools/modules/upsert_tool/subagent-builder.ts`
- `src/core/task/tools/modules/upsert_tool/tool-lifecycle.ts`
- `src/core/task/tools/modules/upsert_tool/tool.ts`
- `src/core/task/tools/modules/use_skill/UseSkillTool.ts`
- `src/core/task/tools/modules/use_skill/tool.ts`
- `src/core/task/tools/modules/use_subagents/UseSubagentsTool.ts`
- `src/core/task/tools/modules/use_subagents/tool.ts`
- `src/core/task/tools/modules/verify_goal/VerifyGoalTool.ts`
- `src/core/task/tools/modules/verify_goal/tool.ts`
- `src/core/task/tools/modules/wait_for_goal_events/WaitForGoalEventsTool.ts`
- `src/core/task/tools/modules/wait_for_goal_events/tool.ts`
- `src/core/task/tools/modules/write_to_file/WriteToFileTool.ts`
- `src/core/task/tools/modules/write_to_file/tool.ts`
- `src/core/task/tools/runtime/ToolExecutionDeadline.ts`
- `src/core/task/tools/runtime/ToolHookRunner.ts`
- `src/core/task/tools/runtime/ToolResultPusher.ts`
- `src/core/task/tools/runtime/ToolSelectionPolicy.ts`
- `src/core/task/tools/runtime/ToolSnapshot.ts`
- `src/core/task/tools/runtime/ToolTimeoutPresentation.ts`
- `src/core/task/tools/runtime/assertValidToolResponse.ts`
- `src/core/task/tools/runtime/normalizeOptionalToolParameters.ts`
- `src/core/task/tools/subagent/AgentConfigLoader.ts`
- `src/core/task/tools/subagent/LatestPresentationQueue.ts`
- `src/core/task/tools/subagent/PresentationDeadline.ts`
- `src/core/task/tools/subagent/SubagentAbortHandler.ts`
- `src/core/task/tools/subagent/SubagentBuilder.ts`
- `src/core/task/tools/subagent/SubagentExecutionPolicy.ts`
- `src/core/task/tools/subagent/SubagentRunHelpers.ts`
- `src/core/task/tools/subagent/SubagentRunProgress.ts`
- `src/core/task/tools/subagent/SubagentRunRecorder.ts`
- `src/core/task/tools/subagent/SubagentRunState.ts`
- `src/core/task/tools/subagent/SubagentRunTypes.ts`
- `src/core/task/tools/subagent/SubagentToolExecutor.ts`
- `src/core/task/tools/subagent/SubagentToolName.ts`
- `src/core/task/tools/types/ToolSkippedByUserMessage.ts`
- `src/core/task/tools/types/UIHelpers.ts`
- `src/core/task/tools/utils/AiOutputTelemetry.ts`
- `src/core/task/tools/utils/CommandSafetyChecker.ts`
- `src/core/task/tools/utils/CommandTimeoutUtils.ts`
- `src/core/task/tools/utils/DiagnosticFormatter.ts`
- `src/core/task/tools/utils/FileProviderOperations.ts`
- `src/core/task/tools/utils/ModelContentProcessor.ts`
- `src/core/task/tools/utils/PatchParser.ts`
- `src/core/task/tools/utils/PathResolver.ts`
- `src/core/task/tools/utils/ToolConstants.ts`
- `src/core/task/tools/utils/ToolDisplayUtils.ts`
- `src/core/task/tools/utils/ToolHookUtils.ts`
- `src/core/task/tools/utils/ToolResponseCombiner.ts`
- `src/core/task/tools/utils/UserApprovedCommandMatcher.ts`
- `src/core/task/tools/utils/index.ts`
- `src/core/task/tools/utils/lineDiffStats.ts`
- `src/core/task/types/HookExecution.ts`
- `src/core/task/types/api-conversation-manager.ts`
- `src/core/task/types/context-loader.ts`
- `src/core/task/types/hook-manager.ts`
- `src/core/task/types/lifecycle-manager.ts`
- `src/core/task/types/response-processor.ts`
- `src/core/task/types/task-messenger.ts`
- `src/core/task/utils/buildUserFeedbackContent.ts`
- `src/core/task/utils/excerpt.ts`
- `src/core/task/utils/extractUserPromptFromContent.ts`
- `src/core/task/utils/symbol-block.ts`
- `src/core/task/utils/ui-projector.ts`

