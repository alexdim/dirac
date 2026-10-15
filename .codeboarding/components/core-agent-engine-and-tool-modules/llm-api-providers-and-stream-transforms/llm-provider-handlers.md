---
component_id: 1.3.1
component_name: LLM Provider Handlers
---

# LLM Provider Handlers

## Component Description

Implements provider-specific LLM API client handlers, model selection, and streaming message generation across supported backends.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/api/providers/anthropic.ts (lines 81-171)
```
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
```

### /Users/highlands/pools/Development/dirac/src/core/api/providers/aihubmix.ts (lines 128-148)
```
	async *createMessage(systemPrompt: string, messages: any[]): ApiStream {
		const modelId = this.requireModelId()
		const route = this.routeModel(modelId)

		switch (route) {
			case "anthropic":
				yield* this.createAnthropicMessage(systemPrompt, messages)
				break
			case "gemini":
				yield* this.createGeminiMessage(systemPrompt, messages)
				break
			case "openai-response":
				yield* this.createOpenaiResponseMessage(systemPrompt, messages)
				break
			case "openai":
				yield* this.createOpenaiMessage(systemPrompt, messages)
				break
			default:
				throw new Error(`Unsupported model route: ${route}`)
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/core/api/providers/bedrock.ts (lines 106-151)
```
	private async *createMessageWithSignal(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools: DiracTool[] | undefined,
		signal: AbortSignal,
	): ApiStream {
		signal.throwIfAborted()
		// cross region inference requires prefixing the model id with the region
		const modelId = await this.getModelId()

		const model = this.getModel()

		// This baseModelId is used to indicate the capabilities of the model.
		// If the user selects a custom model, baseModelId will be set to the base model ID of the custom model.
		// Otherwise, baseModelId will be the same as modelId.
		const baseModelId =
			(this.options.awsBedrockCustomSelected ? this.options.awsBedrockCustomModelBaseId : modelId) || modelId

		const baseConfig = { systemPrompt, messages, modelId, model, tools, abortSignal: signal }

		// Check if this is an Amazon Nova model
		if (baseModelId.includes("amazon.nova")) {
			yield* this.createNovaMessage(baseConfig)
			return
		}

		if (baseModelId.includes("openai")) {
			yield* this.createOpenAIMessage(baseConfig)
			return
		}

		// Check if this is a Qwen model
		if (baseModelId.includes("qwen")) {
			yield* this.createQwenMessage(baseConfig)
			return
		}

		// Check if this is a Deepseek model
		if (baseModelId.includes("deepseek")) {
			yield* this.createDeepseekMessage(baseConfig)
			return
		}

		// Default: Use Anthropic Converse API for all Anthropic models
		yield* this.createAnthropicMessage(baseConfig)
	}
```

### /Users/highlands/pools/Development/dirac/src/core/api/providers/baseten.ts (lines 105-159)
```
	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const maxTokens = this.getOptimalMaxTokens(model)
		const toolCallProcessor = new ToolCallProcessor()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages, undefined, this.getModel().info.supportsImages !== false),
		]

		const stream = await client.chat.completions.create({
			model: model.id,
			max_tokens: maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature: 0,
			tools,
			tool_choice: tools && tools.length > 0 ? "auto" : undefined,
		})

		let didOutputUsage = false

		for await (const chunk of stream) {
			const delta = chunk?.choices?.[0]?.delta

			// Handle reasoning field if present (for reasoning models with parsed output)
			if (delta && "reasoning" in delta && delta?.reasoning) {
				const reasoning = typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning)
				yield {
					type: "reasoning",
					reasoning,
				}
			}

			// Handle content field
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			// Handle usage information - only output once
			if (!didOutputUsage && chunk.usage) {
				yield* this.yieldUsage(model.info, chunk.usage)
				didOutputUsage = true
			}
		}
	}
```


## Source Files:

- `src/core/api/modelProviderSelection.ts`
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
- `src/core/api/types.ts`

