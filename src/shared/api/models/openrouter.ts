import type { ModelInfo } from "./types"

export const openRouterDefaultModelId = "anthropic/claude-sonnet-4.5" // will always exist in openRouterModels
export const openRouterDefaultModelInfo: ModelInfo = {
	supportsPromptCache: false,
	description: "Model details will load from OpenRouter when the catalog is available.",
}
