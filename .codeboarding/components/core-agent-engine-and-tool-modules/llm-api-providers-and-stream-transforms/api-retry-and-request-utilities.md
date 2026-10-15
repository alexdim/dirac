---
component_id: 1.3.3
component_name: API Retry & Request Utilities
---

# API Retry & Request Utilities

## Component Description

Provides API request retry policies, configuration error handling, and endpoint capability utilities for provider handlers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/api/retry.ts (lines 31-99)
```
export function withRetry(options: RetryOptions = {}) {
	const { maxRetries, baseDelay, maxDelay, retryAllErrors } = { ...DEFAULT_OPTIONS, ...options }

	return (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => {
		const originalMethod = descriptor.value

		descriptor.value = async function* (...args: any[]) {
			for (let attempt = 0; attempt < maxRetries; attempt++) {
				let didYield = false
				try {
					for await (const chunk of originalMethod.apply(this, args)) {
						didYield = true
						yield chunk
					}
					return
				} catch (error: any) {
					const handlerInstance = this as {
						options?: {
							disableRetries?: boolean
							onRetryAttempt?: (attempt: number, maxRetries: number, delay: number, error: any) => void
						}
					}
					const isRateLimit = isRateLimited(error?.status) || error instanceof RetriableError
					const isLastAttempt = attempt === maxRetries - 1

					if (didYield || handlerInstance.options?.disableRetries || (!isRateLimit && !retryAllErrors) || isLastAttempt) {
						throw error
					}

					// Get retry delay from header or calculate exponential backoff
					// Check various rate limit headers
					const retryAfter =
						error.headers?.["retry-after"] ||
						error.headers?.["x-ratelimit-reset"] ||
						error.headers?.["ratelimit-reset"] ||
						error.retryAfter

					let delay: number
					if (retryAfter) {
						// Handle both delta-seconds and Unix timestamp formats
						const retryValue = Number.parseInt(retryAfter, 10)
						if (retryValue > Date.now() / 1000) {
							// Unix timestamp
							delay = retryValue * 1000 - Date.now()
						} else {
							// Delta seconds
							delay = retryValue * 1000
						}
					} else {
						// Use exponential backoff if no header
						delay = Math.min(maxDelay, baseDelay * 2 ** attempt)
					}

					if (handlerInstance.options?.onRetryAttempt) {
						try {
							await handlerInstance.options.onRetryAttempt(attempt + 1, maxRetries, delay, error)
						} catch (e) {
							Logger.error("Error in onRetryAttempt callback:", e)
						}
					}

					await sleep(delay)
				}
			}
		}

		return descriptor
	}
}
```


## Source Files:

- `src/core/api/ApiConfigurationError.ts`
- `src/core/api/ApiRequestRetryPolicy.ts`
- `src/core/api/openrouter/openrouter-endpoints.ts`
- `src/core/api/retry.ts`
- `src/core/api/utils/messages_api_support.ts`
- `src/core/api/utils/responses_api_support.ts`

