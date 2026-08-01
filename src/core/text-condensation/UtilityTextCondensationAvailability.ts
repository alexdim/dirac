import { ALL_PROVIDERS, type ApiProvider, type ModelProviderSelection } from "@shared/api"
import type { TextCondensationTemplateId } from "./TextCondenser"
import type { TextCondensationTemplateRegistry } from "./TextCondensationTemplateRegistry"

export interface UtilityTextCondensationSettings {
	utilityModelEnabled: unknown
	utilityModelSelection: unknown
}

export function getConfiguredUtilityModelSelection(selection: unknown): ModelProviderSelection | undefined {
	if (!selection || typeof selection !== "object") return undefined

	const { provider, modelId } = selection as Partial<ModelProviderSelection>
	if (typeof provider !== "string" || !ALL_PROVIDERS.includes(provider as ApiProvider)) return undefined
	if (typeof modelId !== "string" || modelId.trim().length === 0) return undefined

	return selection as ModelProviderSelection
}

export function isUtilityTextCondensationAvailable(
	settings: UtilityTextCondensationSettings,
	template: TextCondensationTemplateId,
	templates: TextCondensationTemplateRegistry,
): boolean {
	return (
		settings.utilityModelEnabled === true &&
		getConfiguredUtilityModelSelection(settings.utilityModelSelection) !== undefined &&
		templates.has(template)
	)
}
