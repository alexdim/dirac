---
component_id: 3.3.1
component_name: Anthropic, Vertex & Partner Model Definitions
---

# Anthropic, Vertex & Partner Model Definitions

## Component Description

Defines model catalogs, pricing configurations, defaults, and reasoning capability helpers for Anthropic, Vertex AI, DeepSeek, Qwen Mainland, and LiteLLM providers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/api/models/anthropic.ts (lines 97-103)
```
export function getAnthropicReasoningEffort(modelInfo: ModelInfo, requestedEffort?: string): string {
	if (!modelInfo.thinkingAlwaysOn) return requestedEffort || modelInfo.defaultReasoningEffort || "high"
	if (isOpenaiReasoningEffort(requestedEffort) && modelInfo.reasoningEffortOptions?.includes(requestedEffort)) {
		return requestedEffort
	}
	return modelInfo.defaultReasoningEffort || "medium"
}
```

### /Users/highlands/pools/Development/dirac/src/shared/api/models/anthropic.ts (lines 111-142)
```
export function isAnthropicAdaptiveThinkingSupported(modelId: string, info?: ModelInfo): boolean {
	if (info?.supportsAdaptiveThinking !== undefined) {
		return info.supportsAdaptiveThinking
	}

	const id = modelId.toLowerCase()
	const isAnthropic = id.startsWith("claude-") || id.includes("anthropic.claude-") || id.startsWith("anthropic/")

	if (!isAnthropic) {
		return false
	}

	// Default opt-in pattern:
	// If it's a known "old" model (<= 4.5), use enabled.
	// Otherwise (>= 4.6 or unknown future model), use adaptive.

	const versionMatch = id.match(/claude-(\d+)[.-](\d+)/)
	if (versionMatch) {
		const major = parseInt(versionMatch[1])
		const minor = parseInt(versionMatch[2])
		if (major < 4 || (major === 4 && minor <= 5)) {
			return false // Old model
		}
	}

	// Also check for specific old models that might not match the regex perfectly
	if (id.includes("claude-3")) {
		return false
	}

	return true // Default to adaptive for everything else
}
```

### /Users/highlands/pools/Development/dirac/src/shared/api/models/vertex.ts (lines 279-281)
```
export const vertexGlobalModels: Record<string, ModelInfo> = Object.fromEntries(
	Object.entries(vertexModels).filter(([_k, v]) => Object.hasOwn(v, "supportsGlobalEndpoint")),
) as Record<string, ModelInfo>
```


## Source Files:

- `src/shared/api/models/anthropic.ts`
- `src/shared/api/models/litellm.ts`
- `src/shared/api/models/qwen-mainland.ts`
- `src/shared/api/models/vertex.ts`

