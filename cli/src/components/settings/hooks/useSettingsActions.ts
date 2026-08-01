import { isValidAutoCondenseContextLimit } from "@shared/context-management"
import { useCallback, useRef } from "react"
import { StateManager } from "@/core/storage/StateManager"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@shared/storage"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { openAiCodexUsageService } from "@/integrations/openai-codex/OpenAiCodexUsageService"
import { githubCopilotAuthManager } from "@/integrations/github-copilot/auth"
import { applyProviderConfig, applyBedrockConfig } from "../../../utils/provider-config"
import { normalizeReasoningEffort, nextReasoningEffort } from "../utils"
import { FEATURE_SETTINGS, type FeatureKey } from "../constants"
import { hasModelPicker, CUSTOM_MODEL_ID } from "../../ModelPicker"
import { usesOpenRouterModels } from "../../../utils/openrouter-models"
import { openExternal } from "@/utils/env"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "@/core/controller"
import { SettingsItemType, SettingsNavigationDirection, type ListItem } from "../types"
import { getNextSelectableSettingsIndex } from "../navigation"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { OpenaiReasoningEffort } from "@shared/storage/types"
import { createModelProviderSelection, type ApiProvider, type ModelInfo, type ModelProviderPreset, type ModelProviderSelection } from "@shared/api"
import type { ObjectEditorState } from "../../ConfigViewComponents"
import type { BedrockConfig } from "../../BedrockSetup"
import type { ToolMetadata } from "@shared/ExtensionMessage"
import { ToolRegistry } from "@/core/task/tools/registry/ToolRegistry"

interface UseSettingsActionsProps {
	items: ListItem[]
	selectedIndex: number
	setSelectedIndex: (index: number | ((i: number) => number)) => void
	provider: string
	setProvider: (provider: string) => void
	actModelId: string
	planModelId: string
	openRouterProviderSorting?: string
	setOpenRouterProviderSorting: (sorting: string | undefined) => void
	setOpenRouterPreventFallbacks: (preventFallbacks: boolean) => void
	setOpenRouterRoutingModelId: (modelId: string | null) => void
	actReasoningEffort: OpenaiReasoningEffort
	setActReasoningEffort: (effort: OpenaiReasoningEffort) => void
	planReasoningEffort: OpenaiReasoningEffort
	setPlanReasoningEffort: (effort: OpenaiReasoningEffort) => void
	separateModels: boolean
	setSeparateModels: (value: boolean) => void
	actThinkingEnabled: boolean
	setActThinkingEnabled: (value: boolean) => void
	planThinkingEnabled: boolean
	setPlanThinkingEnabled: (value: boolean) => void
	autoApproveSettings: AutoApprovalSettings
	setAutoApproveSettings: (settings: AutoApprovalSettings) => void
	features: Record<FeatureKey, boolean>
	utilityModelEnabled: boolean
	setUtilityModelEnabled: (value: boolean) => void
	setFeatures: (
		features: Record<FeatureKey, boolean> | ((prev: Record<FeatureKey, boolean>) => Record<FeatureKey, boolean>),
	) => void
	setLightTerminalTheme: (value: boolean) => void
	preferredLanguage: string
	setPreferredLanguage: (language: string) => void
	telemetry: TelemetrySetting
	setTelemetry: (telemetry: TelemetrySetting) => void
	openAiHeaders: Record<string, string>
	setOpenAiHeaders: (headers: Record<string, string>) => void
	setAutoCondenseContextLimit: (limit: number) => void
	setIsPickingProvider: (value: boolean) => void
	setIsPickingModel: (value: boolean) => void
	pickingModelKey: "actModelId" | "planModelId" | null
	setPickingModelKey: (key: "actModelId" | "planModelId" | null) => void
	setIsPickingLanguage: (value: boolean) => void
	setIsPickingUtilityModel: (value: boolean) => void
	setUtilityModelSelection: (selection: ModelProviderSelection | undefined) => void
	setIsEnteringApiKey: (value: boolean) => void
	pendingProvider: string | null
	setPendingProvider: (provider: string | null) => void
	setApiKeyValue: (value: string) => void
	setIsEditing: (value: boolean) => void
	setEditValue: (value: string) => void
	setObjectEditor: (state: ObjectEditorState | null) => void
	setIsWaitingForCodexAuth: (value: boolean) => void
	setIsWaitingForGithubAuth: (value: boolean) => void
	setCodexAuthError: (error: string | null) => void
	setCodexAuthUrl: (url: string | null) => void
	setGithubAuthData: (data: any) => void
	setIsBedrockCustomFlow: (value: boolean) => void
	setIsConfiguringBedrock: (value: boolean) => void
	controller?: Controller
	stateManager: StateManager
	rebuildTaskApi: () => Promise<void>
	refreshModelIds: () => void
	onClose: () => void
	initialMode?: string
	availableTools: ToolMetadata[]
	setToolToggles: (toggles: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void
}

export function useSettingsActions({
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
}: UseSettingsActionsProps) {
	const cancelCodexAuthWaitRef = useRef<(() => void) | null>(null)
	const githubAuthAbortControllerRef = useRef<AbortController | null>(null)

	const toggleFeature = useCallback(
		async (key: FeatureKey) => {
			const config = FEATURE_SETTINGS[key]
			const newValue = !features[key]
			setFeatures((prev) => ({ ...prev, [key]: newValue }))
			stateManager.setGlobalState(config.stateKey, newValue)

			await rebuildTaskApi()
		},
		[features, stateManager, setFeatures, rebuildTaskApi],
	)

	const handleUtilityModelPresetSelect = useCallback(
		async (preset: ModelProviderPreset) => {
			const selection = createModelProviderSelection(preset)
			stateManager.setGlobalState("utilityModelSelection", selection)
			setUtilityModelSelection(selection)
			await stateManager.flushPendingState()
			await controller?.postStateToWebview()
			setIsPickingUtilityModel(false)
		},
		[controller, stateManager, setIsPickingUtilityModel, setUtilityModelSelection],
	)

	const setReasoningEffortForMode = useCallback(
		async (mode: "act" | "plan", effort: OpenaiReasoningEffort) => {
			if (mode === "act") {
				setActReasoningEffort(effort)
				stateManager.setGlobalState("actModeReasoningEffort", effort)
				if (!separateModels) {
					setPlanReasoningEffort(effort)
					stateManager.setGlobalState("planModeReasoningEffort", effort)
				}
			} else {
				setPlanReasoningEffort(effort)
				stateManager.setGlobalState("planModeReasoningEffort", effort)
			}
			await rebuildTaskApi()
		},
		[separateModels, rebuildTaskApi, stateManager, setActReasoningEffort, setPlanReasoningEffort],
	)

	const startCodexAuth = useCallback(async () => {
		try {
			setIsWaitingForCodexAuth(true)
			setCodexAuthError(null)
			const authUrl = openAiCodexOAuthManager.startAuthorizationFlow()
			setCodexAuthUrl(authUrl)
			await openExternal(authUrl)
			const completed = await Promise.race([
				openAiCodexOAuthManager.waitForCallback().then(() => true),
				new Promise<false>((resolve) => {
					cancelCodexAuthWaitRef.current = () => resolve(false)
				}),
			])
			cancelCodexAuthWaitRef.current = null
			if (!completed) return
			openAiCodexUsageService.clear()
			await applyProviderConfig({ providerId: "openai-codex", controller })
			setProvider("openai-codex")
			refreshModelIds()
			setIsWaitingForCodexAuth(false)
			setCodexAuthUrl(null)
		} catch (error) {
			cancelCodexAuthWaitRef.current = null
			openAiCodexOAuthManager.cancelAuthorizationFlow()
			setCodexAuthError(error instanceof Error ? error.message : String(error))
			setIsWaitingForCodexAuth(false)
			setCodexAuthUrl(null)
		}
	}, [controller, setIsWaitingForCodexAuth, setCodexAuthError, setCodexAuthUrl, setProvider, refreshModelIds])

	const cancelCodexAuth = useCallback(() => {
		openAiCodexOAuthManager.cancelAuthorizationFlow()
		cancelCodexAuthWaitRef.current?.()
		cancelCodexAuthWaitRef.current = null
		setIsWaitingForCodexAuth(false)
		setCodexAuthUrl(null)
	}, [setCodexAuthUrl, setIsWaitingForCodexAuth])

	const startGithubAuth = useCallback(async () => {
		const abortController = new AbortController()
		githubAuthAbortControllerRef.current?.abort()
		githubAuthAbortControllerRef.current = abortController
		try {
			setIsWaitingForGithubAuth(true)
			const data = await githubCopilotAuthManager.initiateDeviceFlow()
			setGithubAuthData(data)
			await openExternal(data.verification_uri)
			await githubCopilotAuthManager.pollForToken(data.device_code, data.interval, abortController.signal)
			if (abortController.signal.aborted) return
			await applyProviderConfig({ providerId: "github-copilot", controller })
			setProvider("github-copilot")
			refreshModelIds()
			setIsWaitingForGithubAuth(false)
			setGithubAuthData(null)
		} catch (error) {
			if (abortController.signal.aborted) return
			setIsWaitingForGithubAuth(false)
			setGithubAuthData(null)
			Logger.error("[github-copilot-auth] Auth failed:", error)
			throw error
		} finally {
			if (githubAuthAbortControllerRef.current === abortController) {
				githubAuthAbortControllerRef.current = null
			}
		}
	}, [controller, setIsWaitingForGithubAuth, setGithubAuthData, setProvider, refreshModelIds])

	const cancelGithubAuth = useCallback(() => {
		githubAuthAbortControllerRef.current?.abort()
		githubAuthAbortControllerRef.current = null
		setIsWaitingForGithubAuth(false)
		setGithubAuthData(null)
	}, [setGithubAuthData, setIsWaitingForGithubAuth])

	const handleAction = useCallback(async () => {
		const item = items[selectedIndex]
		if (
			!item ||
			item.type === SettingsItemType.READONLY ||
			item.type === SettingsItemType.SEPARATOR ||
			item.type === SettingsItemType.HEADER ||
			item.type === SettingsItemType.SPACER
		)
			return

		if (item.key === "utilityModelEnabled") {
			const newValue = !utilityModelEnabled
			setUtilityModelEnabled(newValue)
			stateManager.setGlobalState("utilityModelEnabled", newValue)
			await stateManager.flushPendingState()
			await controller?.postStateToWebview()
			return
		}


		if (item.type === SettingsItemType.ACTION) {
			if (item.key === "utilityModelSelection" && utilityModelEnabled) {
				setIsPickingUtilityModel(true)
				return
			}

			if (item.key === "codexSignOut") {
				await openAiCodexOAuthManager.clearCredentials()
				openAiCodexUsageService.clear()
				await rebuildTaskApi()
				return
			}
			if (item.key === "githubSignOut") {
				await githubCopilotAuthManager.clearCredentials()
				await rebuildTaskApi()
				return
			}
			if (item.key === "githubSignIn") {
				await startGithubAuth()
				return
			}
			return
		}

		if (item.type === SettingsItemType.OBJECT) {
			setObjectEditor({
				source: "global",
				key: item.key,
				path: [],
				value: item.value as Record<string, unknown>,
				selectedIndex: 0,
				isEditingValue: false,
				isAddingKey: false,
				editValue: "",
			})
			return
		}

		if (item.type === SettingsItemType.CYCLE) {
			if (item.key === "openRouterProviderSorting") {
				const sortingOptions = [undefined, "price", "throughput", "latency"]
				const currentIndex = sortingOptions.indexOf(openRouterProviderSorting)
				const nextSorting = sortingOptions[(currentIndex + 1) % sortingOptions.length]
				setOpenRouterProviderSorting(nextSorting)
				stateManager.setGlobalState("openRouterProviderSorting", nextSorting)
				await rebuildTaskApi()
				return
			}
			const targetMode = item.key === "actReasoningEffort" ? "act" : item.key === "planReasoningEffort" ? "plan" : undefined
			if (targetMode) {
				const currentEffort = targetMode === "act" ? actReasoningEffort : planReasoningEffort
				await setReasoningEffortForMode(targetMode, nextReasoningEffort(currentEffort))
			}
			return
		}

		if (item.type === SettingsItemType.EDITABLE) {
			if (item.key === "actOpenRouterProviders" || item.key === "planOpenRouterProviders") {
				const modelId = item.key === "actOpenRouterProviders" ? actModelId : planModelId
				if (modelId) setOpenRouterRoutingModelId(modelId)
				return
			}
			if (item.key === "provider") {
				setIsPickingProvider(true)
				return
			}
			if ((item.key === "actModelId" || item.key === "planModelId") && hasModelPicker(provider)) {
				setPickingModelKey(item.key as "actModelId" | "planModelId")
				setIsPickingModel(true)
				return
			}
			if (item.key === "language") {
				setIsPickingLanguage(true)
				return
			}
			setEditValue(typeof item.value === "string" ? item.value : "")
			setIsEditing(true)
			return
		}

		// Checkbox handling
		const newValue = !item.value

		if (item.key === "lightTerminalTheme") {
			setLightTerminalTheme(newValue)
			stateManager.setGlobalState("cliTerminalColorMode", newValue ? "light" : "dark")
			await stateManager.flushPendingState()
			return
		}

		if (item.key in FEATURE_SETTINGS) {
			await toggleFeature(item.key as FeatureKey)
			return
		}

		// Tool toggle handling
		const isTool = availableTools.some((t) => t.id === item.key)
		if (isTool) {
			const toolId = item.key
			ToolRegistry.getInstance().toggleAndPersist(toolId, newValue)
			setToolToggles((prev) => ({ ...prev, [toolId]: newValue }))
			await rebuildTaskApi()
			return
		}

		if (item.key === "separateModels") {
			setSeparateModels(newValue)
			stateManager.setGlobalState("planActSeparateModelsSetting", newValue)
			if (!newValue) {
				const apiConfig = stateManager.getApiConfiguration()
				const actProvider = apiConfig.actModeApiProvider
				const planProvider = apiConfig.planModeApiProvider || actProvider
				if (actProvider) {
					const actKey = getProviderModelIdKey(actProvider, "act")
					const planKey = planProvider ? getProviderModelIdKey(planProvider, "plan") : null
					const actModel = stateManager.getGlobalSettingsKey(actKey)
					if (planKey) stateManager.setGlobalState(planKey, actModel)
				}
				const actThinkingBudget = stateManager.getGlobalSettingsKey("actModeThinkingBudgetTokens") ?? 0
				stateManager.setGlobalState("planModeThinkingBudgetTokens", actThinkingBudget)
				setPlanThinkingEnabled(actThinkingBudget > 0)

				const actEffort = normalizeReasoningEffort(stateManager.getGlobalSettingsKey("actModeReasoningEffort"))
				stateManager.setGlobalState("planModeReasoningEffort", actEffort)
				setPlanReasoningEffort(actEffort)
			}
			await rebuildTaskApi()
			return
		}

		if (item.key === "actThinkingEnabled") {
			setActThinkingEnabled(newValue)
			stateManager.setGlobalState("actModeThinkingBudgetTokens", newValue ? 1024 : 0)
			if (!separateModels) {
				setPlanThinkingEnabled(newValue)
				stateManager.setGlobalState("planModeThinkingBudgetTokens", newValue ? 1024 : 0)
			}
			await rebuildTaskApi()
			return
		}

		if (item.key === "planThinkingEnabled") {
			setPlanThinkingEnabled(newValue)
			stateManager.setGlobalState("planModeThinkingBudgetTokens", newValue ? 1024 : 0)
			await rebuildTaskApi()
			return
		}

		if (item.key === "openRouterPreventFallbacks") {
			setOpenRouterPreventFallbacks(newValue)
			stateManager.setGlobalState("openRouterPreventFallbacks", newValue || undefined)
			await rebuildTaskApi()
			return
		}

		if (item.key === "telemetry") {
			const newTelemetry: TelemetrySetting = newValue ? "enabled" : "disabled"
			setTelemetry(newTelemetry)
			stateManager.setGlobalState("telemetrySetting", newTelemetry)
			await stateManager.flushPendingState()
			await controller?.updateTelemetrySetting(newTelemetry)
			return
		}

		if (item.key === "enableNotifications") {
			const newSettings = {
				...autoApproveSettings,
				version: (autoApproveSettings.version ?? 1) + 1,
				enableNotifications: newValue,
			}
			setAutoApproveSettings(newSettings)
			stateManager.setGlobalState("autoApprovalSettings", newSettings)
			await rebuildTaskApi()
			return
		}

		const actionKey = item.key as keyof AutoApprovalSettings["actions"]
		const newActions = { ...autoApproveSettings.actions, [actionKey]: newValue }
		if (!newValue) {
			if (actionKey === "readFiles") newActions.readFilesExternally = false
			if (actionKey === "editFiles") newActions.editFilesExternally = false
		}
		if (newValue && item.parentKey) {
			newActions[item.parentKey as keyof typeof newActions] = true
		}
		const newSettings = { ...autoApproveSettings, version: (autoApproveSettings.version ?? 1) + 1, actions: newActions }
		setAutoApproveSettings(newSettings)
		stateManager.setGlobalState("autoApprovalSettings", newSettings)
		await rebuildTaskApi()
	}, [
		items,
		selectedIndex,
		stateManager,
		autoApproveSettings,
		toggleFeature,
		utilityModelEnabled,
		setUtilityModelEnabled,
		separateModels,
		actReasoningEffort,
		planReasoningEffort,
		rebuildTaskApi,
		setReasoningEffortForMode,
		startGithubAuth,
		setObjectEditor,
		setIsPickingProvider,
		setIsPickingModel,
		setPickingModelKey,
		setIsPickingLanguage,
		setIsPickingUtilityModel,
		setEditValue,
		setIsEditing,
		setLightTerminalTheme,
		setSeparateModels,
		setPlanThinkingEnabled,
		setPlanReasoningEffort,
		setActThinkingEnabled,
		setTelemetry,
		setAutoApproveSettings,
		provider,
		actModelId,
		planModelId,
		openRouterProviderSorting,
		setOpenRouterProviderSorting,
		setOpenRouterPreventFallbacks,
		setOpenRouterRoutingModelId,
		availableTools,
	])

	const handleSave = useCallback(
		async (editValue: string) => {
			const item = items[selectedIndex]
			if (!item) return

			switch (item.key) {
				case "baseUrl": {
					await applyProviderConfig({
						providerId: provider,
						baseUrl: editValue,
						controller,
					})
					break
				}
				case "actModelId":
				case "planModelId":
				case "actCustomModelId":
				case "planCustomModelId": {
					const apiConfig = stateManager.getApiConfiguration()
					const actProvider = apiConfig.actModeApiProvider
					const planProvider = apiConfig.planModeApiProvider || actProvider
					if (!actProvider && !planProvider) break
					const actKey = actProvider ? getProviderModelIdKey(actProvider, "act") : null
					const planKey = planProvider ? getProviderModelIdKey(planProvider, "plan") : null

					if (separateModels) {
						const stateKey = item.key === "actModelId" || item.key === "actCustomModelId" ? actKey : planKey
						if (stateKey) stateManager.setGlobalState(stateKey, editValue || undefined)
					} else {
						if (actKey) stateManager.setGlobalState(actKey, editValue || undefined)
						if (planKey) stateManager.setGlobalState(planKey, editValue || undefined)
					}
					break
				}
				case "autoCondenseContextLimit": {
					const limit = Number(editValue)
					if (!isValidAutoCondenseContextLimit(limit)) {
						throw new Error("Auto-condense context limit must be between 1 and 2,000,000,000 tokens")
					}
					setAutoCondenseContextLimit(limit)
					stateManager.setGlobalState("autoCondenseContextLimits", {
						...stateManager.getGlobalSettingsKey("autoCondenseContextLimits"),
						[provider]: limit,
					})
					break
				}
				case "language":
					setPreferredLanguage(editValue)
					stateManager.setGlobalState("preferredLanguage", editValue)
					break
			}

			await rebuildTaskApi()
			refreshModelIds()

			setIsEditing(false)
		},
		[
			items,
			selectedIndex,
			separateModels,
			stateManager,
			setPreferredLanguage,
			setAutoCondenseContextLimit,
			setIsEditing,
			rebuildTaskApi,
			provider,
			controller,
			refreshModelIds,
		],
	)

	const beginOpenRouterModelSelection = useCallback(() => {
		setPendingProvider("openrouter")
		setIsPickingProvider(false)
		setPickingModelKey("actModelId")
		setIsPickingModel(true)
	}, [setIsPickingModel, setIsPickingProvider, setPendingProvider, setPickingModelKey])

	const handleProviderSelect = useCallback(
		async (providerId: string) => {
			const keyField = ProviderToApiKeyMap[providerId as ApiProvider]
			const apiConfig = stateManager.getApiConfiguration()
			const fieldName = keyField ? (Array.isArray(keyField) ? keyField[0] : keyField) : null
			const existingKey = fieldName ? (apiConfig as Record<string, string>)[fieldName] || "" : ""

			const requiresOpenRouterModelSelection =
				providerId === "openrouter" && !apiConfig.actModeOpenRouterModelId && !apiConfig.planModeOpenRouterModelId

			if (
				initialMode === "provider-picker" &&
				(existingKey || !keyField) &&
				providerId !== "bedrock" &&
				!requiresOpenRouterModelSelection
			) {
				let canSwitchDirectly = true
				if (providerId === "openai-codex") {
					canSwitchDirectly = await openAiCodexOAuthManager.isAuthenticated()
				} else if (providerId === "github-copilot") {
					canSwitchDirectly = await githubCopilotAuthManager.isAuthenticated()
				}
				if (canSwitchDirectly) {
					await applyProviderConfig({ providerId, controller })
					setProvider(providerId)
					refreshModelIds()
					setIsPickingProvider(false)
					onClose()
					return
				}
			}

			if (providerId === "bedrock") {
				const isConfigured = !!(
					apiConfig.awsRegion &&
					(apiConfig.awsUseProfile || (apiConfig.awsAccessKey && apiConfig.awsSecretKey))
				)
				if (initialMode === "provider-picker" && isConfigured) {
					await applyProviderConfig({ providerId, controller })
					setProvider(providerId)
					refreshModelIds()
					setIsPickingProvider(false)
					onClose()
					return
				}
				setPendingProvider(providerId)
				setIsPickingProvider(false)
				setIsConfiguringBedrock(true)
				return
			}

			if (providerId === "github-copilot") {
				setIsPickingProvider(false)
				const isAuthenticated = await githubCopilotAuthManager.isAuthenticated()
				if (!isAuthenticated) {
					await startGithubAuth()
				} else {
					await applyProviderConfig({ providerId, controller })
					setProvider(providerId)
					refreshModelIds()
				}
				return
			}

			if (providerId === "openai-codex") {
				setIsPickingProvider(false)
				await startCodexAuth()
				return
			}

			if (requiresOpenRouterModelSelection && existingKey) {
				beginOpenRouterModelSelection()
				return
			}

			if (keyField) {
				setPendingProvider(providerId)
				setApiKeyValue(existingKey)
				setIsPickingProvider(false)
				setIsEnteringApiKey(true)
			} else {
				await applyProviderConfig({ providerId, controller })
				setProvider(providerId)
				refreshModelIds()
				setIsPickingProvider(false)
			}
		},
		[
			stateManager,
			startCodexAuth,
			controller,
			refreshModelIds,
			initialMode,
			onClose,
			setProvider,
			setIsPickingProvider,
			setIsConfiguringBedrock,
			setPendingProvider,
			startGithubAuth,
			setApiKeyValue,
			setIsEnteringApiKey,
			beginOpenRouterModelSelection,
		],
	)

	const handleModelSelect = useCallback(
		async (modelId: string) => {
			if (!pickingModelKey) return
			if (modelId === CUSTOM_MODEL_ID) {
				if (provider === "bedrock") {
					setIsPickingModel(false)
					setIsBedrockCustomFlow(true)
					return
				}
				if (usesOpenRouterModels(pendingProvider || provider)) {
					// For OpenRouter, selecting "Custom" just sets the model ID to __custom__
					// which triggers the third line to appear in the settings list.
				}
			}

			if (pendingProvider === "openrouter") {
				await applyProviderConfig({ providerId: pendingProvider, modelId, controller })
				setProvider(pendingProvider)
				setPendingProvider(null)
				refreshModelIds()
				setIsPickingModel(false)
				setPickingModelKey(null)
				if (initialMode) onClose()
				return
			}

			const apiConfig = stateManager.getApiConfiguration()
			const actProvider = apiConfig.actModeApiProvider
			const planProvider = apiConfig.planModeApiProvider || actProvider
			const providerForSelection = separateModels
				? pickingModelKey === "actModelId"
					? actProvider
					: planProvider
				: actProvider || planProvider
			if (!providerForSelection) return

			const actKey = actProvider ? getProviderModelIdKey(actProvider, "act") : null
			const planKey = planProvider ? getProviderModelIdKey(planProvider, "plan") : null

			let modelInfo: ModelInfo | undefined
			if (providerForSelection === "openrouter") {
				const openRouterModels = await controller?.readOpenRouterModels()
				modelInfo = openRouterModels?.[modelId]
			}

			if (separateModels) {
				const stateKey = pickingModelKey === "actModelId" ? actKey : planKey
				if (stateKey) stateManager.setGlobalState(stateKey, modelId)
				if (modelInfo) {
					const infoKey =
						pickingModelKey === "actModelId" ? "actModeOpenRouterModelInfo" : "planModeOpenRouterModelInfo"
					stateManager.setGlobalState(infoKey, modelInfo)
				}
			} else {
				if (actKey) stateManager.setGlobalState(actKey, modelId)
				if (planKey) stateManager.setGlobalState(planKey, modelId)
				if (modelInfo) {
					stateManager.setGlobalState("actModeOpenRouterModelInfo", modelInfo)
					stateManager.setGlobalState("planModeOpenRouterModelInfo", modelInfo)
				}
			}

			await stateManager.flushPendingState()
			await rebuildTaskApi()
			refreshModelIds()
			setIsPickingModel(false)
			setPickingModelKey(null)
			if (initialMode) onClose()
		},
		[
			pickingModelKey,
			pendingProvider,
			separateModels,
			stateManager,
			controller,
			provider,
			refreshModelIds,
			initialMode,
			onClose,
			setIsPickingModel,
			setIsBedrockCustomFlow,
			setPickingModelKey,
			setPendingProvider,
			setProvider,
			rebuildTaskApi,
		],
	)

	const handleApiKeySubmit = useCallback(
		async (submittedValue: string) => {
			if (!pendingProvider || !submittedValue.trim()) return

			const apiConfig = stateManager.getApiConfiguration()
			const requiresOpenRouterModelSelection =
				pendingProvider === "openrouter" && !apiConfig.actModeOpenRouterModelId && !apiConfig.planModeOpenRouterModelId
			if (requiresOpenRouterModelSelection) {
				stateManager.setApiConfiguration({ openRouterApiKey: submittedValue.trim() })
				await stateManager.flushPendingState()
				setIsEnteringApiKey(false)
				setApiKeyValue("")
				beginOpenRouterModelSelection()
				return
			}

			await applyProviderConfig({ providerId: pendingProvider, apiKey: submittedValue.trim(), controller })
			setProvider(pendingProvider)
			refreshModelIds()
			setIsEnteringApiKey(false)
			setPendingProvider(null)
			setApiKeyValue("")
			if (initialMode) onClose()
		},
		[
			pendingProvider,
			stateManager,
			controller,
			refreshModelIds,
			initialMode,
			onClose,
			beginOpenRouterModelSelection,
			setProvider,
			setIsEnteringApiKey,
			setPendingProvider,
			setApiKeyValue,
		],
	)

	const handleBedrockComplete = useCallback(
		async (bedrockConfig: BedrockConfig) => {
			await applyBedrockConfig({ bedrockConfig, controller })
			setProvider("bedrock")
			refreshModelIds()
			setIsConfiguringBedrock(false)
			setPendingProvider(null)
			if (initialMode) onClose()
		},
		[controller, refreshModelIds, initialMode, onClose, setProvider, setIsConfiguringBedrock, setPendingProvider],
	)

	const handleBedrockCustomFlowComplete = useCallback(
		async (arn: string, baseModelId: string) => {
			if (!pickingModelKey) return
			const apiConfig = stateManager.getApiConfiguration()
			const bedrockConfig: BedrockConfig = {
				awsRegion: apiConfig.awsRegion ?? "us-east-1",
				awsAuthentication: apiConfig.awsUseProfile ? "profile" : "credentials",
				awsUseCrossRegionInference: Boolean(apiConfig.awsUseCrossRegionInference),
			}
			await applyBedrockConfig({ bedrockConfig, modelId: arn, customModelBaseId: baseModelId, controller })
			await stateManager.flushPendingState()
			await rebuildTaskApi()
			refreshModelIds()
			setIsBedrockCustomFlow(false)
			setPickingModelKey(null)
			if (initialMode) onClose()
		},
		[
			pickingModelKey,
			stateManager,
			controller,
			rebuildTaskApi,
			refreshModelIds,
			initialMode,
			onClose,
			setIsBedrockCustomFlow,
			setPickingModelKey,
		],
	)

	const handleLanguageSelect = useCallback(
		async (language: string) => {
			setPreferredLanguage(language)
			stateManager.setGlobalState("preferredLanguage", language)
			setIsPickingLanguage(false)

			await rebuildTaskApi()
		},
		[stateManager, setPreferredLanguage, setIsPickingLanguage, rebuildTaskApi],
	)

	const navigateItems = useCallback(
		(direction: SettingsNavigationDirection) => {
			setSelectedIndex((currentIndex) => getNextSelectableSettingsIndex(items, currentIndex, direction))
		},
		[items, setSelectedIndex],
	)

	return {
		handleAction,
		handleSave,
		handleProviderSelect,
		handleModelSelect,
		handleApiKeySubmit,
		handleBedrockComplete,
		handleBedrockCustomFlowComplete,
		handleLanguageSelect,
		startCodexAuth,
		startGithubAuth,
		cancelCodexAuth,
		cancelGithubAuth,
		navigateItems,
		toggleFeature,
		handleUtilityModelPresetSelect,
		setReasoningEffortForMode,
	}
}
