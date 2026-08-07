import { ALL_MODEL_MAPS, ALL_PROVIDERS, type ApiProvider, type ModelInfo, type ModelProviderSelection } from "@shared/api"
import PROVIDERS from "@shared/providers/providers.json"
import { convertModelProviderSelectionToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useMemo, useState } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { ModelAutocomplete } from "./common/ModelAutocomplete"
import { updateSetting } from "./utils/settingsHandlers"

const USE_CASES = [
	{
		field: "utilityModelUseCondense" as const,
		label: "Condense conversation",
		description: "Summarize long conversations before their context limit is reached.",
	},
	{
		field: "utilityModelUseNewTask" as const,
		label: "New task handoffs",
		description: "Generate complete task handoffs from concise new-task intents.",
	},
	{
		field: "utilityModelUseGenerateCommitMessage" as const,
		label: "Generate commit messages",
		description: "Generate Git commit messages in VS Code.",
	},
]

function getProviderModels(provider: ApiProvider, dynamicModels: Record<string, unknown>): Record<string, ModelInfo> {
	const staticModels = ALL_MODEL_MAPS
		.filter(([candidate]) => candidate === provider)
		.reduce<Record<string, ModelInfo>>((models, [, candidateModels]) => ({ ...models, ...candidateModels }), {})
	const providerModels = dynamicModels[provider]
	return providerModels && typeof providerModels === "object"
		? { ...staticModels, ...(providerModels as Record<string, ModelInfo>) }
		: staticModels
}

function getProviderLabel(provider: ApiProvider): string {
	return PROVIDERS.list.find((candidate) => candidate.value === provider)?.label ?? provider
}

const UtilityModelSelection = () => {
	const {
		utilityModelSelection,
		utilityModelUseCondense,
		utilityModelUseNewTask,
		utilityModelUseGenerateCommitMessage,
		openRouterModels,
		openAiModels,
		liteLlmModels,
		requestyModels,
		groqModels,
		basetenModels,
		huggingFaceModels,
		vercelAiGatewayModels,
	} = useSettingsStore()
	const dynamicModels = useMemo<Record<string, unknown>>(
		() => ({
			openrouter: openRouterModels,
			openai: openAiModels,
			litellm: liteLlmModels,
			requesty: requestyModels,
			groq: groqModels,
			baseten: basetenModels,
			huggingface: huggingFaceModels,
			"vercel-ai-gateway": vercelAiGatewayModels,
		}),
		[
			basetenModels,
			groqModels,
			huggingFaceModels,
			liteLlmModels,
			openAiModels,
			openRouterModels,
			requestyModels,
			vercelAiGatewayModels,
		],
	)
	const [pendingSelection, setPendingSelection] = useState<ModelProviderSelection | undefined>()
	useEffect(() => setPendingSelection(undefined), [utilityModelSelection])
	const selection = pendingSelection ?? utilityModelSelection
	const provider = selection?.provider ?? "openrouter"
	const models = useMemo(() => getProviderModels(provider, dynamicModels), [dynamicModels, provider])
	const anyUseCaseEnabled =
		utilityModelUseCondense || utilityModelUseNewTask || utilityModelUseGenerateCommitMessage

	const persistSelection = (nextSelection: ModelProviderSelection) => {
		setPendingSelection(nextSelection)
		updateSetting("utilityModelSelection", convertModelProviderSelectionToProto(nextSelection))
	}

	const handleProviderChange = (nextProvider: ApiProvider) => {
		const nextModels = getProviderModels(nextProvider, dynamicModels)
		const modelId = Object.keys(nextModels)[0] ?? ""
		persistSelection({ provider: nextProvider, modelId, modelInfo: nextModels[modelId] })
	}

	const handleModelChange = (modelId: string, modelInfo: ModelInfo | undefined) => {
		persistSelection({
			provider,
			modelId,
			modelInfo,
			openAiProfileName: selection?.openAiProfileName,
			vsCodeLmModelSelector: selection?.vsCodeLmModelSelector,
			awsBedrockCustomSelected: selection?.awsBedrockCustomSelected,
			awsBedrockCustomModelBaseId: selection?.awsBedrockCustomModelBaseId,
		})
	}

	return (
		<div className="space-y-5">
			<div>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Utility model</div>
				<p className="mt-1 text-xs text-description">
					Choose a separate, secret-free provider and model for background utility tasks. Its credentials and provider
					settings are configured in API Configuration.
				</p>
			</div>

			<div className="space-y-3">
				<label className="flex flex-col gap-1 text-sm" htmlFor="utility-model-provider">
					<span className="font-medium">API Provider</span>
					<select
						aria-label="Utility model provider"
						className="w-full rounded-sm border border-(--vscode-dropdown-border) bg-(--vscode-dropdown-background) px-2 py-1 text-sm text-(--vscode-dropdown-foreground)"
						id="utility-model-provider"
						value={provider}
						onChange={(event) => handleProviderChange(event.target.value as ApiProvider)}>
						{ALL_PROVIDERS.map((candidate) => (
							<option key={candidate} value={candidate}>
								{getProviderLabel(candidate)}
							</option>
						))}
					</select>
				</label>
				<ModelAutocomplete
					label="Model"
					models={models}
					onChange={handleModelChange}
					placeholder="Search or enter any model ID..."
					selectedModelId={selection?.modelId}
				/>
			</div>

			<div className="space-y-2 border-t border-(--vscode-panel-border) pt-4">
				<div className="text-sm font-medium">Use utility model for</div>
				{USE_CASES.map(({ field, label, description }) => (
					<div key={field}>
						<VSCodeCheckbox
							aria-label={label}
							checked={
								field === "utilityModelUseCondense"
									? utilityModelUseCondense
									: field === "utilityModelUseNewTask"
										? utilityModelUseNewTask
										: utilityModelUseGenerateCommitMessage
							}
							onChange={(event: any) => updateSetting(field, event.target.checked === true)}>
							{label}
						</VSCodeCheckbox>
						<p className="ml-6 mt-0.5 text-xs text-description">{description}</p>
					</div>
				))}
			</div>

			{anyUseCaseEnabled && !selection?.modelId && (
				<p className="rounded border border-(--vscode-inputValidation-warningBorder) px-2 py-1 text-xs text-(--vscode-editorWarning-foreground)">
					Select a provider and model before enabling Utility model use cases.
				</p>
			)}

			<p className="text-xs text-description">
				Conversation source text and Git diffs may be sent to this provider, which can differ from the active task provider.
			</p>
		</div>
	)
}

export default UtilityModelSelection
