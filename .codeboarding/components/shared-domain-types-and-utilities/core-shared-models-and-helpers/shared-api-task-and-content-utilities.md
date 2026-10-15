---
component_id: 3.1.1
component_name: Shared API, Task & Content Utilities
---

# Shared API, Task & Content Utilities

## Component Description

Provides shared API configuration types, chat content and card sequence helpers, task status projections, API metrics aggregation, and common runtime utilities.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/getApiMetrics.ts (lines 35-94)
```
export function getApiMetrics(messages: DiracMessage[]): ApiMetrics {
	const result: ApiMetrics = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
		totalReasoningTokens: 0,
		cacheHitRate: 0,
	}

	messages.forEach((message) => {
		if (message.content.type === "api_status") {
			const { tokensIn, tokensOut, cacheWrites, cacheReads, cost, reasoningTokens } = message.content.status

			if (typeof tokensIn === "number") {
				result.totalTokensIn += tokensIn
			}
			if (typeof tokensOut === "number") {
				result.totalTokensOut += tokensOut
			}
			if (typeof cacheWrites === "number") {
				result.totalCacheWrites = (result.totalCacheWrites ?? 0) + cacheWrites
			}
			if (typeof cacheReads === "number") {
				result.totalCacheReads = (result.totalCacheReads ?? 0) + cacheReads
			}
			if (typeof cost === "number") {
				result.totalCost += cost
			}
			if (typeof reasoningTokens === "number") {
				result.totalReasoningTokens += reasoningTokens
			}
			// Include deletedMetrics from checkpoint restore for accurate total tracking
			const deletedMetrics = message.content.status.deletedMetrics
			if (deletedMetrics) {
				if (typeof deletedMetrics.tokensIn === "number") result.totalTokensIn += deletedMetrics.tokensIn
				if (typeof deletedMetrics.tokensOut === "number") result.totalTokensOut += deletedMetrics.tokensOut
				if (typeof deletedMetrics.cacheWrites === "number")
					result.totalCacheWrites = (result.totalCacheWrites ?? 0) + deletedMetrics.cacheWrites
				if (typeof deletedMetrics.cacheReads === "number")
					result.totalCacheReads = (result.totalCacheReads ?? 0) + deletedMetrics.cacheReads
			}
		} else if (message.content.type === "card") {
			const usage = getSubagentUsage(message.content.card)
			if (!usage) return
			result.totalTokensIn += usage.tokensIn
			result.totalTokensOut += usage.tokensOut
			result.totalCacheWrites = (result.totalCacheWrites ?? 0) + usage.cacheWrites
			result.totalCacheReads = (result.totalCacheReads ?? 0) + usage.cacheReads
			result.totalCost += usage.cost
		}
	})

	// Compute weighted-average cache hit rate from aggregated totals
	const totalPromptTokens = result.totalTokensIn + (result.totalCacheWrites ?? 0) + (result.totalCacheReads ?? 0)
	result.cacheHitRate = totalPromptTokens > 0 ? (result.totalCacheReads ?? 0) / totalPromptTokens : 0

	return result
}
```


## Source Files:

- `src/shared/AutoApprovalSettings.ts`
- `src/shared/ChatContent.ts`
- `src/shared/Languages.ts`
- `src/shared/Patch.ts`
- `src/shared/anchor-limits.ts`
- `src/shared/api.ts`
- `src/shared/array.ts`
- `src/shared/cardIdentity.ts`
- `src/shared/combineCardSequences.ts`
- `src/shared/config-types.ts`
- `src/shared/content-limits.ts`
- `src/shared/context-management.ts`
- `src/shared/errors.ts`
- `src/shared/getApiMetrics.ts`
- `src/shared/goal.ts`
- `src/shared/net.ts`
- `src/shared/release-notes.ts`
- `src/shared/responseTool.ts`
- `src/shared/safe-json-parse.ts`
- `src/shared/skills.ts`
- `src/shared/slashCommands.ts`
- `src/shared/sqlJsModule.ts`
- `src/shared/string.ts`
- `src/shared/taskStatusProjection.ts`
- `src/shared/text-file-window.ts`
- `src/shared/vsCodeSelectorUtils.ts`

