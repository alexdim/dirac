import type { ToolMetadata } from "@shared/ExtensionMessage"

import { useMemo } from "react"
import { getProviderLabel } from "../../../utils/providers"
import { StateManager } from "@/core/storage/StateManager"
import { ProviderToBaseUrlKeyMap } from "@shared/storage"
import { ApiProvider } from "@shared/api"
import { supportsReasoningEffortForModel } from "@/utils/model-utils"
import { getModelList, CUSTOM_MODEL_ID } from "../../ModelPicker"
import { usesOpenRouterModels } from "../../../utils/openrouter-models"
import { version as CLI_VERSION } from "../../../../package.json"
import { FEATURE_SETTINGS, type FeatureKey } from "../constants"
import { SettingsItemType, SettingsTab, type ListItem } from "../types"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { OpenaiReasoningEffort } from "@shared/storage/types"

interface UseSettingsItemsProps {
	currentTab: SettingsTab
	provider: string
	actModelId: string
	planModelId: string
	separateModels: boolean
	actThinkingEnabled: boolean
	planThinkingEnabled: boolean
	actReasoningEffort: OpenaiReasoningEffort
	planReasoningEffort: OpenaiReasoningEffort
	autoApproveSettings: AutoApprovalSettings
	features: Record<FeatureKey, boolean>
	lightTerminalTheme: boolean
	preferredLanguage: string
	telemetry: TelemetrySetting
	openAiHeaders: Record<string, string>
	openAiCodexIsAuthenticated: boolean
	openAiCodexEmail?: string
	githubIsAuthenticated: boolean
	githubEmail?: string
	openRouterModels?: string[]
	openRouterPinnedProviders: Record<string, string[]>
	openRouterProviderSorting?: string
	openRouterPreventFallbacks: boolean
	availableTools: ToolMetadata[]
	toolToggles: Record<string, boolean>
}

export function useSettingsItems({
	currentTab,
	provider,
	actModelId,
	planModelId,
	separateModels,
	actThinkingEnabled,
	planThinkingEnabled,
	actReasoningEffort,
	planReasoningEffort,
	autoApproveSettings,
	openRouterModels,
	openRouterPinnedProviders,
	openRouterProviderSorting,
	openRouterPreventFallbacks,
	features,
	lightTerminalTheme,
	preferredLanguage,
	telemetry,
	openAiHeaders,
	openAiCodexIsAuthenticated,
	openAiCodexEmail,
	githubIsAuthenticated,
	githubEmail,
	availableTools,
	toolToggles,
}: UseSettingsItemsProps): ListItem[] {
	return useMemo(() => {
		const modelList = usesOpenRouterModels(provider) ? openRouterModels || [] : getModelList(provider)
		const isActCustom = actModelId === CUSTOM_MODEL_ID || (actModelId && !modelList.includes(actModelId))
		const isPlanCustom = planModelId === CUSTOM_MODEL_ID || (planModelId && !modelList.includes(planModelId))
		const providerUsesReasoningEffort = provider === "openai-native" || provider === "openai-codex"
		const showActReasoningEffort = supportsReasoningEffortForModel(actModelId || "")
		const showPlanReasoningEffort = supportsReasoningEffortForModel(planModelId || "")
		const showActThinkingOption = !providerUsesReasoningEffort && !showActReasoningEffort
		const showPlanThinkingOption = !providerUsesReasoningEffort && !showPlanReasoningEffort
		const isOpenRouter = provider === "openrouter"
		const actPinnedProviderCount = openRouterPinnedProviders[actModelId]?.length || 0
		const planPinnedProviderCount = openRouterPinnedProviders[planModelId]?.length || 0
		const formatPinnedProviderCount = (count: number) => (count > 0 ? `${count} allowed` : "Unrestricted")
		const providerSortingLabel = openRouterProviderSorting
			? openRouterProviderSorting[0].toUpperCase() + openRouterProviderSorting.slice(1)
			: "Default"

		switch (currentTab) {
			case SettingsTab.API: {
				const stateManager = StateManager.get()
				return [
					{
						key: "provider" as const,
						label: "Provider",
						type: SettingsItemType.EDITABLE,
						value: provider ? getProviderLabel(provider) : "not configured",
					},
					...(ProviderToBaseUrlKeyMap[provider as ApiProvider]
						? [
							{
								key: "baseUrl",
								label: "Base URL",
								type: SettingsItemType.EDITABLE,
								value:
									(stateManager.getGlobalSettingsKey(
										ProviderToBaseUrlKeyMap[provider as ApiProvider]!,
									) as string) || "",
							},
						]
						: []),
					...(provider === "openai"
						? [
							{
								key: "openAiHeaders",
								label: "Custom Headers",
								type: SettingsItemType.OBJECT,
								value: openAiHeaders,
							},
						]
						: []),
					...(provider === "openai-codex" && openAiCodexIsAuthenticated
						? [
							{
								key: "codexEmail",
								label: "Authenticated as",
								type: SettingsItemType.READONLY,
								value: openAiCodexEmail || "ChatGPT User",
							},
							{
								key: "codexSignOut",
								label: "Sign Out",
								type: SettingsItemType.ACTION,
								value: "",
							},
						]
						: []),
					...(provider === "github-copilot" && githubIsAuthenticated
						? [
							{
								key: "githubEmail",
								label: "Authenticated as",
								type: SettingsItemType.READONLY,
								value: githubEmail || "GitHub User",
							},
							{
								key: "githubSignOut",
								label: "Sign Out",
								type: SettingsItemType.ACTION,
								value: "",
							},
						]
						: []),
					...(provider === "github-copilot" && !githubIsAuthenticated
						? [
							{
								key: "githubSignIn",
								label: "Sign In to GitHub Copilot",
								type: SettingsItemType.ACTION,
								value: "",
							},
						]
						: []),
					...(separateModels
						? [
							{ key: "spacer0", label: "", type: SettingsItemType.SPACER, value: "" },
							{ key: "actHeader", label: "Act Mode", type: SettingsItemType.HEADER, value: "" },
							{
								key: "actModelId",
								label: "Model ID",
								type: SettingsItemType.EDITABLE,
								value: isActCustom ? "Custom" : actModelId || "not set",
							},
							...(isActCustom
								? [
									{
										key: "actCustomModelId",
										label: "Preset/Model",
										type: SettingsItemType.EDITABLE,
										value: actModelId === CUSTOM_MODEL_ID ? "" : actModelId,
									},
								]
								: []),
							...(isOpenRouter
								? [
									{
										key: "actOpenRouterProviders",
										label: "Allowed upstream providers",
										type: SettingsItemType.EDITABLE,
										value: formatPinnedProviderCount(actPinnedProviderCount),
									},
								]
								: []),
							...(showActThinkingOption
								? [
									{
										key: "actThinkingEnabled",
										label: "Enable thinking",
										type: SettingsItemType.CHECKBOX,
										value: actThinkingEnabled,
									},
								]
								: []),
							...(showActReasoningEffort
								? [
									{
										key: "actReasoningEffort",
										label: "Reasoning effort",
										type: SettingsItemType.CYCLE,
										value: actReasoningEffort,
									},
								]
								: []),
							{ key: "planHeader", label: "Plan Mode", type: SettingsItemType.HEADER, value: "" },
							{
								key: "planModelId",
								label: "Model ID",
								type: SettingsItemType.EDITABLE,
								value: isPlanCustom ? "Custom" : planModelId || "not set",
							},
							...(isPlanCustom
								? [
									{
										key: "planCustomModelId",
										label: "Preset/Model",
										type: SettingsItemType.EDITABLE,
										value: planModelId === CUSTOM_MODEL_ID ? "" : planModelId,
									},
								]
								: []),
							...(isOpenRouter
								? [
									{
										key: "planOpenRouterProviders",
										label:
											planModelId === actModelId
												? "Allowed upstream providers (shared with Act)"
												: "Allowed upstream providers",
										type: SettingsItemType.EDITABLE,
										value: formatPinnedProviderCount(planPinnedProviderCount),
									},
								]
								: []),
							...(showPlanThinkingOption
								? [
									{
										key: "planThinkingEnabled",
										label: "Enable thinking",
										type: SettingsItemType.CHECKBOX,
										value: planThinkingEnabled,
									},
								]
								: []),
							...(showPlanReasoningEffort
								? [
									{
										key: "planReasoningEffort",
										label: "Reasoning effort",
										type: SettingsItemType.CYCLE,
										value: planReasoningEffort,
									},
								]
								: []),
							{ key: "spacer1", label: "", type: SettingsItemType.SPACER, value: "" },
						]
						: [
							{
								key: "actModelId",
								label: "Model ID",
								type: SettingsItemType.EDITABLE,
								value: isActCustom ? "Custom" : actModelId || "not set",
							},
							...(isActCustom
								? [
									{
										key: "actCustomModelId",
										label: "Preset/Model",
										type: SettingsItemType.EDITABLE,
										value: actModelId === CUSTOM_MODEL_ID ? "" : actModelId,
									},
								]
								: []),
							...(isOpenRouter
								? [
									{
										key: "actOpenRouterProviders",
										label: "Allowed upstream providers",
										type: SettingsItemType.EDITABLE,
										value: formatPinnedProviderCount(actPinnedProviderCount),
									},
								]
								: []),
							...(showActThinkingOption
								? [
									{
										key: "actThinkingEnabled",
										label: "Enable thinking",
										type: SettingsItemType.CHECKBOX,
										value: actThinkingEnabled,
									},
								]
								: []),
							...(showActReasoningEffort
								? [
									{
										key: "actReasoningEffort",
										label: "Reasoning effort",
										type: SettingsItemType.CYCLE,
										value: actReasoningEffort,
									},
								]
								: []),
						]),
					...(isOpenRouter
						? [
							{
								key: "openRouterProviderSorting",
								label: "Provider sorting",
								type: SettingsItemType.CYCLE,
								value: providerSortingLabel,
							},
							{
								key: "openRouterPreventFallbacks",
								label: "Prevent fallbacks",
								type: SettingsItemType.CHECKBOX,
								value: openRouterPreventFallbacks,
							},
						]
						: []),
					{
						key: "separateModels",
						label: "Use separate models for Plan and Act",
						type: SettingsItemType.CHECKBOX,
						value: separateModels,
					},
				]
			}

			case SettingsTab.AUTO_APPROVE: {
				const result: ListItem[] = []
				const actions = autoApproveSettings.actions

				const addActionPair = (
					parentKey: string,
					parentLabel: string,
					parentDesc: string,
					childKey: string,
					childLabel: string,
					childDesc: string,
				) => {
					result.push({
						key: parentKey,
						label: parentLabel,
						type: SettingsItemType.CHECKBOX,
						value: actions[parentKey as keyof typeof actions] ?? false,
						description: parentDesc,
					})
					if (actions[parentKey as keyof typeof actions]) {
						result.push({
							key: childKey,
							label: childLabel,
							type: SettingsItemType.CHECKBOX,
							value: actions[childKey as keyof typeof actions] ?? false,
							description: childDesc,
							isSubItem: true,
							parentKey,
						})
					}
				}

				addActionPair(
					"readFiles",
					"Read and analyze files",
					"Read and analyze files in the working directory",
					"readFilesExternally",
					"Read all files",
					"Read files outside working directory",
				)
				addActionPair(
					"editFiles",
					"Edit and create files",
					"Edit and create files in the working directory",
					"editFilesExternally",
					"Edit all files",
					"Edit files outside working directory",
				)
				result.push({
					key: "executeCommands",
					label: "Auto-approve safe commands",
					type: SettingsItemType.CHECKBOX,
					value: actions.executeCommands ?? false,
					description: "Run harmless terminal commands automatically",
				})

				result.push(
					{
						key: "useBrowser",
						label: "Use the browser",
						type: SettingsItemType.CHECKBOX,
						value: actions.useBrowser,
						description: "Browse and interact with web pages",
					},
					{ key: "separator", label: "", type: SettingsItemType.SEPARATOR, value: false },
					{
						key: "enableNotifications",
						label: "Enable notifications",
						type: SettingsItemType.CHECKBOX,
						value: autoApproveSettings.enableNotifications,
						description: "System alerts when Dirac needs your attention",
					},
				)
				return result
			}

			case SettingsTab.FEATURES:
				return [
					{
						key: "lightTerminalTheme",
						label: "Light terminal theme",
						type: SettingsItemType.CHECKBOX,
						value: lightTerminalTheme,
						description: "Use the light color palette after restarting Dirac. DIRAC_COLOR_MODE overrides this setting.",
					},
					...Object.entries(FEATURE_SETTINGS).map(([key, config]) => ({
						key,
						label: config.label,
						type: SettingsItemType.CHECKBOX,
						value: features[key as FeatureKey],
						description: config.description,
					})),
				]

			case SettingsTab.TOOLS: {
				const SOURCE_ORDER: Array<ToolMetadata["source"]> = ["builtin", "global", "workspace", "task"]
				const SOURCE_LABELS: Record<string, string> = {
					builtin: "Built-in",
					global: "Global",
					workspace: "Workspace",
						task: "Task",
				}
				const result: ListItem[] = []
				for (const source of SOURCE_ORDER) {
					const tools = availableTools.filter((t) => t.source === source)
					if (tools.length === 0) continue
					result.push({ key: `header-${source}`, label: `${SOURCE_LABELS[source]} Tools`, type: SettingsItemType.HEADER, value: "" })
					const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name))
					for (const tool of sorted) {
						const override = toolToggles[tool.id]
						const isEnabled = override !== undefined ? override : tool.source === "builtin"
						result.push({
							key: tool.id,
							label: tool.name,
							type: SettingsItemType.CHECKBOX,
							value: isEnabled,
						})
					}
				}
				return result
			}

			case SettingsTab.OTHER:
				return [
					{ key: "language", label: "Preferred language", type: SettingsItemType.EDITABLE, value: preferredLanguage },
					{
						key: "telemetry",
						label: "Error/usage reporting",
						type: SettingsItemType.CHECKBOX,
						value: telemetry !== "disabled",
						description: "Help improve Dirac by sending anonymous usage data",
					},
					{ key: "separator", label: "", type: SettingsItemType.SEPARATOR, value: "" },
					{ key: "version", label: "", type: SettingsItemType.READONLY, value: `Dirac v${CLI_VERSION}` },
				]

			default:
				return []
		}
	}, [
		currentTab,
		provider,
		actModelId,
		planModelId,
		separateModels,
		actThinkingEnabled,
		planThinkingEnabled,
		actReasoningEffort,
		planReasoningEffort,
		autoApproveSettings,
		features,
		lightTerminalTheme,
		preferredLanguage,
		telemetry,
		openAiHeaders,
		openAiCodexIsAuthenticated,
		openAiCodexEmail,
		githubIsAuthenticated,
		githubEmail,
		openRouterModels,
		openRouterPinnedProviders,
		openRouterProviderSorting,
		openRouterPreventFallbacks,
		availableTools,
		toolToggles,
	])
}
