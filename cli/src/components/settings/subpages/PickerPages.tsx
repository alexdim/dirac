import { theme } from "../../../constants/theme"
import React from "react"
import { Box, Text } from "ink"
import { COLORS } from "../../../constants/colors"
import { ProviderPicker } from "../../ProviderPicker"
import { ModelPicker } from "../../ModelPicker"
import { LanguagePicker } from "../../LanguagePicker"
import type { Controller } from "@/core/controller"
import type { ModelProviderPreset } from "@shared/api"
import { getProviderLabel } from "../../../utils/providers"
import { SearchableList } from "../../SearchableList"

interface ProviderPickerPageProps {
	isActive: boolean
	onSelect: (providerId: string) => void
}

export const ProviderPickerPage: React.FC<ProviderPickerPageProps> = ({ isActive, onSelect }) => (
	<Box flexDirection="column">
		<Text bold color={COLORS.primaryBlue}>
			Select Provider
		</Text>
		<Box marginTop={1}>
			<ProviderPicker isActive={isActive} onSelect={onSelect} />
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>Type to search, arrows to navigate, Enter to select, Esc to cancel</Text>
		</Box>
	</Box>
)

interface ModelPickerPageProps {
	controller?: Controller
	isActive: boolean
	onSelect: (modelId: string) => void
	provider: string
	label: string
}

export const ModelPickerPage: React.FC<ModelPickerPageProps> = ({ controller, isActive, onSelect, provider, label }) => (
	<Box flexDirection="column">
		<Text bold color={COLORS.primaryBlue}>
			Select: {label}
		</Text>
		<Box marginTop={1}>
			<ModelPicker
				controller={controller}
				isActive={isActive}
				onChange={() => { }}
				onSubmit={onSelect}
				provider={provider}
			/>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>Type to search, arrows to navigate, Enter to select, Esc to cancel</Text>
		</Box>
	</Box>
)

interface LanguagePickerPageProps {
	isActive: boolean
	onSelect: (language: string) => void
}

export const LanguagePickerPage: React.FC<LanguagePickerPageProps> = ({ isActive, onSelect }) => (
	<Box flexDirection="column">
		<Text bold color={COLORS.primaryBlue}>
			Select Language
		</Text>
		<Box marginTop={1}>
			<LanguagePicker isActive={isActive} onSelect={onSelect} />
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>Type to search, arrows to navigate, Enter to select, Esc to cancel</Text>
		</Box>
	</Box>
)

interface UtilityModelPresetPickerPageProps {
	isActive: boolean
	presets: ModelProviderPreset[]
	onSelect: (preset: ModelProviderPreset) => void
}

export const UtilityModelPresetPickerPage: React.FC<UtilityModelPresetPickerPageProps> = ({
	isActive,
	presets,
	onSelect,
}) => (
	<Box flexDirection="column">
		<Text bold color={COLORS.primaryBlue}>
			Select Utility Model
		</Text>
		<Box marginTop={1}>
			<SearchableList
				isActive={isActive}
				items={presets.map((preset) => ({
					id: preset.id,
					label: `${getProviderLabel(preset.provider)} · ${preset.modelId}`,
					suffix: preset.openAiProfileName,
				}))}
				onSelect={(item) => {
					const preset = presets.find((candidate) => candidate.id === item.id)
					if (preset) onSelect(preset)
				}}
			/>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>
				Choose a saved provider/model. Conversation source text may be sent to a provider other than the active task provider.
			</Text>
		</Box>
	</Box>
)
