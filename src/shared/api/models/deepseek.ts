import { MODEL_CAPABILITIES } from "./capabilities"
import type { ModelPricing, OpenAiCompatibleModelInfo } from "./types"

const DEEPSEEK_V4_PEAK_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const

const withDeepSeekV4Pricing = (offPeak: ModelPricing, peak: ModelPricing) => ({
	...offPeak,
	pricingSchedule: {
		timeZone: "UTC" as const,
		defaultLabel: "Off-peak",
		periods: [
			{
				label: "Peak",
				weekdays: DEEPSEEK_V4_PEAK_WEEKDAYS,
				startMinuteUtc: 60,
				endMinuteUtc: 240,
				prices: peak,
			},
			{
				label: "Peak",
				weekdays: DEEPSEEK_V4_PEAK_WEEKDAYS,
				startMinuteUtc: 360,
				endMinuteUtc: 600,
				prices: peak,
			},
		],
	},
})
export type DeepSeekModelId = keyof typeof deepSeekModels

export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-v4-flash"

export const deepSeekModels = {
	"deepseek-v4-flash": {
		maxTokens: 384_000,
		contextWindow: 1_048_576,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoning: true,
		supportsReasoningEffort: true,
		supportsTools: true,
		...withDeepSeekV4Pricing(
			{ inputPrice: 0, outputPrice: 0.66, cacheWritesPrice: 0.22, cacheReadsPrice: 0.007 },
			{ inputPrice: 0, outputPrice: 1.32, cacheWritesPrice: 0.44, cacheReadsPrice: 0.014 },
		),
	},
	"deepseek-v4-flash-vision-exp": {
		...MODEL_CAPABILITIES["deepseek-v4-flash-vision-exp"],
		supportsPromptCache: true,
		...withDeepSeekV4Pricing(
			{ inputPrice: 0, outputPrice: 0.66, cacheWritesPrice: 0.22, cacheReadsPrice: 0.007 },
			{ inputPrice: 0, outputPrice: 1.32, cacheWritesPrice: 0.44, cacheReadsPrice: 0.014 },
		),
	},
	"deepseek-v4-pro": {
		maxTokens: 384_000,
		contextWindow: 1_048_576,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoning: true,
		supportsReasoningEffort: true,
		supportsTools: true,
		...withDeepSeekV4Pricing(
			{ inputPrice: 0, outputPrice: 1.98, cacheWritesPrice: 0.66, cacheReadsPrice: 0.022 },
			{ inputPrice: 0, outputPrice: 3.96, cacheWritesPrice: 1.32, cacheReadsPrice: 0.044 },
		),
	},
	"deepseek-chat": {
		maxTokens: 8_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true, // supports context caching, but not in the way anthropic does it (deepseek reports input tokens and reads/writes in the same usage report) FIXME: we need to show users cache stats how deepseek does it
		inputPrice: 0, // technically there is no input price, it's all either a cache hit or miss (ApiOptions will not show this). Input is the sum of cache reads and writes
		outputPrice: 1.1,
		cacheWritesPrice: 0.27,
		cacheReadsPrice: 0.07,
	},
	"deepseek-reasoner": {
		maxTokens: 8_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoning: true,
		supportsTools: true,
		inputPrice: 0,
		outputPrice: 2.19,
		cacheWritesPrice: 0.55,
		cacheReadsPrice: 0.14,
	},
} as const satisfies Record<string, OpenAiCompatibleModelInfo>
