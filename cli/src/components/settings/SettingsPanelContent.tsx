import { terminalColorMode, TerminalColorMode, theme } from "../../constants/theme"
import React, { useCallback, useMemo, useState } from "react"
import { Text, useInput } from "ink"
import { StateManager } from "@/core/storage/StateManager"
import { buildApiHandler } from "@/core/api"
import { getProviderModelIdKey, isSettingsKey } from "@shared/storage"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { useStdinContext } from "../../context/StdinContext"
import { shouldIgnoreTerminalInput } from "../../utils/input"
import { copyToClipboardNative } from "../../utils/clipboard"
import { Panel } from "../Panel"
import { TABS, FEATURE_SETTINGS, type FeatureKey } from "./constants"
import { normalizeReasoningEffort } from "./utils"
import { usesOpenRouterModels } from "../../utils/openrouter-models"
import { useAuthStatus } from "./hooks/useAuthStatus"
import { useSettingsItems } from "./hooks/useSettingsItems"
import { useSettingsActions } from "./hooks/useSettingsActions"
import { SettingsListView } from "./SettingsListView"
import { UserApprovedCommandsPage } from "./UserApprovedCommandsPage"
import { ProviderPickerPage, ModelPickerPage, LanguagePickerPage, UtilityModelPresetPickerPage } from "./subpages/PickerPages"
import { ApiKeyInputPage, EditValuePage, ObjectEditorPage } from "./subpages/EditPages"
import { BedrockSetupPage, BedrockCustomFlowPage } from "./subpages/SetupPages"
import { CodexAuthPage, GithubAuthPage, AuthErrorPage } from "./subpages/AuthPages"
import { OpenRouterRoutingPage } from "./subpages/OpenRouterRoutingPage"
import { SettingsNavigationDirection, SettingsTab, type SettingsPanelContentProps } from "./types"
import { getFirstSelectableSettingsIndex, isSelectableSettingsItem } from "./navigation"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { OpenaiReasoningEffort } from "@shared/storage/types"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { normalizeUserApprovedCommands, type UserApprovedCommand } from "@shared/UserApprovedCommand"
import type { ModelProviderPreset, ModelProviderSelection } from "@shared/api"
import type { ObjectEditorState } from "../ConfigViewComponents"

import { ToolRegistry } from "@/core/task/tools/registry/ToolRegistry"
import type { ToolMetadata } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getAutoCondenseContextLimit } from "@shared/context-management"
export const SettingsPanelContent: React.FC<SettingsPanelContentProps> = ({
	onClose,
	controller,
	initialMode,
	initialModelKey,
}) => {
	const { isRawModeSupported } = useStdinContext()
	const stateManager = StateManager.get()

	// UI state
	const [currentTab, setCurrentTab] = useState<SettingsTab>(SettingsTab.API)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isEditing, setIsEditing] = useState(false)
	const [isPickingModel, setIsPickingModel] = useState(initialMode === "model-picker")
	const [pickingModelKey, setPickingModelKey] = useState<"actModelId" | "planModelId" | null>(
		initialMode ? (initialModelKey ?? "actModelId") : null,
	)
	const [isPickingProvider, setIsPickingProvider] = useState(initialMode === "provider-picker")
	const [isPickingLanguage, setIsPickingLanguage] = useState(false)
	const [isPickingUtilityModel, setIsPickingUtilityModel] = useState(false)
	const [isEnteringApiKey, setIsEnteringApiKey] = useState(false)
	const [pendingProvider, setPendingProvider] = useState<string | null>(null)
	const [isConfiguringBedrock, setIsConfiguringBedrock] = useState(false)
	const [isWaitingForCodexAuth, setIsWaitingForCodexAuth] = useState(false)
	const [isWaitingForGithubAuth, setIsWaitingForGithubAuth] = useState(false)
	const [githubAuthData, setGithubAuthData] = useState<any>(null)
	const [codexAuthUrl, setCodexAuthUrl] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [codexAuthError, setCodexAuthError] = useState<string | null>(null)
	const [apiKeyValue, setApiKeyValue] = useState("")
	const [editValue, setEditValue] = useState("")
	const [isBedrockCustomFlow, setIsBedrockCustomFlow] = useState(false)
	const [objectEditor, setObjectEditor] = useState<ObjectEditorState | null>(null)
	const [openRouterRoutingModelId, setOpenRouterRoutingModelId] = useState<string | null>(null)
	const [settingsError, setSettingsError] = useState<string | null>(null)
	const [isApplyingSetting, setIsApplyingSetting] = useState(false)
	const actionInProgressRef = React.useRef(false)

	const runSettingsAction = useCallback(async (context: string, action: () => void | Promise<void>): Promise<boolean> => {
		if (actionInProgressRef.current) return false
		actionInProgressRef.current = true
		setIsApplyingSetting(true)
		setSettingsError(null)
		try {
			await action()
			return true
		} catch (error) {
			Logger.error(`Settings ${context} failed:`, error)
			setSettingsError(error instanceof Error ? error.message : String(error))
			return false
		} finally {
			actionInProgressRef.current = false
			setIsApplyingSetting(false)
		}
	}, [])

	// Tool toggle state
	const [availableTools] = useState<ToolMetadata[]>(() => {
		const registry = ToolRegistry.getInstance()
		return registry.getConfigurableTools().map((t) => ({
			id: t.id,
			name: t.name,
			description: t.spec.description,
			source: t.source,
			modulePath: t.modulePath,
		}))
	})
	const [toolToggles, setToolToggles] = useState<Record<string, boolean>>(() => ToolRegistry.getInstance().getToggles())

	// Settings state
	const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(() => {
		const initial: Record<string, boolean> = {}
		for (const [key, config] of Object.entries(FEATURE_SETTINGS)) {
			if (isSettingsKey(config.stateKey)) {
				initial[key] = stateManager.getGlobalSettingsKey(config.stateKey)
			} else {
				initial[key] = stateManager.getGlobalStateKey(config.stateKey)
			}
		}
		return initial as Record<FeatureKey, boolean>
	})
	const [utilityModelEnabled, setUtilityModelEnabled] = useState<boolean>(() =>
		stateManager.getGlobalSettingsKey("utilityModelEnabled"),
	)
	const [utilityModelSelection, setUtilityModelSelection] = useState<ModelProviderSelection | undefined>(() =>
		stateManager.getGlobalSettingsKey("utilityModelSelection"),
	)
	const [modelProviderPresets] = useState<ModelProviderPreset[]>(() =>
		stateManager.getGlobalSettingsKey("modelProviderPresets") ?? [],
	)

	const [lightTerminalTheme, setLightTerminalTheme] = useState<boolean>(() => {
		const savedPreference = stateManager.getGlobalSettingsKey("cliTerminalColorMode")
		return savedPreference ? savedPreference === "light" : terminalColorMode === TerminalColorMode.LIGHT
	})
	const [separateModels, setSeparateModels] = useState<boolean>(
		() => stateManager.getGlobalSettingsKey("planActSeparateModelsSetting") ?? false,
	)
	const [actThinkingEnabled, setActThinkingEnabled] = useState<boolean>(
		() => (stateManager.getGlobalSettingsKey("actModeThinkingBudgetTokens") ?? 0) > 0,
	)
	const [planThinkingEnabled, setPlanThinkingEnabled] = useState<boolean>(
		() => (stateManager.getGlobalSettingsKey("planModeThinkingBudgetTokens") ?? 0) > 0,
	)
	const [actReasoningEffort, setActReasoningEffort] = useState<OpenaiReasoningEffort>(() =>
		normalizeReasoningEffort(stateManager.getGlobalSettingsKey("actModeReasoningEffort")),
	)
	const [planReasoningEffort, setPlanReasoningEffort] = useState<OpenaiReasoningEffort>(() =>
		normalizeReasoningEffort(stateManager.getGlobalSettingsKey("planModeReasoningEffort")),
	)
	const [autoApproveSettings, setAutoApproveSettings] = useState<AutoApprovalSettings>(() => {
		return stateManager.getGlobalSettingsKey("autoApprovalSettings") ?? DEFAULT_AUTO_APPROVAL_SETTINGS
	})
	const [userApprovedCommands, setUserApprovedCommands] = useState<UserApprovedCommand[]>(() =>
		stateManager.getGlobalSettingsKey("userApprovedCommands"),
	)
	const [preferredLanguage, setPreferredLanguage] = useState<string>(
		() => stateManager.getGlobalSettingsKey("preferredLanguage") || "English",
	)
	const [telemetry, setTelemetry] = useState<TelemetrySetting>(
		() => stateManager.getGlobalSettingsKey("telemetrySetting") || "unset",
	)
	const [provider, setProvider] = useState<string>(
		() =>
			stateManager.getApiConfiguration().actModeApiProvider ||
			stateManager.getApiConfiguration().planModeApiProvider ||
			"not configured",
	)
	const [openAiHeaders, setOpenAiHeaders] = useState<Record<string, string>>(
		() => stateManager.getGlobalSettingsKey("openAiHeaders") ?? {},
	)
	const [autoCondenseContextLimit, setAutoCondenseContextLimit] = useState(() =>
		getAutoCondenseContextLimit(stateManager.getGlobalSettingsKey("autoCondenseContextLimits"), provider),
	)
	React.useEffect(() => {
		setAutoCondenseContextLimit(
			getAutoCondenseContextLimit(stateManager.getGlobalSettingsKey("autoCondenseContextLimits"), provider),
		)
	}, [provider, stateManager])
	const [openRouterPinnedProviders, setOpenRouterPinnedProviders] = useState<Record<string, string[]>>(
		() => stateManager.getGlobalSettingsKey("openRouterPinnedProviders") ?? {},
	)
	const [openRouterProviderSorting, setOpenRouterProviderSorting] = useState<string | undefined>(() =>
		stateManager.getGlobalSettingsKey("openRouterProviderSorting"),
	)
	const [openRouterPreventFallbacks, setOpenRouterPreventFallbacks] = useState(
		() => stateManager.getGlobalSettingsKey("openRouterPreventFallbacks") ?? false,
	)

	const [modelRefreshKey, setModelRefreshKey] = useState(0)
	const [openRouterModels, setOpenRouterModels] = useState<string[]>([])
	React.useEffect(() => {
		if (!usesOpenRouterModels(provider) || !controller) {
			setOpenRouterModels([])
			return
		}
		let cancelled = false
		controller
			.readOpenRouterModels()
			.then((models) => {
				if (!cancelled) setOpenRouterModels(models ? Object.keys(models) : [])
			})
			.catch((error) => {
				Logger.error("Failed to load OpenRouter models for settings:", error)
				if (!cancelled) {
					setOpenRouterModels([])
					setSettingsError(error instanceof Error ? error.message : String(error))
				}
			})
		return () => {
			cancelled = true
		}
	}, [provider, controller, modelRefreshKey])
	const refreshModelIds = useCallback(() => setModelRefreshKey((k) => k + 1), [])

	const { actModelId, planModelId } = useMemo(() => {
		const apiConfig = stateManager.getApiConfiguration()
		const actProvider = apiConfig.actModeApiProvider
		const planProvider = apiConfig.planModeApiProvider || actProvider
		if (!actProvider && !planProvider) {
			return { actModelId: "", planModelId: "" }
		}
		const actKey = actProvider ? getProviderModelIdKey(actProvider, "act") : null
		const planKey = planProvider ? getProviderModelIdKey(planProvider, "plan") : null
		return {
			actModelId: actKey ? (stateManager.getGlobalSettingsKey(actKey) as string) || "" : "",
			planModelId: planKey ? (stateManager.getGlobalSettingsKey(planKey) as string) || "" : "",
		}
	}, [modelRefreshKey, stateManager])

	const rebuildTaskApi = useCallback(async () => {
		const currentMode = stateManager.getGlobalSettingsKey("mode")
		const apiConfig = stateManager.getApiConfiguration()
		if (controller?.task) {
			controller.task.api = buildApiHandler({ ...apiConfig, ulid: controller.task.ulid }, currentMode)
		}
		await controller?.postStateToWebview()
	}, [controller, stateManager])

	const { openAiCodexIsAuthenticated, openAiCodexEmail, githubIsAuthenticated, githubEmail, authStatusError } = useAuthStatus(
		provider,
		isWaitingForCodexAuth,
		isWaitingForGithubAuth,
	)

	const items = useSettingsItems({
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
		utilityModelEnabled,
		utilityModelSelection,
		lightTerminalTheme,
		preferredLanguage,
		telemetry,
		openAiHeaders,
		autoCondenseContextLimit,
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
	})

	React.useEffect(() => {
		setSelectedIndex((currentIndex) =>
			isSelectableSettingsItem(items[currentIndex]) ? currentIndex : getFirstSelectableSettingsIndex(items),
		)
	}, [items])

	const {
		handleAction,
		handleSave,
		handleProviderSelect,
		handleModelSelect,
		handleApiKeySubmit,
		handleBedrockComplete,
		handleBedrockCustomFlowComplete,
		handleLanguageSelect,
		handleUtilityModelPresetSelect,
		cancelCodexAuth,
		cancelGithubAuth,
		navigateItems,
	} = useSettingsActions({
		items,
		selectedIndex,
		setSelectedIndex,
		provider,
		setProvider,
		actModelId,
		planModelId,
		openRouterProviderSorting,
		setOpenRouterProviderSorting,
		setOpenRouterPreventFallbacks,
		setOpenRouterRoutingModelId,
		actReasoningEffort,
		setActReasoningEffort,
		planReasoningEffort,
		setPlanReasoningEffort,
		separateModels,
		setSeparateModels,
		actThinkingEnabled,
		setActThinkingEnabled,
		planThinkingEnabled,
		setPlanThinkingEnabled,
		autoApproveSettings,
		setAutoApproveSettings,
		features,
		utilityModelEnabled,
		setUtilityModelEnabled,
		setFeatures,
		setLightTerminalTheme,
		preferredLanguage,
		setPreferredLanguage,
		telemetry,
		setTelemetry,
		openAiHeaders,
		setOpenAiHeaders,
		setAutoCondenseContextLimit,
		setIsPickingProvider,
		setIsPickingModel,
		pickingModelKey,
		setPickingModelKey,
		setIsPickingLanguage,
		setIsPickingUtilityModel,
		setUtilityModelSelection,
		setIsEnteringApiKey,
		pendingProvider,
		setPendingProvider,
		setApiKeyValue,
		setIsEditing,
		setEditValue,
		setObjectEditor,
		setIsWaitingForCodexAuth,
		setIsWaitingForGithubAuth,
		setCodexAuthError,
		setCodexAuthUrl,
		setGithubAuthData,
		setIsBedrockCustomFlow,
		setIsConfiguringBedrock,
		controller,
		stateManager,
		rebuildTaskApi,
		refreshModelIds,
		onClose,
		initialMode,
		availableTools,
		setToolToggles,
	})

	const updateUserApprovedCommands = useCallback(
		(commands: UserApprovedCommand[]) =>
			runSettingsAction("approved command update", async () => {
				const normalizedCommands = normalizeUserApprovedCommands(commands)
				stateManager.setGlobalState("userApprovedCommands", normalizedCommands)
				await stateManager.flushPendingState()
				setUserApprovedCommands(normalizedCommands)
				await controller?.postStateToWebview()
			}),
		[controller, runSettingsAction, stateManager],
	)
	const handleTabChange = useCallback((tabKey: string) => {
		setSettingsError(null)
		setCurrentTab(tabKey as SettingsTab)
		setSelectedIndex(0)
		setIsEditing(false)
		setIsPickingModel(false)
		setPickingModelKey(null)
		setIsPickingProvider(false)
		setIsPickingLanguage(false)
		setIsPickingUtilityModel(false)
		setIsEnteringApiKey(false)
		setPendingProvider(null)
		setApiKeyValue("")
		setOpenRouterRoutingModelId(null)
	}, [])

	const navigateTabs = useCallback(
		(direction: "left" | "right") => {
			const tabKeys = TABS.map((t) => t.key)
			const currentIdx = tabKeys.indexOf(currentTab)
			const newIdx =
				direction === "left"
					? currentIdx > 0
						? currentIdx - 1
						: tabKeys.length - 1
					: currentIdx < tabKeys.length - 1
						? currentIdx + 1
						: 0
			handleTabChange(tabKeys[newIdx])
		},
		[currentTab, handleTabChange],
	)

	useInput(
		(input, key) => {
			if (objectEditor) return
			if (shouldIgnoreTerminalInput(input, key)) return
			if (openRouterRoutingModelId) return
			if (currentTab === SettingsTab.USER_APPROVED_COMMANDS) {
				if (key.leftArrow) navigateTabs("left")
				if (key.rightArrow) navigateTabs("right")
				return
			}

			if (isPickingProvider) {
				if (key.escape) {
					setIsPickingProvider(false)
					if (initialMode) onClose()
				}
				return
			}

			if (isPickingModel) {
				if (key.escape) {
					setIsPickingModel(false)
					setPickingModelKey(null)

					setPendingProvider(null)
					if (initialMode) onClose()
				}
				return
			}

			if (isPickingUtilityModel) {
				if (key.escape) setIsPickingUtilityModel(false)
				return
			}

			if (isPickingLanguage) {
				if (key.escape) setIsPickingLanguage(false)
				return
			}

			if (isWaitingForCodexAuth) {
				if (input === "c" && codexAuthUrl) {
					const ok = copyToClipboardNative(codexAuthUrl)
					if (ok) {
						setCopied(true)
						setTimeout(() => setCopied(false), 2000)
					}
					return
				}
				if (key.escape) {
					cancelCodexAuth()
				}
				return
			}

			if (isWaitingForGithubAuth) {
				if (key.escape) {
					cancelGithubAuth()
				}
				return
			}

			if (codexAuthError) {
				setCodexAuthError(null)
				return
			}

			if (isBedrockCustomFlow) return

			if (isEditing) {
				if (key.escape) {
					setIsEditing(false)
					return
				}
				if (key.return) {
					runSettingsAction("save", () => handleSave(editValue))
					return
				}
				if (key.backspace || key.delete) {
					setEditValue((prev) => prev.slice(0, -1))
					return
				}
				if (input && !key.ctrl && !key.meta) {
					setEditValue((prev) => prev + input)
				}
				return
			}

			if (key.escape) {
				onClose()
				return
			}
			if (key.leftArrow) {
				navigateTabs("left")
				return
			}
			if (key.rightArrow) {
				navigateTabs("right")
				return
			}
			if (key.upArrow) {
				navigateItems(SettingsNavigationDirection.UP)
				return
			}
			if (key.downArrow) {
				navigateItems(SettingsNavigationDirection.DOWN)
				return
			}
			if (key.tab || key.return || input === " ") {
				runSettingsAction("update", handleAction)
				return
			}
		},
		{ isActive: isRawModeSupported && !isEnteringApiKey && !isConfiguringBedrock },
	)

	const renderContent = () => {
		if (openRouterRoutingModelId) {
			return (
				<OpenRouterRoutingPage
					isActive={!isApplyingSetting}
					modelId={openRouterRoutingModelId}
					onCancel={() => setOpenRouterRoutingModelId(null)}
					onSave={(providers) => {
						const nextPinnedProviders = { ...openRouterPinnedProviders }
						if (providers.length > 0) nextPinnedProviders[openRouterRoutingModelId] = providers
						else delete nextPinnedProviders[openRouterRoutingModelId]
						setOpenRouterPinnedProviders(nextPinnedProviders)
						stateManager.setGlobalState(
							"openRouterPinnedProviders",
							Object.keys(nextPinnedProviders).length > 0 ? nextPinnedProviders : undefined,
						)
						runSettingsAction("routing update", async () => {
							await rebuildTaskApi()
							setOpenRouterRoutingModelId(null)
						})
					}}
					savedProviders={openRouterPinnedProviders[openRouterRoutingModelId] || []}
				/>
			)
		}
		if (isPickingProvider) {
			return (
				<ProviderPickerPage
					isActive={isPickingProvider && !isApplyingSetting}
					onSelect={(providerId) => runSettingsAction("provider update", () => handleProviderSelect(providerId))}
				/>
			)
		}
		if (isEnteringApiKey && pendingProvider) {
			return (
				<ApiKeyInputPage
					isActive={isEnteringApiKey && !isApplyingSetting}
					onCancel={() => {
						setIsEnteringApiKey(false)
						setPendingProvider(null)
						setApiKeyValue("")
					}}
					onChange={setApiKeyValue}
					onSubmit={(value) => runSettingsAction("API key update", () => handleApiKeySubmit(value))}
					pendingProvider={pendingProvider}
					apiKeyValue={apiKeyValue}
				/>
			)
		}
		if (isConfiguringBedrock) {
			return (
				<BedrockSetupPage
					isActive={isConfiguringBedrock && !isApplyingSetting}
					onCancel={() => {
						setIsConfiguringBedrock(false)
						setPendingProvider(null)
					}}
					onComplete={(config) => runSettingsAction("Bedrock setup", () => handleBedrockComplete(config))}
				/>
			)
		}
		if (isWaitingForCodexAuth) {
			return <CodexAuthPage codexAuthUrl={codexAuthUrl} copied={copied} />
		}
		if (isWaitingForGithubAuth && githubAuthData) {
			return <GithubAuthPage githubAuthData={githubAuthData} />
		}
		if (codexAuthError) {
			return <AuthErrorPage error={codexAuthError} />
		}
		if (isPickingModel && pickingModelKey) {
			const label = pickingModelKey === "actModelId" ? "Model ID (Act)" : "Model ID (Plan)"
			return (
				<ModelPickerPage
					controller={controller}
					isActive={isPickingModel && !isApplyingSetting}
					onSelect={(modelId) => runSettingsAction("model update", () => handleModelSelect(modelId))}
					provider={pendingProvider || provider}
					label={label}
				/>
			)
		}
		if (isPickingUtilityModel) {
			return (
				<UtilityModelPresetPickerPage
					isActive={isPickingUtilityModel && !isApplyingSetting}
					presets={modelProviderPresets}
					onSelect={(preset) =>
						runSettingsAction("utility model selection", () => handleUtilityModelPresetSelect(preset))
					}
				/>
			)
		}

		if (isPickingLanguage) {
			return (
				<LanguagePickerPage
					isActive={isPickingLanguage && !isApplyingSetting}
					onSelect={(language) => runSettingsAction("language update", () => handleLanguageSelect(language))}
				/>
			)
		}
		if (isBedrockCustomFlow) {
			return (
				<BedrockCustomFlowPage
					isActive={isBedrockCustomFlow && !isApplyingSetting}
					onCancel={() => {
						setIsBedrockCustomFlow(false)
						setIsPickingModel(true)
					}}
					onComplete={(arn, modelId) =>
						runSettingsAction("custom Bedrock model update", () => handleBedrockCustomFlowComplete(arn, modelId))
					}
				/>
			)
		}
		if (isEditing) {
			const item = items[selectedIndex]
			return <EditValuePage label={item?.label} value={editValue} />
		}
		if (objectEditor) {
			return (
				<ObjectEditorPage
					objectEditor={objectEditor}
					setObjectEditor={setObjectEditor}
					onPersist={(nextObject) => {
						if (objectEditor.key === "openAiHeaders") {
							const headers = nextObject as Record<string, string>
							setOpenAiHeaders(headers)
							stateManager.setGlobalState("openAiHeaders", headers)
							runSettingsAction("custom header update", rebuildTaskApi)
						}
					}}
				/>
			)
		}

		if (currentTab === SettingsTab.USER_APPROVED_COMMANDS) {
			return (
				<UserApprovedCommandsPage
					commands={userApprovedCommands}
					isActive={isRawModeSupported && !isApplyingSetting}
					onChange={updateUserApprovedCommands}
					onClose={onClose}
				/>
			)
		}


		return <SettingsListView items={items} selectedIndex={selectedIndex} />
	}

	const isSubpage =
		isPickingProvider ||
		isPickingModel ||
		isPickingLanguage ||
		isPickingUtilityModel ||
		isEnteringApiKey ||
		isConfiguringBedrock ||
		isWaitingForCodexAuth ||
		!!codexAuthError ||
		isBedrockCustomFlow ||
		isWaitingForGithubAuth ||
		isEditing ||
		!!objectEditor ||
		!!openRouterRoutingModelId

	return (
		<Panel currentTab={currentTab} isSubpage={isSubpage} label="Settings" tabs={TABS}>
			{(settingsError || authStatusError) && (
				<Text color={theme.error}>Settings error: {settingsError || authStatusError}</Text>
			)}
			{isApplyingSetting && <Text color={theme.muted}>Applying change…</Text>}
			{renderContent()}
		</Panel>
	)
}
