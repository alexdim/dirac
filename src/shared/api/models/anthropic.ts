import type { ModelInfo } from "./types"
import { MODEL_CAPABILITIES } from "./capabilities"

export const ANTHROPIC_FAST_MODE_SUFFIX = ":fast"

export const ANTHROPIC_MIN_THINKING_BUDGET = 1_024
export const ANTHROPIC_MAX_THINKING_BUDGET = 6_000

export type AnthropicModelId = keyof typeof anthropicModels

export const anthropicDefaultModelId: AnthropicModelId = "claude-sonnet-5"

export const anthropicModels = {
	"claude-sonnet-4-6": {
		...MODEL_CAPABILITIES["claude-sonnet-4-6"],
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-sonnet-5": {
		...MODEL_CAPABILITIES["claude-sonnet-5"],
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	},
	"claude-haiku-4-5-20251001": {
		...MODEL_CAPABILITIES["claude-haiku-4-5-20251001"],
		supportsPromptCache: true,
		inputPrice: 1,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
	},
	"claude-opus-4-6": {
		...MODEL_CAPABILITIES["claude-opus-4-6"],
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
	},
	"claude-opus-4-6:fast": {
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: true,
		supportsAdaptiveThinking: true,
		inputPrice: 30.0,
		outputPrice: 150.0,
		cacheWritesPrice: 37.5,
		cacheReadsPrice: 3.0,
		description:
			"Anthropic fast mode preview for Claude Opus 4.6. Same model and capabilities with higher output token speed at premium pricing. Requires fast mode access on your Anthropic account.",
	},
	"claude-opus-4-7": {
		...MODEL_CAPABILITIES["claude-opus-4-7"],
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
	},
	"claude-opus-4-7:fast": {
		...MODEL_CAPABILITIES["claude-opus-4-7:fast"],
		supportsPromptCache: true,
		inputPrice: 30.0,
		outputPrice: 150.0,
		cacheWritesPrice: 37.5,
		cacheReadsPrice: 3.0,
		description:
			"Anthropic fast mode preview for Claude Opus 4.6. Same model and capabilities with higher output token speed at premium pricing. Requires fast mode access on your Anthropic account.",
	},
	"claude-opus-4-8": {
		...MODEL_CAPABILITIES["claude-opus-4-8"],
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
	},
	"claude-opus-4-8:fast": {
		...MODEL_CAPABILITIES["claude-opus-4-8:fast"],
		supportsPromptCache: true,
		inputPrice: 10.0,
		outputPrice: 50.0,
		cacheWritesPrice: 12.5,
		cacheReadsPrice: 1.0,
		description:
			"Anthropic fast mode preview for Claude Opus 4.8. Same model and capabilities with higher output token speed at premium pricing. Requires fast mode access on your Anthropic account.",
	},
	"claude-opus-5": {
		...MODEL_CAPABILITIES["claude-opus-5"],
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
	},
	"claude-opus-5:fast": {
		...MODEL_CAPABILITIES["claude-opus-5:fast"],
		supportsPromptCache: true,
		inputPrice: 10.0,
		outputPrice: 50.0,
		cacheWritesPrice: 12.5,
		cacheReadsPrice: 1.0,
		description:
			"Anthropic fast mode preview for Claude Opus 5. Same model and capabilities with higher output token speed at premium pricing. Requires fast mode access on your Anthropic account.",
	},
	"claude-fable-5": {
		...MODEL_CAPABILITIES["claude-fable-5"],
		supportsPromptCache: true,
		inputPrice: 10.0,
		outputPrice: 50.0,
		cacheWritesPrice: 12.5,
		cacheReadsPrice: 1.0,
	},
} as const satisfies Record<string, ModelInfo>

/**
 * Helper to determine if an Anthropic model supports adaptive thinking.
 * Default opt-in pattern: If it's a known "old" model (<= 4.5), use enabled.
 * Otherwise (>= 4.6 or unknown future model), use adaptive.
 */
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
