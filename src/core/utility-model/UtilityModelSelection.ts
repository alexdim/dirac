import { ALL_PROVIDERS, type ApiProvider, type ModelProviderSelection } from "@shared/api"

/** Returns a valid, secret-free Utility model selection from persisted settings. */
export function getConfiguredUtilityModelSelection(selection: unknown): ModelProviderSelection | undefined {
	if (!selection || typeof selection !== "object") return undefined

	const { provider, modelId } = selection as Partial<ModelProviderSelection>
	if (typeof provider !== "string" || !ALL_PROVIDERS.includes(provider as ApiProvider)) return undefined
	if (typeof modelId !== "string" || modelId.trim().length === 0) return undefined

	return selection as ModelProviderSelection
}
