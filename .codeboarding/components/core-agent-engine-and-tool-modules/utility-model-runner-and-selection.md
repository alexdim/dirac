---
component_id: 1.8
component_name: Utility Model Runner & Selection
---

# Utility Model Runner & Selection

## Component Description

Selects and executes secondary utility model requests for auxiliary tasks such as conversation compaction and permission evaluation.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/utility-model/UtilityModelRunner.ts (lines 61-147)
```
export class UtilityModelRunner {
	constructor(
		private readonly selection: ModelProviderSelection,
		private readonly createHandler: UtilityModelHandlerFactory,
		private readonly options: UtilityModelRunnerOptions = {},
	) { }

	run(request: UtilityModelRequest): ApiStream {
		return this.stream(request)
	}

	private async *stream(request: UtilityModelRequest): ApiStream {
		for (let retryAttempt = 0; ; retryAttempt++) {
			this.throwIfCancelled(request.signal)
			// Configuration failures are not provider failures and cannot be repaired by retrying.
			const handler = this.createHandler()
			const modelId = handler.getModel().id
			let chunks: ApiStreamChunk[]
			try {
				chunks = await this.collectAttempt(handler, request)
			} catch (error) {
				this.throwIfCancelled(request.signal)
				if (error instanceof UtilityModelCancelledError || error instanceof ApiConfigurationError) throw error
				const diracError = DiracError.transform(error, modelId, this.selection.provider)
				if (
					retryAttempt === MAX_API_REQUEST_RETRIES ||
					diracError.isErrorType(DiracErrorType.Auth) ||
					diracError.isErrorType(DiracErrorType.Payment)
				) throw error

				const delayMs = getApiRequestRetryDelay(retryAttempt + 1)
				await this.options.onRetry?.({ retryAttempt: retryAttempt + 1, maxRetries: MAX_API_REQUEST_RETRIES, delayMs, error })
				await this.waitForRetry(delayMs, request.signal)
				continue
			}

			this.throwIfCancelled(request.signal)
			this.options.onModelResolved?.({ selection: this.selection, modelId: handler.getModel().id })
			for (const chunk of chunks) {
				this.throwIfCancelled(request.signal)
				yield chunk
			}
			return
		}
	}

	private async collectAttempt(handler: ApiHandler, request: UtilityModelRequest): Promise<ApiStreamChunk[]> {
		let completed = false
		let aborted = false
		const abortHandler = () => {
			if (aborted) return
			aborted = true
			handler.abort?.()
		}
		request.signal?.addEventListener("abort", abortHandler, { once: true })

		try {
			this.throwIfCancelled(request.signal)
			const chunks: ApiStreamChunk[] = []
			for await (const chunk of handler.createMessage(request.systemPrompt, request.messages, request.tools)) {
				this.throwIfCancelled(request.signal)
				if (chunk.type === "usage") this.options.onUsage?.({ selection: this.selection, usage: chunk })
				chunks.push(chunk)
			}
			this.throwIfCancelled(request.signal)
			completed = true
			return chunks
		} finally {
			request.signal?.removeEventListener("abort", abortHandler)
			if (!completed) abortHandler()
		}
	}

	private async waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
		this.throwIfCancelled(signal)
		try {
			await setTimeoutPromise(delayMs, undefined, { signal })
		} catch (error) {
			this.throwIfCancelled(signal)
			throw error
		}
	}

	private throwIfCancelled(signal?: AbortSignal): void {
		if (signal?.aborted) throw new UtilityModelCancelledError()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/utility-model/UtilityModelRunner.ts (lines 107-132)
```
	private async collectAttempt(handler: ApiHandler, request: UtilityModelRequest): Promise<ApiStreamChunk[]> {
		let completed = false
		let aborted = false
		const abortHandler = () => {
			if (aborted) return
			aborted = true
			handler.abort?.()
		}
		request.signal?.addEventListener("abort", abortHandler, { once: true })

		try {
			this.throwIfCancelled(request.signal)
			const chunks: ApiStreamChunk[] = []
			for await (const chunk of handler.createMessage(request.systemPrompt, request.messages, request.tools)) {
				this.throwIfCancelled(request.signal)
				if (chunk.type === "usage") this.options.onUsage?.({ selection: this.selection, usage: chunk })
				chunks.push(chunk)
			}
			this.throwIfCancelled(request.signal)
			completed = true
			return chunks
		} finally {
			request.signal?.removeEventListener("abort", abortHandler)
			if (!completed) abortHandler()
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/core/utility-model/UtilityModelRunner.ts (lines 48-53)
```
export class UtilityModelCancelledError extends Error {
	constructor() {
		super("Utility model request cancelled")
		this.name = "UtilityModelCancelledError"
	}
}
```


## Source Files:

- `src/core/utility-model/UtilityModelRunner.ts`
- `src/core/utility-model/UtilityModelSelection.ts`

