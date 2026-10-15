---
component_id: 1.3
component_name: LLM API Providers & Stream Transforms
---

# LLM API Providers & Stream Transforms

## Component Description

Integrates LLM API providers, message stream adapters, format transformers, and request retry policies.

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

### /Users/highlands/pools/Development/dirac/src/core/api/providers/bedrock.ts (lines 95-103)
```
	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: DiracTool[]): ApiStream {
		const abortController = new AbortController()
		this.abortController = abortController
		try {
			yield* this.createMessageWithSignal(systemPrompt, messages, tools, abortController.signal)
		} finally {
			if (this.abortController === abortController) this.abortController = undefined
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/core/api/openrouter/openrouter-endpoints.ts (lines 60-78)
```
export async function getOpenRouterEndpoints(
	modelId: string,
	options: { forceRefresh?: boolean } = {},
): Promise<OpenRouterEndpointsResult> {
	const canonicalModelId = normalizeLegacySynthetic1mModelId(modelId)
	const cached = endpointCache.get(canonicalModelId)
	if (cached && !options.forceRefresh) {
		return cached
	}

	const pending = pendingRequests.get(canonicalModelId)
	if (pending) return pending

	const request = fetchOpenRouterEndpoints(canonicalModelId, cached?.endpoints).finally(() => {
		pendingRequests.delete(canonicalModelId)
	})
	pendingRequests.set(canonicalModelId, request)
	return request
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/modelProviderSelection.ts (lines 45-86)
```
export function modelProviderSelectionUpdates(
	mode: Mode,
	selection: ModelProviderSelection,
	inferenceSpeed?: InferenceSpeed,
): Partial<ApiConfiguration> {
	const prefix = mode === "plan" ? "planMode" : "actMode"
	const updates: Record<string, unknown> = {
		[`${prefix}ApiProvider`]: selection.provider,
		[`${prefix}ApiModelId`]: selection.modelId,
	}
	if (
		(inferenceSpeed === "fast" && !modelSupportsInferenceSpeed(selection.provider, selection.modelId)) ||
		(inferenceSpeed === "standard" && !providerSupportsInferenceSpeed(selection.provider))
	) {
		updates[`${prefix}InferenceSpeed`] = "default"
	}

	const modelFieldSuffix = PROVIDER_MODEL_FIELD_SUFFIX[selection.provider]
	if (modelFieldSuffix) {
		updates[`${prefix}${modelFieldSuffix}ModelId`] = selection.modelId
	}

	const modelInfoFieldSuffix = PROVIDER_MODEL_INFO_FIELD_SUFFIX[selection.provider]
	if (modelInfoFieldSuffix) {
		updates[`${prefix}${modelInfoFieldSuffix}ModelInfo`] = selection.modelInfo
	}

	if (selection.provider === "vscode-lm") {
		updates[`${prefix}VsCodeLmModelSelector`] = selection.vsCodeLmModelSelector
	}

	if (selection.provider === "bedrock") {
		updates[`${prefix}AwsBedrockCustomSelected`] = selection.awsBedrockCustomSelected
		updates[`${prefix}AwsBedrockCustomModelBaseId`] = selection.awsBedrockCustomModelBaseId
	}

	if (selection.provider === "openai") {
		updates[`${prefix}OpenAiProfileName`] = selection.openAiProfileName
	}

	return updates as Partial<ApiConfiguration>
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

