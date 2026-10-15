---
component_id: 2.4.3
component_name: Unbiased API Provider & Model Catalog
---

# Unbiased API Provider & Model Catalog

## Component Description

Implements the Unbiased API provider handler and fetches and caches available Unbiased models.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/api/providers/unbiased.ts (lines 21-108)
```
export class UnbiasedHandler implements ApiHandler {
	private client: OpenAI | undefined
	private abortController: AbortController | undefined
	private readonly isSubscription: boolean

	constructor(private readonly options: UnbiasedHandlerOptions) {
		// Bind pricing to this handler's key so later default-account changes cannot alter an in-flight request.
		this.isSubscription =
			StateManager.isInitialized() &&
			isUnbiasedOAuthApiKey(options.unbiasedApiKey, StateManager.get().getGlobalStateKey("unbiasedOAuthApiKeyHash"))
	}

	private ensureClient(): OpenAI {
		if (!this.options.unbiasedApiKey) throw new Error("Unbiased API key is required. Sign in or enter a key in settings.")
		this.client ??= createOpenAIClient({
			baseURL: "https://api.unbiased.ai/v1",
			apiKey: this.options.unbiasedApiKey,
		})
		return this.client
	}

	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const abortController = new AbortController()
		this.abortController = abortController
		try {
			yield* this.createMessageWithRetry(systemPrompt, messages, tools, abortController.signal)
		} finally {
			if (this.abortController === abortController) this.abortController = undefined
		}
	}

	@withRetry()
	private async *createMessageWithRetry(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools: OpenAITool[] | undefined,
		signal: AbortSignal,
	): ApiStream {
		signal.throwIfAborted()
		const model = this.getModel()
		const stream = await this.ensureClient().chat.completions.create(
			{
				model: model.id,
				max_tokens: model.info.maxTokens,
				messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages, undefined, true)],
				stream: true,
				stream_options: { include_usage: true },
				...getOpenAIToolParams(tools),
			},
			{ signal },
		)
		const toolCallProcessor = new ToolCallProcessor()
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) yield { type: "text", text: delta.content }
			if (delta?.tool_calls) yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			if (chunk.usage) {
				const usage = formatOpenAiCompatibleUsage(chunk.usage, model.info)
				// A provider-reported API value is not an incremental charge on the monthly plan.
				if (this.isSubscription) usage.totalCost = 0
				yield usage
			}
		}
	}

	abort(): void {
		this.abortController?.abort()
	}

	getModel(): { id: string; info: ModelInfo } {
		const models = getCachedUnbiasedModels(
			this.options.unbiasedApiKey,
			StateManager.isInitialized() ? StateManager.get() : undefined,
		)
		const configuredId = this.options.apiModelId
		// Ignore an unrelated provider's shared mode ID, but retain Pareto versions across cache expiry/restarts.
		const id =
			configuredId && (models?.[configuredId] || configuredId === "pareto" || configuredId.startsWith("pareto-"))
				? configuredId
				: unbiasedDefaultModelId
		const modelInfo: ModelInfo =
			models?.[id] || (id === unbiasedDefaultModelId ? unbiasedModels.pareto : { supportsPromptCache: false })
		const info = this.isSubscription
			? { ...modelInfo, inputPrice: 0, outputPrice: 0, cacheReadsPrice: 0, cacheWritesPrice: 0 }
			: modelInfo
		return { id, info }
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/unbiased/unbiased-models.ts (lines 50-66)
```
export function fetchUnbiasedModels(
	apiKey: string | undefined,
	options: UnbiasedModelDiscoveryOptions,
): Promise<Record<string, ModelInfo>> {
	// Do not cache an unauthenticated fallback: signing in must trigger discovery.
	if (!apiKey) return Promise.resolve(unbiasedModels)
	const cached = getCachedUnbiasedModels(apiKey, options.cache)
	if (cached) return Promise.resolve(cached)

	const cacheKey = modelsCacheKey(apiKey)
	const pending = pendingRequests.get(cacheKey)
	if (pending) return pending

	const request = fetchAndCacheUnbiasedModels(apiKey, cacheKey, options).finally(() => pendingRequests.delete(cacheKey))
	pendingRequests.set(cacheKey, request)
	return request
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/unbiased/unbiased-models.ts (lines 68-94)
```
async function fetchAndCacheUnbiasedModels(
	apiKey: string,
	cacheKey: string,
	options: UnbiasedModelDiscoveryOptions,
): Promise<Record<string, ModelInfo>> {
	const cacheFilePath = await options.cacheFilePath()
	let models: Record<string, ModelInfo>
	try {
		const response = await axios.get<{ data: UnbiasedRawModel[] }>("https://api.unbiased.ai/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			timeout: 10_000,
			...options.axiosSettings,
		})
		if (!Array.isArray(response.data?.data) || !response.data.data.length) {
			throw new Error("Unbiased returned no models")
		}
		models = parseUnbiasedModels(response.data.data)
		await fs.writeFile(cacheFilePath, JSON.stringify(models))
	} catch (error) {
		// Never log an Axios error object: it contains the Authorization header.
		const status = axios.isAxiosError(error) ? error.response?.status : undefined
		Logger.warn(`Unbiased model discovery failed${status ? ` (HTTP ${status})` : ""}; using cached or default metadata.`)
		models = (await options.fileExists(cacheFilePath)) ? JSON.parse(await fs.readFile(cacheFilePath, "utf8")) : unbiasedModels
	}
	options.cache.setModelsCache(cacheKey, models)
	return models
}
```


## Source Files:

- `src/core/api/index.ts`
- `src/core/api/providers/unbiased.ts`
- `src/core/api/unbiased/unbiased-models.ts`

