---
component_id: 3.3.2
component_name: Core Model Schemas & OpenAI Model Definitions
---

# Core Model Schemas & OpenAI Model Definitions

## Component Description

Defines core model capability and pricing interfaces, pricing inspection helpers, and model catalogs for OpenAI Native and OpenAI Codex providers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/api/models/types.ts (lines 37-58)
```
export interface ModelCapabilities {
	name?: string
	canonicalSlug?: string
	maxTokens?: number
	contextWindow?: number
	supportsImages?: boolean
	supportsReasoning?: boolean
	supportsReasoningEffort?: boolean
	reasoningEffortOptions?: OpenaiReasoningEffort[]
	defaultReasoningEffort?: OpenaiReasoningEffort
	supportsAdaptiveThinking?: boolean
	thinkingAlwaysOn?: boolean
	supportsForcedToolUse?: boolean
	supportsTools?: boolean
	supportsStrictTools?: boolean
	description?: string
	thinkingConfig?: {
		maxBudget?: number
		geminiThinkingLevel?: "low" | "medium" | "high"
		supportsThinkingLevel?: boolean
	}
}
```

### /Users/highlands/pools/Development/dirac/src/shared/api/models/types.ts (lines 60-82)
```
export interface ModelInfo extends ModelCapabilities, ModelPricing {
	supportsPromptCache: boolean
	supportsFastMode?: boolean
	fastModePriceMultiplier?: number
	pricingSchedule?: ModelPricingSchedule
	supportsGlobalEndpoint?: boolean
	tiers?: {
		contextWindow: number
		inputPrice?: number
		outputPrice?: number
		cacheWritesPrice?: number
		cacheReadsPrice?: number
	}[]
	temperature?: number
	apiFormat?: ApiFormat
	thinkingConfig?: {
		maxBudget?: number
		outputPrice?: number
		outputPriceTiers?: PriceTier[]
		geminiThinkingLevel?: "low" | "medium" | "high"
		supportsThinkingLevel?: boolean
	}
}
```

### /Users/highlands/pools/Development/dirac/src/shared/api/models/types.ts (lines 110-120)
```
export function createModelProviderSelection(preset: ModelProviderPreset): ModelProviderSelection {
	return {
		provider: preset.provider,
		modelId: preset.modelId,
		modelInfo: preset.modelInfo,
		openAiProfileName: preset.openAiProfileName,
		vsCodeLmModelSelector: preset.vsCodeLmModelSelector,
		awsBedrockCustomSelected: preset.awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId: preset.awsBedrockCustomModelBaseId,
	}
}
```

### /Users/highlands/pools/Development/dirac/src/shared/api/models/types.ts (lines 162-176)
```
export function hasPricing(modelInfo: ModelInfo): boolean {
	const prices = [
		modelInfo.inputPrice,
		modelInfo.outputPrice,
		modelInfo.cacheWritesPrice,
		modelInfo.cacheReadsPrice,
		...(modelInfo.pricingSchedule?.periods.flatMap((period) => [
			period.prices.inputPrice,
			period.prices.outputPrice,
			period.prices.cacheWritesPrice,
			period.prices.cacheReadsPrice,
		]) ?? []),
	]
	return prices.some((price) => price !== undefined)
}
```

### /Users/highlands/pools/Development/dirac/src/shared/api/models/types.ts (lines 179-202)
```
export function isFreeModel(modelInfo: ModelInfo): boolean {
	if (modelInfo.inputPrice !== 0 || modelInfo.outputPrice !== 0) return false

	const overridePrices = [
		modelInfo.cacheWritesPrice,
		modelInfo.cacheReadsPrice,
		modelInfo.thinkingConfig?.outputPrice,
		...(modelInfo.pricingSchedule?.periods.flatMap((period) => [
			period.prices.inputPrice,
			period.prices.outputPrice,
			period.prices.cacheWritesPrice,
			period.prices.cacheReadsPrice,
		]) ?? []),
		...(modelInfo.tiers?.flatMap((tier) => [
			tier.inputPrice,
			tier.outputPrice,
			tier.cacheWritesPrice,
			tier.cacheReadsPrice,
		]) ?? []),
		...(modelInfo.thinkingConfig?.outputPriceTiers?.map((tier) => tier.price) ?? []),
	]

	return overridePrices.every((price) => price === undefined || price === 0)
}
```


## Source Files:

- `src/shared/api/models/openai-codex.ts`
- `src/shared/api/models/openai-native.ts`
- `src/shared/api/models/types.ts`

