import {
	DEFAULT_INFERENCE_SPEED,
	DEFAULT_OPENAI_REASONING_EFFORT,
	isOpenaiReasoningEffort,
	OPENAI_REASONING_EFFORT_OPTIONS,
} from "@shared/ExtensionMessage"
import { modelSupportsInferenceSpeed } from "@shared/api"
import { StringRequest } from "@shared/proto/dirac/common"
import React, { useState } from "react"
import { useAppStore } from "@/app/store/appStore"
import { supportsReasoningEffortForModelId } from "@/features/settings/components/utils/providerUtils"
import { useApiConfigurationHandlers } from "@/features/settings/components/utils/useApiConfigurationHandlers"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { StateServiceClient } from "@/shared/api/grpc-client"
import QuotedMessagePreview from "@/shared/ui/QuotedMessagePreview"
import { ModularChatTextArea } from "../ModularChatTextArea"
import { ChatSection, ChatViewContext } from "../types"

const InputSectionContent: React.FC<{ context: ChatViewContext }> = ({ context }) => {
	const navigateToSettings = useAppStore((state) => state.navigateToSettings)
	const { modelProviderPresets, apiConfiguration } = useSettingsStore()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const [modelPresetError, setModelPresetError] = useState<string>()
	const [isActivatingModelPreset, setIsActivatingModelPreset] = useState(false)
	const [reasoningEffortError, setReasoningEffortError] = useState<string>()
	const [isUpdatingReasoningEffort, setIsUpdatingReasoningEffort] = useState(false)
	const [fastModeError, setFastModeError] = useState<string>()
	const [isUpdatingFastMode, setIsUpdatingFastMode] = useState(false)
	const {
		chatState,
		messageHandlers,
		scrollBehavior,
		placeholderText,
		selectedModelInfo,
	} = context

	const { activeQuote, setActiveQuote, isTextAreaFocused, inputValue, selectedImages, selectedFiles, taskStatus } = chatState

	const { isFollowingRef, scrollToBottomAuto } = scrollBehavior
	const activeProfileName =
		selectedModelInfo.mode === "plan"
			? apiConfiguration?.planModeOpenAiProfileName
			: apiConfiguration?.actModeOpenAiProfileName
	const activeModelProviderPresetId = modelProviderPresets.find(
		(preset) =>
			preset.provider === selectedModelInfo.selectedProvider &&
			preset.modelId === selectedModelInfo.selectedModelId &&
			(preset.provider !== "openai" || preset.openAiProfileName === activeProfileName),
	)?.id
	const supportsReasoningEffort = supportsReasoningEffortForModelId(selectedModelInfo.selectedModelId, selectedModelInfo)
	const configuredReasoningEffort =
		selectedModelInfo.mode === "plan" ? apiConfiguration?.planModeReasoningEffort : apiConfiguration?.actModeReasoningEffort
	const configuredInferenceSpeed =
		selectedModelInfo.mode === "plan" ? apiConfiguration?.planModeInferenceSpeed : apiConfiguration?.actModeInferenceSpeed
	const fastModeSupported = modelSupportsInferenceSpeed(
		selectedModelInfo.selectedProvider,
		selectedModelInfo.selectedModelId,
	)
	const fastModeEnabled = configuredInferenceSpeed === "fast" && fastModeSupported
	const reasoningEffortOptions = OPENAI_REASONING_EFFORT_OPTIONS
	const reasoningEffort = isOpenaiReasoningEffort(configuredReasoningEffort)
		? configuredReasoningEffort
		: DEFAULT_OPENAI_REASONING_EFFORT

	return (
		<>
			{activeQuote && (
				<div className="mb-[-12px] mt-[10px]">
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			<ModularChatTextArea
				activeModelProviderPresetId={activeModelProviderPresetId}
				className="mt-2"
				inputValue={inputValue}
				isActivatingModelPreset={isActivatingModelPreset}
				isUpdatingFastMode={isUpdatingFastMode}
				isUpdatingReasoningEffort={isUpdatingReasoningEffort}
				mode={selectedModelInfo.mode}
				modelDisplayName={`${selectedModelInfo.selectedProvider}:${selectedModelInfo.name || selectedModelInfo.selectedModelId}`}
				fastModeEnabled={fastModeEnabled}
				fastModeError={fastModeError}
				fastModeSupported={fastModeSupported}
				modelPresetError={modelPresetError}
				modelProviderPresets={modelProviderPresets}
				onHeightChange={() => {
					if (isFollowingRef.current) {
						scrollToBottomAuto()
					}
				}}
				onFastModeToggle={async () => {
					setFastModeError(undefined)
					setIsUpdatingFastMode(true)
					try {
						const didPersist = await handleModeFieldChange(
							{ plan: "planModeInferenceSpeed", act: "actModeInferenceSpeed" },
							fastModeEnabled ? DEFAULT_INFERENCE_SPEED : "fast",
							selectedModelInfo.mode,
						)
						if (!didPersist) {
							setFastModeError(useSettingsStore.getState().apiConfigurationError || "Failed to update Fast Mode")
						}
					} finally {
						setIsUpdatingFastMode(false)
					}
				}}
				onModelButtonClick={() => {
					navigateToSettings("api-config")
				}}
				onModelProviderPresetSelect={async (presetId) => {
					setModelPresetError(undefined)
					setIsActivatingModelPreset(true)
					try {
						await StateServiceClient.activateModelProviderPreset(StringRequest.create({ value: presetId }))
					} catch (error) {
						setModelPresetError(error instanceof Error ? error.message : "Failed to switch models")
					} finally {
						setIsActivatingModelPreset(false)
					}
				}}
				onReasoningEffortSelect={async (effort) => {
					setReasoningEffortError(undefined)
					setIsUpdatingReasoningEffort(true)
					try {
						const didPersist = await handleModeFieldChange(
							{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
							effort,
							selectedModelInfo.mode,
						)
						if (!didPersist) {
							setReasoningEffortError(
								useSettingsStore.getState().apiConfigurationError || "Failed to update reasoning effort",
							)
						}
					} finally {
						setIsUpdatingReasoningEffort(false)
					}
				}}
				onSend={() => messageHandlers.handleSendMessage(inputValue, selectedImages, selectedFiles)}
				placeholder={placeholderText}
				reasoningEffort={reasoningEffort}
				reasoningEffortError={reasoningEffortError}
				reasoningEffortOptions={reasoningEffortOptions}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={chatState.sendingDisabled}
				setInputValue={chatState.setInputValue}
				setSelectedFiles={chatState.setSelectedFiles}
				setSelectedImages={chatState.setSelectedImages}
				supportsReasoningEffort={supportsReasoningEffort}
				taskStatus={taskStatus}
			/>
		</>
	)
}

export const InputSection: ChatSection = {
	id: "input",
	shouldRender: () => true,
	render: (context: ChatViewContext) => <InputSectionContent context={context} />,
}
