---
component_id: 1
component_name: Core Agent Engine & Tool Modules
---

# Core Agent Engine & Tool Modules

## Component Description

Implements LLM API providers, system prompts, context management, controller RPC handlers, permissions, hooks, and agent tool modules.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/api/providers/anthropic.ts (lines 41-301)
```
export class AnthropicHandler implements ApiHandler {
	private options: AnthropicHandlerOptions
	private client: Anthropic | undefined
	private deliveredInferenceSpeed: InferenceSpeed | undefined

	constructor(options: AnthropicHandlerOptions) {
		this.options = options
	}

	private shouldUseFastMode(modelInfo: ModelInfo): boolean {
		const useFastMode = normalizeInferenceSpeed(this.options.inferenceSpeed) === "fast"
		if (useFastMode && !modelInfo.supportsFastMode) {
			throw new Error("The selected Anthropic model does not support Fast mode")
		}
		return useFastMode
	}

	private ensureClient(): Anthropic {
		if (!this.client) {
			if (!this.options.apiKey) {
				throw new Error("Anthropic API key is required")
			}
			try {
				this.client = new Anthropic({
					apiKey: this.options.apiKey,
					baseURL: this.options.anthropicBaseUrl || undefined,
					defaultHeaders: {
						...buildExternalBasicHeaders(),
						...this.options.anthropicHeaders,
					},
					fetch,
				})
			} catch (error: any) {
				throw new Error(`Error creating Anthropic client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: AnthropicTool[]): ApiStream {
		const client = this.ensureClient()
		this.deliveredInferenceSpeed = undefined
		const model = this.getModel()
		let stream: AnthropicStream<Anthropic.RawMessageStreamEvent> | AsyncIterable<BetaRawMessageStreamEvent>

		const useFastMode = this.shouldUseFastMode(model.info)
		const createFastModeMessage = (
			body: AnthropicMessageCreateParamsStreaming,
		): Promise<AsyncIterable<BetaRawMessageStreamEvent>> => {
			return (
				client.beta.messages.create as unknown as (
					params: BetaMessageCreateParamsStreaming & { speed: "fast" },
				) => Promise<AsyncIterable<BetaRawMessageStreamEvent>>
			)({
				...body,
				betas: [ANTHROPIC_FAST_MODE_BETA],
				speed: "fast",
			})
		}

		const budget_tokens = this.options.thinkingBudgetTokens || 0
		const nativeToolsOn = (tools?.length ?? 0) > 0
		const reasoningOn = (model.info.supportsReasoning ?? false) && (model.info.thinkingAlwaysOn || budget_tokens !== 0)
		const useAdaptive = isAnthropicAdaptiveThinkingSupported(model.id, model.info)

		if (model.info.supportsPromptCache) {
			const anthropicMessages = sanitizeAnthropicMessages(messages, true)
			const requestBody: AnthropicMessageCreateParamsStreaming = {
				model: model.id,
				thinking: reasoningOn
					? useAdaptive
						? { type: "adaptive", display: "summarized" }
						: { type: "enabled", budget_tokens }
					: undefined,
				...(reasoningOn && useAdaptive
					? {
							output_config: {
								effort: getAnthropicReasoningEffort(model.info, this.options.reasoningEffort) as AnthropicEffort,
							},
						}
					: {}),
				max_tokens: model.info.maxTokens || 8192,
				temperature: reasoningOn ? undefined : (model.info.temperature ?? undefined),
				system: [
					{
						text: systemPrompt,
						type: "text",
						cache_control: { type: "ephemeral" },
					},
				],
				messages: anthropicMessages,
				stream: true,
				tools: nativeToolsOn ? tools : undefined,
				tool_choice:
					nativeToolsOn && !reasoningOn && model.info.supportsForcedToolUse !== false ? { type: "any" } : undefined,
			}

			stream = useFastMode ? await createFastModeMessage(requestBody) : await client.messages.create(requestBody)
		} else {
			const requestBody: AnthropicMessageCreateParamsStreaming = {
				model: model.id,
				max_tokens: model.info.maxTokens || 8192,
				thinking: reasoningOn
					? useAdaptive
						? { type: "adaptive", display: "summarized" }
						: { type: "enabled", budget_tokens }
					: undefined,
				...(reasoningOn && useAdaptive
					? {
							output_config: {
								effort: getAnthropicReasoningEffort(model.info, this.options.reasoningEffort) as AnthropicEffort,
							},
						}
					: {}),
				temperature: reasoningOn ? undefined : (model.info.temperature ?? undefined),
				system: [{ text: systemPrompt, type: "text" }],
				messages: sanitizeAnthropicMessages(messages, false),
				tools: nativeToolsOn ? tools : undefined,
				tool_choice: { type: "auto" },
				stream: true,
			}

			stream = useFastMode ? await createFastModeMessage(requestBody) : await client.messages.create(requestBody)
		}

		const lastStartedToolCall = { id: "", name: "", arguments: "" }
		for await (const chunk of stream) {
			yield* this.parseAnthropicChunk(chunk, lastStartedToolCall)
		}
	}

	private *parseAnthropicChunk(
		chunk: any,
		lastStartedToolCall: { id: string; name: string; arguments: string },
	): Generator<any> {
		switch (chunk?.type) {
			case "message_start":
				yield this.parseAnthropicMessageStart(chunk)
				break
			case "message_delta":
				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: chunk.usage.output_tokens || 0,
					stopReason: chunk.delta.stop_reason || undefined,
				}
				break
			case "content_block_start":
				yield* this.parseAnthropicContentBlockStart(chunk, lastStartedToolCall)
				break
			case "content_block_delta":
				yield* this.parseAnthropicContentBlockDelta(chunk, lastStartedToolCall)
				break
			case "content_block_stop":
				lastStartedToolCall.id = ""
				lastStartedToolCall.name = ""
				lastStartedToolCall.arguments = ""
				break
		}
	}

	private parseAnthropicMessageStart(chunk: any): any {
		const usage = chunk.message.usage
		const inferenceSpeed = usage.speed === "fast" ? "fast" : usage.speed === "standard" ? "standard" : undefined
		this.deliveredInferenceSpeed = inferenceSpeed
		return {
			type: "usage",
			inputTokens: usage.input_tokens || 0,
			outputTokens: usage.output_tokens || 0,
			cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
			cacheReadTokens: usage.cache_read_input_tokens || undefined,
			...(inferenceSpeed ? { inferenceSpeed } : {}),
		}
	}

	private *parseAnthropicContentBlockStart(
		chunk: any,
		lastStartedToolCall: { id: string; name: string; arguments: string },
	): Generator<any> {
		switch (chunk.content_block.type) {
			case "thinking":
				yield {
					type: "reasoning",
					reasoning: chunk.content_block.thinking || "",
					signature: chunk.content_block.signature,
				}
				break
			case "redacted_thinking":
				yield { type: "reasoning", reasoning: "[Redacted thinking block]", redacted_data: chunk.content_block.data }
				break
			case "tool_use":
				if (chunk.content_block.id && chunk.content_block.name) {
					lastStartedToolCall.id = chunk.content_block.id
					lastStartedToolCall.name = chunk.content_block.name
					lastStartedToolCall.arguments = ""
					yield {
						type: "tool_calls",
						tool_call: {
							call_id: lastStartedToolCall.id,
							function: { id: lastStartedToolCall.id, name: lastStartedToolCall.name, arguments: "" },
						},
					}
				}
				break
			case "text":
				if (chunk.index > 0) yield { type: "text", text: "\n" }
				yield { type: "text", text: chunk.content_block.text }
				break
		}
	}

	private *parseAnthropicContentBlockDelta(
		chunk: any,
		lastStartedToolCall: { id: string; name: string; arguments: string },
	): Generator<any> {
		switch (chunk.delta.type) {
			case "thinking_delta":
				yield { type: "reasoning", reasoning: chunk.delta.thinking }
				break
			case "signature_delta":
				if (chunk.delta.signature) yield { type: "reasoning", reasoning: "", signature: chunk.delta.signature }
				break
			case "text_delta":
				yield { type: "text", text: chunk.delta.text }
				break
			case "input_json_delta":
				if (lastStartedToolCall.id && lastStartedToolCall.name && chunk.delta.partial_json !== undefined) {
					yield {
						type: "tool_calls",
						tool_call: {
							...lastStartedToolCall,
							function: {
								...lastStartedToolCall,
								id: lastStartedToolCall.id,
								name: lastStartedToolCall.name,
								arguments: chunk.delta.partial_json,
							},
						},
					}
				}
				break
		}
	}

	getModel(): { id: AnthropicModelId; info: ModelInfo } {
		const inferenceSpeed = this.deliveredInferenceSpeed ?? normalizeInferenceSpeed(this.options.inferenceSpeed)
		const modelId = this.options.apiModelId
		if (modelId && modelId in anthropicModels) {
			const id = modelId as AnthropicModelId
			return {
				id,
				info: getModelInfoForInferenceSpeed(anthropicModels[id], inferenceSpeed),
			}
		}
		return {
			id: anthropicDefaultModelId,
			info: getModelInfoForInferenceSpeed(anthropicModels[anthropicDefaultModelId], inferenceSpeed),
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/context/context-management/ContextManager.ts (lines 8-402)
```
export class ContextManager {
	// mapping from the apiMessages outer index to the inner message index to a list of actual changes, ordered by timestamp
	// timestamp is required in order to support full checkpointing, where the changes we apply need to be able to be undone when
	// moving to an earlier conversation history checkpoint - this ordering intuitively allows for binary search on truncation
	// there is also a number stored for each (EditType) which defines which message type it is, for custom handling

	constructor() { }

	/**
	 * Extracts text from a content block, handling both regular text blocks and tool_result wrappers.
	 * For tool_result blocks, extracts text from content[0] (native tool calling format).
	 * @returns The text content, or null if no text could be extracted
	 */
	private getTextFromBlock(block: Anthropic.Messages.ContentBlockParam): string | null {
		if (block.type === "text") {
			return block.text
		}
		if (block.type === "tool_result" && Array.isArray(block.content)) {
			const inner = block.content[0]
			if (inner && "type" in inner && inner.type === "text") {
				return inner.text
			}
		}
		return null
	}

	/**
	 * Sets text in a content block, handling both regular text blocks and tool_result wrappers.
	 * For tool_result blocks, sets text in content[0] (native tool calling format).
	 * @returns true if text was set successfully, false otherwise
	 */
	private setTextInBlock(block: Anthropic.Messages.ContentBlockParam, text: string): boolean {
		if (block.type === "text") {
			block.text = text
			return true
		}
		if (block.type === "tool_result" && Array.isArray(block.content)) {
			const inner = block.content[0]
			if (inner && "type" in inner && inner.type === "text") {
				inner.text = text
				return true
			}
		}
		return false
	}

	/**
	 * Determine whether we should compact context window, based on token counts
	 */
	shouldCompactContextWindow(
		diracMessages: DiracMessage[],
		api: ApiHandler,
		previousApiReqIndex: number,
		contextTokenLimit?: number,
	): boolean {
		if (previousApiReqIndex >= 0) {
			const previousRequest = diracMessages[previousApiReqIndex]
			const previousRequestStatus =
				previousRequest?.content.type === "api_status" ? previousRequest.content.status : undefined
			if (previousRequestStatus) {
				try {
					const { tokensIn, tokensOut, cacheWrites, cacheReads } = previousRequestStatus || {}
					const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

					const { contextWindow, maxAllowedSize } = getContextWindowInfo(api)
					const thresholdTokens = Math.min(contextTokenLimit ?? maxAllowedSize, maxAllowedSize)
					return totalTokens >= thresholdTokens
				} catch {
					return false
				}
			}
		}
		return false
	}

	/**
	 * Get telemetry data for context management decisions
	 * Returns the token counts and context window info that drove summarization
	 */
	getContextTelemetryData(
		diracMessages: DiracMessage[],
		contextWindow: number,
		triggerIndex?: number,
	): {
		tokensUsed: number
		maxContextWindow: number
	} | null {
		// Use provided triggerIndex or fallback to automatic detection
		let targetIndex: number
		if (triggerIndex !== undefined) {
			targetIndex = triggerIndex
		} else {
			// Find all API request indices
			const apiReqIndices = diracMessages
				.map((msg, index) => (msg.content.type === "api_status" ? index : -1))
				.filter((index) => index !== -1)

			// We want the second-to-last API request (the one that caused summarization)
			targetIndex = apiReqIndices.length >= 2 ? apiReqIndices[apiReqIndices.length - 2] : -1
		}

		if (targetIndex >= 0) {
			const targetRequest = diracMessages[targetIndex]
			const targetRequestStatus = targetRequest?.content.type === "api_status" ? targetRequest.content.status : undefined
			if (targetRequestStatus) {
				try {
					const { tokensIn, tokensOut, cacheWrites, cacheReads } = targetRequestStatus || {}
					const tokensUsed = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)


					return {
						tokensUsed,
						maxContextWindow: contextWindow,
					}
				} catch (error) {
					Logger.error("Error parsing API request info for context telemetry:", error)
				}
			}
		}
		return null
	}

	/**
	 * primary entry point for getting up to date context
	 */
	async getNewContextMessagesAndMetadata(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		diracMessages: DiracMessage[],
		api: ApiHandler,
		conversationHistoryDeletedRange: [number, number] | undefined,
		previousApiReqIndex: number,
		taskDirectory: string,
		useAutoCondense: boolean, // option to use new auto-condense or old programmatic context management
	) {
		let updatedConversationHistoryDeletedRange = false

		if (!useAutoCondense) {
			// If the previous API request's total token usage is close to the context window, truncate the conversation history to free up space for the new request
			if (previousApiReqIndex >= 0) {
				const previousRequest = diracMessages[previousApiReqIndex]
				const previousRequestStatus =
					previousRequest?.content.type === "api_status" ? previousRequest.content.status : undefined
				if (previousRequestStatus) {
					const { tokensIn, tokensOut, cacheWrites, cacheReads } = previousRequestStatus || {}
					const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
					const { maxAllowedSize } = getContextWindowInfo(api)

					// This is the most reliable way to know when we're close to hitting the context window.
					if (totalTokens >= maxAllowedSize) {
						// Since the user may switch between models with different context windows, truncating half may not be enough (ie if switching from claude 200k to deepseek 64k, half truncation will only remove 100k tokens, but we need to remove much more)
						// So if totalTokens/2 is greater than maxAllowedSize, we truncate 3/4 instead of 1/2
						const keep = totalTokens / 2 > maxAllowedSize ? "quarter" : "half"

						// NOTE: it's okay that we overwriteConversationHistory in resume task since we're only ever removing the last user message and not anything in the middle which would affect this range
						conversationHistoryDeletedRange = this.getNextTruncationRange(
							apiConversationHistory,
							conversationHistoryDeletedRange,
							keep,
						)

						updatedConversationHistoryDeletedRange = true
					}
				}
			}
		}

		const truncatedConversationHistory = this.getAndAlterTruncatedMessages(
			apiConversationHistory,
			conversationHistoryDeletedRange,
		)

		return {
			conversationHistoryDeletedRange: conversationHistoryDeletedRange,
			updatedConversationHistoryDeletedRange: updatedConversationHistoryDeletedRange,
			truncatedConversationHistory: truncatedConversationHistory,
		}
	}

	/**
	 * get truncation range
	 */
	public getNextTruncationRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		currentDeletedRange: [number, number] | undefined,
		keep: "none" | "lastTwo" | "half" | "quarter",
	): [number, number] {
		// We always keep the first user-assistant pairing, and truncate an even number of messages from there
		const rangeStartIndex = 2 // index 0 and 1 are kept
		const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 2 // inclusive starting index

		let messagesToRemove: number
		if (keep === "none") {
			// Removes all messages beyond the first core user/assistant message pair
			messagesToRemove = Math.max(apiMessages.length - startOfRest, 0)
		} else if (keep === "lastTwo") {
			// Keep the last user-assistant pair in addition to the first core user/assistant message pair
			messagesToRemove = Math.max(apiMessages.length - startOfRest - 2, 0)
		} else if (keep === "half") {
			// Remove half of remaining user-assistant pairs
			// We first calculate half of the messages then divide by 2 to get the number of pairs.
			// After flooring, we multiply by 2 to get the number of messages.
			// Note that this will also always be an even number.
			messagesToRemove = Math.floor((apiMessages.length - startOfRest) / 4) * 2 // Keep even number
		} else {
			// Remove 3/4 of remaining user-assistant pairs
			// We calculate 3/4ths of the messages then divide by 2 to get the number of pairs.
			// After flooring, we multiply by 2 to get the number of messages.
			// Note that this will also always be an even number.
			messagesToRemove = Math.floor(((apiMessages.length - startOfRest) * 3) / 4 / 2) * 2
		}

		let rangeEndIndex = startOfRest + messagesToRemove - 1 // inclusive ending index

		// Make sure that the last message being removed is a assistant message, so the next message after the initial user-assistant pair is an assistant message. This preserves the user-assistant-user-assistant structure.
		// NOTE: anthropic format messages are always user-assistant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout dirac)
		if (apiMessages[rangeEndIndex] && apiMessages[rangeEndIndex].role !== "assistant") {
			rangeEndIndex -= 1
		}

		// this is an inclusive range that will be removed from the conversation history
		return [rangeStartIndex, rangeEndIndex]
	}

	/**
	 * external interface to support old calls
	 */
	public getTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		return this.getAndAlterTruncatedMessages(messages, deletedRange)
	}

	/**
	 * apply all required truncation methods to the messages in context
	 */
	private getAndAlterTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		if (messages.length <= 1) {
			return messages
		}

		const updatedMessages = this.applyContextHistoryUpdates(messages, deletedRange ? deletedRange[1] + 1 : 2)

		// Validate and fix tool_use/tool_result pairing
		this.ensureToolResultsFollowToolUse(updatedMessages)

		return updatedMessages
	}
	private applyContextHistoryUpdates(
		messages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
	): Anthropic.Messages.MessageParam[] {
		const firstChunk = messages.slice(0, 2) // get first user-assistant pair
		const secondChunk = messages.slice(startFromIndex) // get remaining messages within context
		const messagesToUpdate = [...firstChunk, ...secondChunk]

		// Remove orphaned tool_results from the first message after truncation (if it's a user message)
		if (startFromIndex > 2 && messagesToUpdate.length > 2) {
			const firstMessageAfterTruncation = messagesToUpdate[2]
			if (firstMessageAfterTruncation.role === "user" && Array.isArray(firstMessageAfterTruncation.content)) {
				const hasToolResults = firstMessageAfterTruncation.content.some((block) => block.type === "tool_result")
				if (hasToolResults) {
					// Clone and filter out all tool_result blocks
					messagesToUpdate[2] = cloneDeep(firstMessageAfterTruncation)
						; (messagesToUpdate[2].content as Anthropic.Messages.ContentBlockParam[]) = (
							firstMessageAfterTruncation.content as Anthropic.Messages.ContentBlockParam[]
						).filter((block) => block.type !== "tool_result")
				}
			}
		}

		return messagesToUpdate
	}

	/**
	 * Ensures that every tool_use block in assistant messages has a corresponding tool_result in the next user message,
	 * and that tool_result blocks immediately follow their corresponding tool_use blocks
	 */
	private ensureToolResultsFollowToolUse(messages: Anthropic.Messages.MessageParam[]): void {
		// 1. Ensure first message (if user) doesn't have tool_results
		const firstMessage = messages[0]
		if (firstMessage && firstMessage.role === "user" && Array.isArray(firstMessage.content)) {
			const hasToolResults = firstMessage.content.some((block) => block.type === "tool_result")
			if (hasToolResults) {
				const clonedMessage = cloneDeep(firstMessage)
				clonedMessage.content = (firstMessage.content as Anthropic.Messages.ContentBlockParam[]).filter(
					(block) => block.type !== "tool_result",
				)
				messages[0] = clonedMessage
			}
		}

		for (let i = 0; i < messages.length - 1; i++) {
			const message = messages[i]

			// Only process assistant messages with content
			if (message.role !== "assistant" || !Array.isArray(message.content)) {
				continue
			}

			// Extract tool_use IDs in order
			const toolUseIds: string[] = []
			for (const block of message.content) {
				if (block.type === "tool_use" && block.id) {
					toolUseIds.push(block.id)
				}
			}

			const nextMessage = messages[i + 1]

			// Skip if next message is not a user message
			if (nextMessage.role !== "user") {
				continue
			}

			// Ensure content is an array
			if (!Array.isArray(nextMessage.content)) {
				nextMessage.content = []
			}

			// Separate tool_results from other blocks in a single pass
			const toolResultMap = new Map<string, Anthropic.Messages.ToolResultBlockParam>()
			const otherBlocks: Anthropic.Messages.ContentBlockParam[] = []
			let needsUpdate = false

			for (const block of nextMessage.content) {
				if (block.type === "tool_result" && block.tool_use_id) {
					toolResultMap.set(block.tool_use_id, block)
				} else {
					otherBlocks.push(block)
				}
			}

			// Check if reordering is needed (tool_results not at start in correct order)
			if (toolResultMap.size > 0) {
				let expectedIndex = 0
				for (let j = 0; j < nextMessage.content.length && expectedIndex < toolUseIds.length; j++) {
					const block = nextMessage.content[j]
					if (block.type === "tool_result" && block.tool_use_id === toolUseIds[expectedIndex]) {
						expectedIndex++
					} else if (block.type === "tool_result" || expectedIndex < toolUseIds.length) {
						needsUpdate = true
						break
					}
				}
				if (!needsUpdate && (expectedIndex < toolResultMap.size || expectedIndex < toolUseIds.length)) {
					needsUpdate = true
				}
			} else if (toolUseIds.length > 0) {
				needsUpdate = true
			}

			// Add missing tool_results
			for (const toolUseId of toolUseIds) {
				if (!toolResultMap.has(toolUseId)) {
					toolResultMap.set(toolUseId, {
						type: "tool_result",
						tool_use_id: toolUseId,
						content: "result missing",
					})
					needsUpdate = true
				}
			}

			// Only modify if changes are needed
			if (!needsUpdate) {
				continue
			}

			// Build new content: tool_results first (in toolUseIds order), then other blocks
			const newContent: Anthropic.Messages.ContentBlockParam[] = []

			// Add tool_results in the order of toolUseIds
			const processedToolResults = new Set<string>()
			for (const toolUseId of toolUseIds) {
				const toolResult = toolResultMap.get(toolUseId)
				if (toolResult) {
					newContent.push(toolResult)
					processedToolResults.add(toolUseId)
				}
			}

			// Add all other blocks
			newContent.push(...otherBlocks)

			// Clone and update the message
			const clonedMessage = cloneDeep(nextMessage)
			clonedMessage.content = newContent
			messages[i + 1] = clonedMessage
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/permissions/CommandPermissionController.ts (lines 29-319)
```
export class CommandPermissionController {
	private workspaceRoot: string | null = null
	private fileWatcher?: FSWatcher
	private readonly watcherCloser = new ChokidarWatcherCloser()
	private config: CommandPermissionConfig | null = null
	private readonly ruleEvaluator = new PermissionRuleEvaluator()
	private readonly commandParser = new CommandParser()
	private readonly dangerousCharDetector = new DangerousCharDetector()

	constructor(private watcherFactory: WatcherFactory = chokidar.watch) {
		this.config = this.parseConfigFromEnv()
	}

	/** Initialize the controller with a workspace root and load configuration from file. */
	async initialize(workspaceRoot: string): Promise<void> {
		this.workspaceRoot = workspaceRoot
		await this.loadConfig()
		await this.setupFileWatcher()
	}

	/** Set up a file watcher for .dirac/permissions.json */
	private async setupFileWatcher(): Promise<void> {
		await this.watcherCloser.closeAll()
		if (this.fileWatcher) {
			const previousWatcher = this.fileWatcher
			this.fileWatcher = undefined
			await this.watcherCloser.close(previousWatcher)
		}
		if (!this.workspaceRoot) return

		const configPath = path.join(this.workspaceRoot, ".dirac", "permissions.json")
		try {
			const watcher = this.watcherFactory(configPath, {
				persistent: true,
				ignoreInitial: true,
				awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 100 },
				atomic: true,
			})
			this.fileWatcher = watcher
			watcher.on("error", (error) => {
				if (this.fileWatcher !== watcher) return
				this.fileWatcher = undefined
				Logger.error("Command permissions live reload is disabled after watcher failure:", error)
				void this.watcherCloser
					.close(watcher)
					.catch((closeError) => Logger.error("Failed to close disabled command permissions watcher:", closeError))
			})
			watcher.on("all", (_event) => {
				if (this.fileWatcher !== watcher) return
				void this.loadConfig().catch((error) => {
					Logger.error("Failed to reload command permissions:", error)
				})
			})
		} catch (error) {
			this.fileWatcher = undefined
			Logger.error("Command permissions live reload could not start and is disabled:", error)
		}
	}

	/** Load configuration from environment and file. */
	private async loadConfig(): Promise<void> {
		const envConfig = this.parseConfigFromEnv()
		const fileConfig = await this.loadConfigFromFile()

		this.config = {
			...envConfig,
			...fileConfig,
			rules: [...(envConfig?.rules || []), ...(fileConfig?.rules || [])],
		}
	}

	/** Load configuration from .dirac/permissions.json */
	private async loadConfigFromFile(): Promise<CommandPermissionConfig | null> {
		if (!this.workspaceRoot) return null

		const configPath = path.join(this.workspaceRoot, ".dirac", "permissions.json")
		if (!(await fileExistsAtPath(configPath))) return null

		try {
			const content = await fs.readFile(configPath, "utf8")
			return JSON.parse(content) as CommandPermissionConfig
		} catch (_error) {
			return null
		}
	}

	/** Add a new permission rule and save to file. */
	async addRule(rule: ToolPermissionRule): Promise<void> {
		const currentConfig = (await this.loadConfigFromFile()) || { rules: [] }
		const rules = currentConfig.rules || []

		// Check if rule already exists to avoid duplicates
		const exists = rules.some((r) => r.tool === rule.tool && r.pattern === rule.pattern && r.action === rule.action)

		if (!exists) {
			rules.push(rule)
			await this.saveConfig({ ...currentConfig, rules })
		}
	}

	/** List project-scoped rules persisted in .dirac/permissions.json. */
	async listRules(): Promise<ToolPermissionRule[]> {
		const config = await this.loadConfigFromFile()
		return config?.rules || []
	}

	/** Delete one project-scoped rule by its exact persisted value. */
	async deleteRule(rule: ToolPermissionRule): Promise<void> {
		const currentConfig = await this.loadConfigFromFile()
		if (!currentConfig?.rules) {
			return
		}

		const rules = currentConfig.rules.filter(
			(candidate) => candidate.tool !== rule.tool || candidate.pattern !== rule.pattern || candidate.action !== rule.action,
		)
		if (rules.length === currentConfig.rules.length) {
			return
		}

		await this.saveConfig({ ...currentConfig, rules })
	}

	async saveConfig(config: CommandPermissionConfig): Promise<void> {
		if (!this.workspaceRoot) {
			throw new Error("Workspace root not set. Cannot save permissions.")
		}

		const diracDir = path.join(this.workspaceRoot, ".dirac")
		const configPath = path.join(diracDir, "permissions.json")

		await fs.mkdir(diracDir, { recursive: true })
		await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8")

		// Update in-memory config. loadConfig() will be called by file watcher,
		// but we update it here for immediate effect.
		const envConfig = this.parseConfigFromEnv()
		this.config = {
			...envConfig,
			...config,
			rules: [...(envConfig?.rules || []), ...(config.rules || [])],
		}
	}

	private isConfigEmpty(): boolean {
		if (!this.config) return true
		return !(this.config.rules?.length || this.config.allow?.length || this.config.deny?.length)
	}

	/** Parse the DIRAC_COMMAND_PERMISSIONS environment variable. */
	private parseConfigFromEnv(): CommandPermissionConfig | null {
		const envValue = commandPermissionsEnv()
		if (!envValue) return null

		try {
			const parsed = JSON.parse(envValue)
			return {
				allow: Array.isArray(parsed.allow) ? parsed.allow : undefined,
				deny: Array.isArray(parsed.deny) ? parsed.deny : undefined,
				allowRedirects: typeof parsed.allowRedirects === "boolean" ? parsed.allowRedirects : undefined,
			}
		} catch (error) {
			Logger.error(`Failed to parse ${COMMAND_PERMISSIONS_ENV_VAR}:`, error)
			return null
		}
	}

	validateTool(tool: string, pattern?: string): PermissionValidationResult {
		if (this.isConfigEmpty()) {
			return { allowed: true, reason: "no_config" }
		}

		// Check general rules first (deny takes precedence, then allow)
		if (this.config?.rules) {
			const denyResult = this.matchToolRule(tool, pattern, "deny")
			if (denyResult) return denyResult

			const allowResult = this.matchToolRule(tool, pattern, "allow")
			if (allowResult) return allowResult
		}

		// Fallback to legacy command validation if it's execute_command
		if (tool === "execute_command" && pattern) {
			return this.validateCommand(pattern)
		}

		return { allowed: true, reason: "no_config" }
	}

	/** Match a tool against rules of a specific action (deny or allow). Returns null if no match. */
	private matchToolRule(
		tool: string,
		pattern: string | undefined,
		action: "allow" | "deny",
	): PermissionValidationResult | null {
		if (!this.config?.rules) return null

		for (const rule of this.config.rules) {
			if (rule.action !== action || !this.ruleEvaluator.matchesRule(rule, tool, pattern)) continue

			if (action === "deny") {
				return { allowed: false, reason: "denied", matchedPattern: rule.pattern }
			}

			// Allow rule matched - for execute_command, still run full validation (dangerous chars, redirects)
			if (tool === "execute_command" && pattern) {
				// Explicit allow means we bypass dangerous char checks (user trusted this pattern)
				const validationResult = this.validateCommand(pattern, true)
				if (validationResult.allowed) {
					return { ...validationResult, matchedPattern: rule.pattern }
				}
				return validationResult
			}
			return { allowed: true, reason: "allowed", matchedPattern: rule.pattern }
		}

		return null
	}

	/**
	 * Validate a command against allow/deny rules.
	 * @param allowDangerous - If true, bypasses checks for dangerous characters (newlines, backticks).
	 *                        Use this only when the command has already matched an explicit allow rule.
	 */
	validateCommand(command: string, allowDangerous = false): PermissionValidationResult {
		// No config = allow everything (backward compatibility)
		if (this.isConfigEmpty()) {
			return { allowed: true, reason: "no_config" }
		}

		// Check for dangerous characters first (backticks in double quotes, newlines outside quotes)
		if (!allowDangerous) {
			const dangerousChar = this.dangerousCharDetector.detect(command)
			if (dangerousChar) {
				return { allowed: false, reason: "shell_operator_detected", detectedOperator: dangerousChar.operator }
			}
		}

		// Parse the command into segments recursively
		const parseResult = this.commandParser.parseCommandSegments(command)
		if (!parseResult) {
			// Parsing failed - be conservative and block
			return { allowed: false, reason: "shell_operator_detected", detectedOperator: "parse_error" }
		}

		return this.validateParsedCommand(parseResult)
	}

	/** Recursively validate a parsed command structure. */
	private validateParsedCommand(parsed: ParsedCommand): PermissionValidationResult {
		// Check if redirects are allowed
		if (parsed.hasRedirects && !this.config?.allowRedirects) {
			return { allowed: false, reason: "redirect_detected" }
		}

		// Validate each command segment
		const isMultiSegment = parsed.segments.length > 1 || parsed.subshells.length > 0
		for (const segment of parsed.segments) {
			const result = this.ruleEvaluator.validateSingleCommand(segment, this.config!)
			if (!result.allowed) {
				return isMultiSegment ? this.toSegmentResult(result, segment) : result
			}
		}

		// Recursively validate subshell contents
		for (const subshell of parsed.subshells) {
			const result = this.validateParsedCommand(subshell)
			if (!result.allowed) return result
		}

		return { allowed: true, reason: "allowed" }
	}

	/** Convert a validation result to a segment-specific result for multi-segment commands. */
	private toSegmentResult(result: PermissionValidationResult, segment: string): PermissionValidationResult {
		const segmentReason =
			result.reason === "denied"
				? "segment_denied"
				: result.reason === "no_match_deny_default"
					? "segment_no_match"
					: result.reason
		return { ...result, failedSegment: segment, reason: segmentReason }
	}

	/** Clean up resources when the controller is no longer needed. */
	async dispose(): Promise<void> {
		const watcher = this.fileWatcher
		this.fileWatcher = undefined
		await this.watcherCloser.closeAll(watcher ? [watcher] : [])
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/index.ts (lines 16-20)
```
export async function getSystemPrompt(context: SystemPromptContext, toolSnapshot: ToolRequestSnapshot) {
	const registry = PromptRegistry.getInstance()
	const systemPrompt = await registry.get(context, toolSnapshot)
	return { systemPrompt }
}
```


## Source Files:

- `src/core/api/ApiConfigurationError.ts`
- `src/core/api/ApiRequestRetryPolicy.ts`
- `src/core/api/adapters/index.ts`
- `src/core/api/modelProviderSelection.ts`
- `src/core/api/openrouter/openrouter-endpoints.ts`
- `src/core/api/providers/aihubmix.ts`
- `src/core/api/providers/anthropic.ts`
- `src/core/api/providers/baseten.ts`
- `src/core/api/providers/bedrock-client.ts`
- `src/core/api/providers/bedrock-converse-utils.ts`
- `src/core/api/providers/bedrock-stream-parser.ts`
- `src/core/api/providers/bedrock.ts`
- `src/core/api/providers/cerebras.ts`
- `src/core/api/providers/claude-code.ts`
- `src/core/api/providers/deepseek.ts`
- `src/core/api/providers/dify.ts`
- `src/core/api/providers/doubao.ts`
- `src/core/api/providers/fireworks.ts`
- `src/core/api/providers/gemini.ts`
- `src/core/api/providers/github-copilot.ts`
- `src/core/api/providers/groq.ts`
- `src/core/api/providers/huawei-cloud-maas.ts`
- `src/core/api/providers/huggingface.ts`
- `src/core/api/providers/litellm.ts`
- `src/core/api/providers/lmstudio.ts`
- `src/core/api/providers/minimax.ts`
- `src/core/api/providers/mistral.ts`
- `src/core/api/providers/moonshot.ts`
- `src/core/api/providers/nebius.ts`
- `src/core/api/providers/nousresearch.ts`
- `src/core/api/providers/openai-codex.ts`
- `src/core/api/providers/openai-native.ts`
- `src/core/api/providers/openai-responses-compatible.ts`
- `src/core/api/providers/openai-responses-utils.ts`
- `src/core/api/providers/openai.ts`
- `src/core/api/providers/openrouter.ts`
- `src/core/api/providers/qwen-code.ts`
- `src/core/api/providers/qwen.ts`
- `src/core/api/providers/requesty.ts`
- `src/core/api/providers/sambanova.ts`
- `src/core/api/providers/together.ts`
- `src/core/api/providers/types.ts`
- `src/core/api/providers/vercel-ai-gateway.ts`
- `src/core/api/providers/vertex.ts`
- `src/core/api/providers/wandb.ts`
- `src/core/api/providers/xai.ts`
- `src/core/api/providers/zai.ts`
- `src/core/api/retry.ts`
- `src/core/api/transform/anthropic-format.ts`
- `src/core/api/transform/gemini-format.ts`
- `src/core/api/transform/mistral-format.ts`
- `src/core/api/transform/openai-format.ts`
- `src/core/api/transform/openai-response-format.ts`
- `src/core/api/transform/openai-usage.ts`
- `src/core/api/transform/openrouter-stream.ts`
- `src/core/api/transform/r1-format.ts`
- `src/core/api/transform/stream.ts`
- `src/core/api/transform/tool-call-processor.ts`
- `src/core/api/transform/vercel-ai-gateway-stream.ts`
- `src/core/api/types.ts`
- `src/core/api/utils/messages_api_support.ts`
- `src/core/api/utils/responses_api_support.ts`
- `src/core/assistant-message/index.ts`
- `src/core/assistant-message/parse-assistant-message.ts`
- `src/core/commands/reconstructTaskHistory.ts`
- `src/core/context/context-management/ContextManager.ts`
- `src/core/context/context-management/context-error-handling.ts`
- `src/core/context/context-management/context-window-utils.ts`
- `src/core/context/context-tracking/ContextTrackerTypes.ts`
- `src/core/context/context-tracking/EnvironmentContextTracker.ts`
- `src/core/context/context-tracking/ModelContextTracker.ts`
- `src/core/context/instructions/user-instructions/RuleContextBuilder.ts`
- `src/core/context/instructions/user-instructions/dirac-rules.ts`
- `src/core/context/instructions/user-instructions/external-rules.ts`
- `src/core/context/instructions/user-instructions/rule-helpers.ts`
- `src/core/context/instructions/user-instructions/skills.ts`
- `src/core/context/instructions/user-instructions/workflows.ts`
- `src/core/controller/auth/AuthController.ts`
- `src/core/controller/commands/addToDirac.ts`
- `src/core/controller/commands/explainWithDirac.ts`
- `src/core/controller/commands/fixWithDirac.ts`
- `src/core/controller/commands/improveWithDirac.ts`
- `src/core/controller/file/copyToClipboard.ts`
- `src/core/controller/file/createHook.ts`
- `src/core/controller/file/createRuleFile.ts`
- `src/core/controller/file/createSkillFile.ts`
- `src/core/controller/file/deleteHook.ts`
- `src/core/controller/file/deleteRuleFile.ts`
- `src/core/controller/file/deleteSkillFile.ts`
- `src/core/controller/file/getRelativePaths.ts`
- `src/core/controller/file/ifFileExistsRelativePath.ts`
- `src/core/controller/file/openDiskConversationHistory.ts`
- `src/core/controller/file/openFile.ts`
- `src/core/controller/file/openFileRelativePath.ts`
- `src/core/controller/file/openImage.ts`
- `src/core/controller/file/openMention.ts`
- `src/core/controller/file/refreshHooks.ts`
- `src/core/controller/file/refreshRules.ts`
- `src/core/controller/file/refreshSkills.ts`
- `src/core/controller/file/searchCommits.ts`
- `src/core/controller/file/searchFiles.ts`
- `src/core/controller/file/searchFilesHelpers.ts`
- `src/core/controller/file/selectFiles.ts`
- `src/core/controller/file/toggleAgentsRule.ts`
- `src/core/controller/file/toggleCursorRule.ts`
- `src/core/controller/file/toggleDiracRule.ts`
- `src/core/controller/file/toggleHook.ts`
- `src/core/controller/file/toggleSkill.ts`
- `src/core/controller/file/toggleWindsurfRule.ts`
- `src/core/controller/file/toggleWorkflow.ts`
- `src/core/controller/goal/pauseGoal.ts`
- `src/core/controller/goal/resumeGoal.ts`
- `src/core/controller/goal/selectGoal.ts`
- `src/core/controller/goal/sendGoalMessage.ts`
- `src/core/controller/goal/steerGoal.ts`
- `src/core/controller/goal/stopGoal.ts`
- `src/core/controller/grpc-handler.ts`
- `src/core/controller/grpc-recorder/grpc-recorder.builder.ts`
- `src/core/controller/grpc-recorder/grpc-recorder.ts`
- `src/core/controller/grpc-recorder/log-file-handler.ts`
- `src/core/controller/grpc-recorder/test-hooks.ts`
- `src/core/controller/grpc-recorder/types.ts`
- `src/core/controller/grpc-request-registry.ts`
- `src/core/controller/grpc-service.ts`
- `src/core/controller/index-initializer.ts`
- `src/core/controller/models/apiConfigurationPersistence.ts`
- `src/core/controller/models/apiConfigurationTransaction.ts`
- `src/core/controller/models/authenticateOpenAiCodex.ts`
- `src/core/controller/models/fetchAndCacheModels.ts`
- `src/core/controller/models/fetchOpenRouterModelRankings.ts`
- `src/core/controller/models/getAihubmixModels.ts`
- `src/core/controller/models/getLmStudioModels.ts`
- `src/core/controller/models/getOpenRouterEndpoints.ts`
- `src/core/controller/models/getVsCodeLmModels.ts`
- `src/core/controller/models/refreshBasetenModelsRpc.ts`
- `src/core/controller/models/refreshGithubCopilotModels.ts`
- `src/core/controller/models/refreshGroqModels.ts`
- `src/core/controller/models/refreshGroqModelsRpc.ts`
- `src/core/controller/models/refreshHuggingFaceModels.ts`
- `src/core/controller/models/refreshLiteLlmModels.ts`
- `src/core/controller/models/refreshLiteLlmModelsRpc.ts`
- `src/core/controller/models/refreshOpenAiCodexUsage.ts`
- `src/core/controller/models/refreshOpenAiModels.ts`
- `src/core/controller/models/refreshOpenRouterModels.ts`
- `src/core/controller/models/refreshOpenRouterModelsRpc.ts`
- `src/core/controller/models/refreshRequestyModels.ts`
- `src/core/controller/models/refreshVercelAiGatewayModels.ts`
- `src/core/controller/models/refreshVercelAiGatewayModelsRpc.ts`
- `src/core/controller/models/signOutOpenAiCodex.ts`
- `src/core/controller/models/subscribeToLiteLlmModels.ts`
- `src/core/controller/models/subscribeToOpenRouterModels.ts`
- `src/core/controller/models/updateApiConfiguration.ts`
- `src/core/controller/models/updateApiConfigurationPartial.ts`
- `src/core/controller/models/updateApiConfigurationProto.ts`
- `src/core/controller/slash/condense.ts`
- `src/core/controller/slash/getAvailableSlashCommands.ts`
- `src/core/controller/state/StateController.ts`
- `src/core/controller/state/StatePublicationQueue.ts`
- `src/core/controller/state/activateModelProviderPreset.ts`
- `src/core/controller/state/captureOnboardingProgress.ts`
- `src/core/controller/state/dismissBanner.ts`
- `src/core/controller/state/flushPendingState.ts`
- `src/core/controller/state/getAvailableTerminalProfiles.ts`
- `src/core/controller/state/getLatestState.ts`
- `src/core/controller/state/getProcessInfo.ts`
- `src/core/controller/state/persistModeSelection.ts`
- `src/core/controller/state/reasoningEffort.ts`
- `src/core/controller/state/resetState.ts`
- `src/core/controller/state/setWelcomeViewCompleted.ts`
- `src/core/controller/state/settingsApiConfig.ts`
- `src/core/controller/state/settingsTerminalProfile.ts`
- `src/core/controller/state/settingsWebview.ts`
- `src/core/controller/state/subscribeToState.ts`
- `src/core/controller/state/testOtelConnection.ts`
- `src/core/controller/state/testPromptUploading.ts`
- `src/core/controller/state/toggleFavoriteModel.ts`
- `src/core/controller/state/togglePlanActModeProto.ts`
- `src/core/controller/state/trackBannerEvent.ts`
- `src/core/controller/state/updateAutoApprovalSettings.ts`
- `src/core/controller/state/updateInfoBannerVersion.ts`
- `src/core/controller/state/updateModelBannerVersion.ts`
- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/state/updateTelemetrySetting.ts`
- `src/core/controller/state/updateTerminalConnectionTimeout.ts`
- `src/core/controller/state/updateTerminalReuseEnabled.ts`
- `src/core/controller/task/askResponse.ts`
- `src/core/controller/task/cancelBackgroundCommand.ts`
- `src/core/controller/task/cancelTask.ts`
- `src/core/controller/task/clearTask.ts`
- `src/core/controller/task/deleteAllTaskHistory.ts`
- `src/core/controller/task/deleteTasksWithIds.ts`
- `src/core/controller/task/executeQuickWin.ts`
- `src/core/controller/task/getTaskHistory.ts`
- `src/core/controller/task/getTotalTasksSize.ts`
- `src/core/controller/task/newTask.ts`
- `src/core/controller/task/showTaskWithId.ts`
- `src/core/controller/task/steerTask.ts`
- `src/core/controller/task/taskCompletionViewChanges.ts`
- `src/core/controller/task/taskFeedback.ts`
- `src/core/controller/task/toggleTaskFavorite.ts`
- `src/core/controller/ui/UiController.ts`
- `src/core/controller/ui/assembleAuthState.ts`
- `src/core/controller/ui/assembleModelState.ts`
- `src/core/controller/ui/assembleRuntimeState.ts`
- `src/core/controller/ui/assembleToolState.ts`
- `src/core/controller/ui/discoverAvailableSkills.ts`
- `src/core/controller/ui/getWebviewHtml.ts`
- `src/core/controller/ui/githubCopilotLogin.ts`
- `src/core/controller/ui/initializeWebview.ts`
- `src/core/controller/ui/onDidShowAnnouncement.ts`
- `src/core/controller/ui/openUrl.ts`
- `src/core/controller/ui/openWalkthrough.ts`
- `src/core/controller/ui/processTaskHistory.ts`
- `src/core/controller/ui/scrollToSettings.ts`
- `src/core/controller/ui/setTerminalExecutionMode.ts`
- `src/core/controller/ui/subscribeToAccountButtonClicked.ts`
- `src/core/controller/ui/subscribeToAddToInput.ts`
- `src/core/controller/ui/subscribeToChatButtonClicked.ts`
- `src/core/controller/ui/subscribeToHistoryButtonClicked.ts`
- `src/core/controller/ui/subscribeToRelinquishControl.ts`
- `src/core/controller/ui/subscribeToSettingsButtonClicked.ts`
- `src/core/controller/ui/subscribeToShowWebview.ts`
- `src/core/controller/ui/subscribeToWorktreesButtonClicked.ts`
- `src/core/controller/web/checkIsImageUrl.ts`
- `src/core/controller/web/fetchOpenGraphData.ts`
- `src/core/controller/worktree/checkoutBranch.ts`
- `src/core/controller/worktree/createWorktree.ts`
- `src/core/controller/worktree/createWorktreeInclude.ts`
- `src/core/controller/worktree/deleteWorktree.ts`
- `src/core/controller/worktree/getAvailableBranches.ts`
- `src/core/controller/worktree/getWorktreeDefaults.ts`
- `src/core/controller/worktree/getWorktreeIncludeStatus.ts`
- `src/core/controller/worktree/listWorktrees.ts`
- `src/core/controller/worktree/mergeWorktree.ts`
- `src/core/controller/worktree/switchWorktree.ts`
- `src/core/controller/worktree/trackWorktreeViewOpened.ts`
- `src/core/goal/GoalAccounting.ts`
- `src/core/goal/GoalCoordinatorEnvironment.ts`
- `src/core/goal/GoalHistory.ts`
- `src/core/goal/GoalLifecycle.ts`
- `src/core/goal/GoalStore.ts`
- `src/core/goal/GoalTaskEnvironment.ts`
- `src/core/goal/GoalTaskFactory.ts`
- `src/core/goal/validateGoalRecord.ts`
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
- `src/core/locks/SqliteLockManager.ts`
- `src/core/locks/types.ts`
- `src/core/mentions/index.ts`
- `src/core/models/modelProviderPresets.ts`
- `src/core/permissions/CommandParser.ts`
- `src/core/permissions/CommandPermissionController.ts`
- `src/core/permissions/DangerousCharDetector.ts`
- `src/core/permissions/PermissionRuleEvaluator.ts`
- `src/core/permissions/UtilityPermissionDecisionService.ts`
- `src/core/permissions/types.ts`
- `src/core/prompts/system-prompt/index.ts`
- `src/core/prompts/system-prompt/registry/DiracToolSet.ts`
- `src/core/prompts/system-prompt/registry/PromptBuilder.ts`
- `src/core/prompts/system-prompt/registry/PromptRegistry.ts`
- `src/core/prompts/system-prompt/spec.ts`
- `src/core/prompts/system-prompt/templates/TemplateEngine.ts`
- `src/core/prompts/system-prompt/templates/placeholders.ts`
- `src/core/prompts/system-prompt/tools/init.ts`
- `src/core/prompts/system-prompt/types.ts`
- `src/core/slash-commands/BuiltinCommandExecutor.ts`
- `src/core/slash-commands/PermissionsCommandHandler.ts`
- `src/core/slash-commands/SkillCommandExecutor.ts`
- `src/core/slash-commands/WorkflowCommandExecutor.ts`
- `src/core/slash-commands/commandParser.ts`
- `src/core/slash-commands/commandRegistry.ts`
- `src/core/slash-commands/index.ts`
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
- `src/core/text-condensation/ConversationCondensationService.ts`
- `src/core/text-condensation/ConversationTextSerializer.ts`
- `src/core/text-condensation/CurrentTurnUserRequests.ts`
- `src/core/text-condensation/TextCondensationTemplateRegistry.ts`
- `src/core/text-condensation/TextCondenser.ts`
- `src/core/text-condensation/UtilityModelTextCondenser.ts`
- `src/core/text-condensation/UtilityTextCondensationAvailability.ts`
- `src/core/text-condensation/templates/index.ts`
- `src/core/text-condensation/templates/taskHandoffTemplate.ts`
- `src/core/utility-model/UtilityModelRunner.ts`
- `src/core/utility-model/UtilityModelSelection.ts`
- `src/core/webview/getNonce.ts`

