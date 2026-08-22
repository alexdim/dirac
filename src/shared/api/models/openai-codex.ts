import type { ModelInfo } from "./types"
import { MODEL_CAPABILITIES } from "./capabilities"
import { ApiFormat } from "../../proto/dirac/models"

/**
 * ChatGPT/Codex OAuth-only Responses API capabilities.
 *
 * Models must explicitly opt in after their Codex Responses WebSocket protocol
 * has been verified. Unknown models remain disabled so the OAuth backend never
 * receives unsupported persistence or chaining fields.
 */
export interface OpenAiCodexModelInfo extends ModelInfo {
	supportsPersistedReasoning?: boolean
}

export type OpenAiCodexModelId = keyof typeof openAiCodexModels

export const openAiCodexDefaultModelId: OpenAiCodexModelId = "gpt-5.6-terra"

export const openAiCodexModels = {
	"gpt-5.5": {
		...MODEL_CAPABILITIES["gpt-5.5"],
		contextWindow: 1_050_000,
		supportsPromptCache: true,
		supportsFastMode: true,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-5.5 Codex snapshot (2026-04-23), Dec 01, 2025 knowledge cutoff, with reasoning token support",
	},
	"gpt-5.4": {
		...MODEL_CAPABILITIES["gpt-5.4"],
		supportsPromptCache: true,
		supportsFastMode: true,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-5.4 Codex: OpenAI's latest flagship coding model via ChatGPT subscription",
	},
	"gpt-5.4-mini": {
		...MODEL_CAPABILITIES["gpt-5.4-mini"],
		supportsPromptCache: true,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-5.4 mini Codex via ChatGPT subscription",
	},
	"gpt-5.4-nano": {
		...MODEL_CAPABILITIES["gpt-5.4-nano"],
		supportsPromptCache: true,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-5.4 nano Codex via ChatGPT subscription",
	},
	"gpt-5.4-pro": {
		...MODEL_CAPABILITIES["gpt-5.4-pro"],
		supportsPromptCache: true,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-5.4 Pro Codex via ChatGPT subscription",
	},
	"gpt-5.6-sol": {
		...MODEL_CAPABILITIES["gpt-5.6-sol"],
		supportsPromptCache: true,
		supportsFastMode: true,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		supportsPersistedReasoning: true,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-5.6 Sol Codex via ChatGPT subscription",
	},
	"gpt-5.6-terra": {
		...MODEL_CAPABILITIES["gpt-5.6-terra"],
		supportsPromptCache: true,
		supportsFastMode: true,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		supportsPersistedReasoning: true,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-5.6 Terra Codex via ChatGPT subscription",
	},
	"gpt-5.6-luna": {
		...MODEL_CAPABILITIES["gpt-5.6-luna"],
		supportsPromptCache: true,
		supportsFastMode: true,
		apiFormat: ApiFormat.OPENAI_RESPONSES,
		supportsPersistedReasoning: true,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT-5.6 Luna Codex via ChatGPT subscription",
	},
} as const satisfies Record<string, OpenAiCodexModelInfo>
