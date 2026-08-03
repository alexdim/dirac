import { createModelProviderSelection, type ModelProviderPreset, type ModelProviderSelection } from "@shared/api"
import { convertModelProviderSelectionToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { updateSetting } from "./utils/settingsHandlers"

function selectionsMatch(selection: ModelProviderSelection, preset: ModelProviderPreset): boolean {
	const presetSelection = createModelProviderSelection(preset)
	return (
		selection.provider === presetSelection.provider &&
		selection.modelId === presetSelection.modelId &&
		selection.openAiProfileName === presetSelection.openAiProfileName &&
		selection.awsBedrockCustomSelected === presetSelection.awsBedrockCustomSelected &&
		selection.awsBedrockCustomModelBaseId === presetSelection.awsBedrockCustomModelBaseId &&
		JSON.stringify(selection.modelInfo) === JSON.stringify(presetSelection.modelInfo) &&
		JSON.stringify(selection.vsCodeLmModelSelector) === JSON.stringify(presetSelection.vsCodeLmModelSelector)
	)
}

function formatPreset(preset: Pick<ModelProviderSelection, "provider" | "modelId">): string {
	return `${preset.provider} · ${preset.modelId}`
}

const UtilityModelSelection = () => {
	const { modelProviderPresets, utilityModelEnabled, utilityModelSelection } = useSettingsStore()
	const selectedPreset = utilityModelSelection
		? modelProviderPresets.find((preset) => selectionsMatch(utilityModelSelection, preset))
		: undefined
	const selectedValue = selectedPreset?.id ?? (utilityModelSelection ? "current" : "")

	const handlePresetChange = (presetId: string) => {
		const preset = modelProviderPresets.find((candidate) => candidate.id === presetId)
		if (!preset) return

		updateSetting(
			"utilityModelSelection",
			convertModelProviderSelectionToProto(createModelProviderSelection(preset)),
		)
	}

	return (
		<div className="space-y-3">
			<div>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Utility model</div>
				<p className="mt-1 text-xs text-description">
					Use a separately configured model for conversation condensation and task handoffs.
				</p>
			</div>

			<VSCodeCheckbox
				aria-label="Enable utility model"
				checked={utilityModelEnabled}
				onChange={(event: any) => updateSetting("utilityModelEnabled", event.target.checked === true)}>
				Enable utility model
			</VSCodeCheckbox>

			<label className="flex flex-col gap-1 text-sm" htmlFor="utility-model-selection">
				<span>Provider and model</span>
				{/* VSCodeDropdown can adopt the first option when dynamic presets reorder. */}
				<select
					aria-label="Utility model selection"
					className="w-full rounded-sm border border-(--vscode-dropdown-border) bg-(--vscode-dropdown-background) px-2 py-1 text-sm text-(--vscode-dropdown-foreground) disabled:cursor-not-allowed disabled:opacity-50"
					disabled={!utilityModelEnabled}
					id="utility-model-selection"
					value={selectedValue}
					onChange={(event) => handlePresetChange(event.target.value)}>
					<option disabled value="">
						Select a saved provider/model
					</option>
					{utilityModelSelection && !selectedPreset && (
						<option disabled value="current">
							Current: {formatPreset(utilityModelSelection)}
						</option>
					)}
					{modelProviderPresets.map((preset) => (
						<option key={preset.id} value={preset.id}>
							{formatPreset(preset)}
						</option>
					))}
				</select>
			</label>

			{modelProviderPresets.length === 0 && (
				<p className="text-xs text-description">Run a model once to create a reusable provider/model preset.</p>
			)}

			{utilityModelEnabled && !utilityModelSelection && (
				<p className="rounded border border-(--vscode-inputValidation-warningBorder) px-2 py-1 text-xs text-(--vscode-editorWarning-foreground)">
					Utility model is enabled but no provider/model is configured.
				</p>
			)}

			<p className="text-xs text-description">
				Conversation source text may be sent to this provider, which can differ from the active task provider.
			</p>
		</div>
	)
}

export default UtilityModelSelection
