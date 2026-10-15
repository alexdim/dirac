---
component_id: 1.7
component_name: Model Provider Presets & Core Utilities
---

# Model Provider Presets & Core Utilities

## Component Description

Manages model provider presets, SQLite concurrency locks, and webview security nonces.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/models/modelProviderPresets.ts (lines 168-194)
```
export async function activateModelProviderPreset(controller: Controller, presetIdToActivate: string): Promise<void> {
	const presets = controller.stateManager.getGlobalSettingsKey("modelProviderPresets")
	const preset = presets.find((candidate) => candidate.id === presetIdToActivate)
	if (!preset) throw new Error("Model/provider preset not found")

	const configuration = controller.stateManager.getApiConfiguration()
	const profile = preset.openAiProfileName
		? configuration.openAiCompatibleProfiles?.find((candidate) => candidate.name === preset.openAiProfileName)
		: undefined
	if (preset.provider === "openai" && preset.openAiProfileName && !profile) {
		throw new Error("Saved OpenAI-compatible configuration not found")
	}

	const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
	const updates = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
		? modeUpdates(configuration, currentMode, preset, profile)
		: {
				...modeUpdates(configuration, "plan", preset, profile),
				...modeUpdates(configuration, "act", preset, profile),
			}
	const candidateConfiguration = { ...configuration, ...updates }
	await applyApiConfigurationTransaction(controller, candidateConfiguration, () =>
		persistApiConfigurationPatch(controller.stateManager, updates),
	)
	upsertPreset(controller.stateManager, { ...preset, lastUsedAt: Date.now() })
	await controller.postStateToWebview()
}
```

### /Users/highlands/pools/Development/dirac/src/core/models/modelProviderPresets.ts (lines 70-111)
```
export function recordSuccessfulModelProviderPreset(
	stateManager: StateManager,
	provider: ApiProvider,
	modelId: string,
	modelInfo: ModelInfo,
	mode: Mode,
): void {
	if (!modelId) return
	const configuration = stateManager.getApiConfiguration()
	const openAiProfileName =
		provider === "openai" ? resolveOpenAiProfile(stateManager, configuration, mode, modelId, modelInfo) : undefined
	const vsCodeLmModelSelector =
		provider === "vscode-lm"
			? mode === "plan"
				? configuration.planModeVsCodeLmModelSelector
				: configuration.actModeVsCodeLmModelSelector
			: undefined
	const awsBedrockCustomSelected =
		provider === "bedrock"
			? mode === "plan"
				? configuration.planModeAwsBedrockCustomSelected
				: configuration.actModeAwsBedrockCustomSelected
			: undefined
	const awsBedrockCustomModelBaseId =
		provider === "bedrock"
			? mode === "plan"
				? configuration.planModeAwsBedrockCustomModelBaseId
				: configuration.actModeAwsBedrockCustomModelBaseId
			: undefined

	upsertPreset(stateManager, {
		id: presetId(provider, modelId, openAiProfileName),
		provider,
		modelId,
		modelInfo,
		openAiProfileName,
		vsCodeLmModelSelector,
		awsBedrockCustomSelected,
		awsBedrockCustomModelBaseId,
		lastUsedAt: Date.now(),
	})
}
```

### /Users/highlands/pools/Development/dirac/src/core/models/modelProviderPresets.ts (lines 113-147)
```
export function recordSavedOpenAiCompatibleProfileChanges(
	stateManager: StateManager,
	previousProfiles: OpenAiCompatibleProfile[],
): void {
	const configuration = stateManager.getApiConfiguration()
	const profiles = configuration.openAiCompatibleProfiles || []
	const profilesByName = new Map(profiles.map((profile) => [profile.name, profile]))
	const presets = stateManager.getGlobalSettingsKey("modelProviderPresets")
	const reconciledPresets = presets.filter((preset) => {
		if (preset.provider !== "openai" || !preset.openAiProfileName) return true
		return profilesByName.get(preset.openAiProfileName)?.modelId === preset.modelId
	})
	if (reconciledPresets.length !== presets.length) {
		stateManager.setGlobalState("modelProviderPresets", reconciledPresets)
	}

	const selectedNames = new Set(
		[configuration.planModeOpenAiProfileName, configuration.actModeOpenAiProfileName].filter(
			(name): name is string => !!name,
		),
	)
	for (const profile of profiles) {
		if (!profile.modelId || !selectedNames.has(profile.name)) continue
		const previousProfile = previousProfiles.find((candidate) => candidate.name === profile.name)
		if (previousProfile && JSON.stringify(previousProfile) === JSON.stringify(profile)) continue
		upsertPreset(stateManager, {
			id: presetId("openai", profile.modelId, profile.name),
			provider: "openai",
			modelId: profile.modelId,
			modelInfo: profile.modelInfo,
			openAiProfileName: profile.name,
			lastUsedAt: Date.now(),
		})
	}
}
```


## Source Files:

- `src/core/locks/SqliteLockManager.ts`
- `src/core/locks/types.ts`
- `src/core/models/modelProviderPresets.ts`
- `src/core/webview/getNonce.ts`

