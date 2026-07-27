import type { ModelProviderPreset } from "@shared/api"
import type { GlobalStateAndSettings, SettingsKey } from "./state-keys"

const LEGACY_MODEL_ID_SETTINGS = [
	"planModeApiModelId",
	"actModeApiModelId",
	"planModeAwsBedrockCustomModelBaseId",
	"actModeAwsBedrockCustomModelBaseId",
	"planModeOpenRouterModelId",
	"actModeOpenRouterModelId",
	"planModeVercelAiGatewayModelId",
	"actModeVercelAiGatewayModelId",
] as const satisfies readonly SettingsKey[]

/**
 * Removes Dirac's retired `:1m` model-id segment while preserving real suffixes
 * such as Anthropic fast mode and OpenRouter presets.
 */
export function normalizeLegacySynthetic1mModelId(modelId: string): string {
	const presetMarker = "@preset/"
	const presetIndex = modelId.indexOf(presetMarker)
	const modelPart = presetIndex === -1 ? modelId : modelId.slice(0, presetIndex)
	const presetPart = presetIndex === -1 ? "" : modelId.slice(presetIndex)
	const normalizedModelPart = modelPart.replace(/:1m(?=:fast$|$)/, "")
	return `${normalizedModelPart}${presetPart}`
}

export function normalizeLegacyOpenRouterPinMap(
	pins: Record<string, string[]> | undefined,
): Record<string, string[]> | undefined {
	if (!pins) return undefined

	const normalized: Record<string, string[]> = {}
	const keys = Object.keys(pins)
	const canonicalKeys = keys.filter((key) => normalizeLegacySynthetic1mModelId(key) === key).sort()
	const legacyKeys = keys.filter((key) => normalizeLegacySynthetic1mModelId(key) !== key).sort()

	for (const key of [...canonicalKeys, ...legacyKeys]) {
		const normalizedKey = normalizeLegacySynthetic1mModelId(key)
		const mergedTags = [...(normalized[normalizedKey] || []), ...(pins[key] || [])]
		normalized[normalizedKey] = [...new Set(mergedTags)]
	}

	return normalized
}

export function removeLegacySynthetic1mModelEntries<T>(models: Record<string, T>): Record<string, T> {
	return Object.fromEntries(
		Object.entries(models).filter(([modelId]) => normalizeLegacySynthetic1mModelId(modelId) === modelId),
	)
}

export function buildLegacySynthetic1mStateUpdates(
	state: Partial<GlobalStateAndSettings>,
): Partial<GlobalStateAndSettings> {
	const updates: Partial<GlobalStateAndSettings> = {}

	for (const key of LEGACY_MODEL_ID_SETTINGS) {
		const value = state[key]
		if (!value) continue
		const normalized = normalizeLegacySynthetic1mModelId(value)
		if (normalized !== value) updates[key] = normalized as never
	}

	const pins = state.openRouterPinnedProviders
	const normalizedPins = normalizeLegacyOpenRouterPinMap(pins)
	if (pins && JSON.stringify(normalizedPins) !== JSON.stringify(pins)) {
		updates.openRouterPinnedProviders = normalizedPins
	}

	const presets = state.modelProviderPresets
	if (presets) {
		const normalizedPresets = normalizeLegacyModelProviderPresets(presets)
		if (JSON.stringify(normalizedPresets) !== JSON.stringify(presets)) {
			updates.modelProviderPresets = normalizedPresets
		}
	}

	return updates
}

export function normalizeLegacyModelProviderPresets(presets: ModelProviderPreset[]): ModelProviderPreset[] {
	const normalizedPresets: ModelProviderPreset[] = []
	const presetIndexesById = new Map<string, number>()
	for (const preset of presets.map(normalizeLegacyModelProviderPreset)) {
		const existingIndex = presetIndexesById.get(preset.id)
		if (existingIndex === undefined) {
			presetIndexesById.set(preset.id, normalizedPresets.length)
			normalizedPresets.push(preset)
			continue
		}
		if (preset.lastUsedAt > normalizedPresets[existingIndex].lastUsedAt) {
			normalizedPresets[existingIndex] = preset
		}
	}
	return normalizedPresets
}

function normalizeLegacyModelProviderPreset(preset: ModelProviderPreset): ModelProviderPreset {
	const modelId = normalizeLegacySynthetic1mModelId(preset.modelId)
	const awsBedrockCustomModelBaseId = preset.awsBedrockCustomModelBaseId
		? normalizeLegacySynthetic1mModelId(preset.awsBedrockCustomModelBaseId)
		: undefined

	if (modelId === preset.modelId && awsBedrockCustomModelBaseId === preset.awsBedrockCustomModelBaseId) {
		return preset
	}

	return {
		...preset,
		id: [preset.provider, preset.openAiProfileName || "", modelId].map(encodeURIComponent).join(":"),
		modelId,
		modelInfo: modelId === preset.modelId ? preset.modelInfo : undefined,
		awsBedrockCustomModelBaseId,
	}
}
