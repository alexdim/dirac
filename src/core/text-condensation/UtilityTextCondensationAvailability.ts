import { getConfiguredUtilityModelSelection } from "@core/utility-model/UtilityModelSelection"
import type { TextCondensationTemplateId } from "./TextCondenser"
import type { TextCondensationTemplateRegistry } from "./TextCondensationTemplateRegistry"

export interface UtilityTextCondensationSettings {
	utilityModelEnabled: unknown
	utilityModelSelection: unknown
}

export { getConfiguredUtilityModelSelection } from "@core/utility-model/UtilityModelSelection"

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
