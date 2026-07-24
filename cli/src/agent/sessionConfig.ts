import type * as acp from "@agentclientprotocol/sdk"
import { ApiConfigurationError, ApiConfigurationErrorCode } from "@core/api"
import type { ApiProvider } from "@shared/api"
import { getProviderModelIdKey, getProviderModelInfoKey } from "@shared/storage/provider-keys"
import type { Settings } from "@shared/storage/state-keys"
import { refreshGithubCopilotModels } from "@/core/controller/models/refreshGithubCopilotModels"
import { Logger } from "@/shared/services/Logger"
import type { Mode } from "@/shared/storage/types"
import { filterOpenRouterModelIds } from "@/shared/utils/model-filters"
import { getDefaultModelId, getModelList, hasStaticModels } from "../utils/model-metadata.js"
import { fetchOpenRouterModels, usesOpenRouterModels } from "../utils/openrouter-models"
import { getProviderLabel, getValidCliProviders, isValidCliProvider } from "../utils/providers.js"
import type { ProviderConfigurationManager } from "./providerConfiguration.js"
import type { DiracAcpSession } from "./public-types.js"

/**
 * ACP-level mode IDs surfaced to clients.
 *
 * The two extra modes beyond Dirac's internal {@link Mode} are derived states:
 *   - `auto`  → internal `act` mode with auto-approve on
 *   - `yolo`  → internal `act` mode with auto-approve + yolo on
 *
 * Clients see four modes; internally the mode/auto-approve/yolo toggles are
 * still three separate state keys.
 */
export type AcpModeId = "plan" | "act" | "auto" | "yolo"

const ACP_MODE_OPTIONS: { value: AcpModeId; name: string; description: string }[] = [
	{ value: "plan", name: "Plan", description: "Gather information and create a detailed plan" },
	{ value: "act", name: "Act", description: "Execute actions, asking permission for each tool call" },
	{ value: "auto", name: "Auto-approve", description: "Execute actions, auto-approving all tool calls" },
	{ value: "yolo", name: "YOLO", description: "Execute actions with no safety prompts" },
]

export function acpModeToInternalState(acpMode: AcpModeId): { mode: Mode; autoApprove: boolean; yolo: boolean } {
	switch (acpMode) {
		case "plan":
			return { mode: "plan", autoApprove: false, yolo: false }
		case "act":
			return { mode: "act", autoApprove: false, yolo: false }
		case "auto":
			return { mode: "act", autoApprove: true, yolo: false }
		case "yolo":
			return { mode: "act", autoApprove: true, yolo: true }
	}
}

export function computeAcpModeId(mode: Mode, autoApprove: boolean, yolo: boolean): AcpModeId {
	if (mode === "plan") return "plan"
	if (yolo) return "yolo"
	if (autoApprove) return "auto"
	return "act"
}

const REASONING_EFFORT_OPTIONS: acp.SessionConfigSelectOption[] = [
	{ value: "none", name: "None" },
	{ value: "low", name: "Low" },
	{ value: "medium", name: "Medium" },
	{ value: "high", name: "High" },
	{ value: "xhigh", name: "Extra high" },
]

const THINKING_BUDGET_OPTIONS: acp.SessionConfigSelectOption[] = [
	{ value: "0", name: "Off" },
	{ value: "1024", name: "1,024 tokens" },
	{ value: "4096", name: "4,096 tokens" },
	{ value: "8192", name: "8,192 tokens" },
	{ value: "16384", name: "16,384 tokens" },
	{ value: "32768", name: "32,768 tokens" },
]

export class SessionConfigManager {
	constructor(private readonly providerConfiguration?: ProviderConfigurationManager) { }

	/**
	 * Compute the effective ACP mode ID for a session, considering per-session overrides.
	 */
	computeCurrentAcpModeId(mode: Mode, sessionOverrides: Partial<Settings>): AcpModeId {
		const autoApprove = Boolean(sessionOverrides.autoApproveAllToggled)
		const yolo = Boolean(sessionOverrides.yoloModeToggled)
		return computeAcpModeId(mode, autoApprove, yolo)
	}

	getSessionModeState(mode: Mode, sessionOverrides: Partial<Settings>): acp.SessionModeState {
		return {
			availableModes: ACP_MODE_OPTIONS.map(({ value, name, description }) => ({
				id: value,
				name,
				description,
			})),
			currentModeId: this.computeCurrentAcpModeId(mode, sessionOverrides),
		}
	}

	async getSessionConfigOptions(
		session: DiracAcpSession,
		sessionOverrides: Partial<Settings>,
	): Promise<acp.SessionConfigOption[]> {
		const providerKey = session.mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = sessionOverrides[providerKey] as ApiProvider | undefined
		const currentModelId = await this.getCurrentModeModelId(session.mode, currentProvider, sessionOverrides)
		const thinkingKey = session.mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
		const thinkingBudget = String(sessionOverrides[thinkingKey] ?? 0)
		const reasoningKey = session.mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"
		const reasoningEffort = String(sessionOverrides[reasoningKey] ?? "medium")

		const providerOptions = getValidCliProviders().map((provider) => ({
			value: provider,
			name: getProviderLabel(provider),
		}))
		const providerOptionsWithCurrent = currentProvider
			? this.withCurrentSelectOption(providerOptions, currentProvider, getProviderLabel(currentProvider))
			: providerOptions

		return [
			{
				id: "mode",
				name: "Mode",
				description: "Session operating mode",
				type: "select",
				category: "mode",
				currentValue: this.computeCurrentAcpModeId(session.mode, sessionOverrides),
				options: ACP_MODE_OPTIONS,
			},
			{
				id: "provider",
				name: "Provider",
				description: "API provider",
				type: "select",
				category: "_provider",
				currentValue: currentProvider || "",
				options: providerOptionsWithCurrent,
			},
			{
				id: "model",
				name: "Model",
				description: "Model for the current mode",
				type: "select",
				category: "model",
				currentValue: currentModelId || "",
				options: await this.getModelConfigOptions(currentProvider, currentModelId),
			},
			{
				id: "reasoning_effort",
				name: "Reasoning Effort",
				description: "Reasoning effort for models that support it",
				type: "select",
				category: "thought_level",
				currentValue: reasoningEffort,
				options: REASONING_EFFORT_OPTIONS,
			},
			{
				id: "thinking_budget",
				name: "Thinking Budget",
				description: "Extended thinking budget for models that support it",
				type: "select",
				category: "thought_level",
				currentValue: thinkingBudget,
				options: this.withCurrentSelectOption(THINKING_BUDGET_OPTIONS, thinkingBudget, `${thinkingBudget} tokens`),
			},
		]
	}

	async applyProviderConfigOption(
		session: DiracAcpSession,
		providerValue: string,
		sessionOverrides: Partial<Settings>,
	): Promise<void> {
		if (!isValidCliProvider(providerValue)) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProviderUnsupported,
				`Provider ${providerValue} is unavailable`,
				"Select one of the available providers before retrying.",
			)
		}

		this.providerConfiguration?.assertProviderEnabled(providerValue as ApiProvider)

		const provider = providerValue as ApiProvider
		const currentModelId = await this.getCurrentModeModelId(session.mode, provider, sessionOverrides)
		this.assertModelAvailable(provider, currentModelId)
		await this.applyProviderAndModel(session, provider, currentModelId, sessionOverrides)
	}

	async applyModelConfigOption(
		session: DiracAcpSession,
		modelValue: string,
		sessionOverrides: Partial<Settings>,
	): Promise<void> {
		const providerKey = session.mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const provider = sessionOverrides[providerKey] as ApiProvider | undefined

		if (!provider) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProviderMissing,
				"Cannot set model before a provider is selected",
				"Select a provider before choosing a model.",
			)
		}

		this.providerConfiguration?.assertProviderEnabled(provider)
		this.assertModelAvailable(provider, modelValue)
		await this.applyProviderAndModel(session, provider, modelValue, sessionOverrides)
	}

	applyReasoningEffortConfigOption(session: DiracAcpSession, effort: string, sessionOverrides: Partial<Settings>): void {
		if (!REASONING_EFFORT_OPTIONS.some((option) => option.value === effort)) {
			throw new Error(`Invalid reasoning effort: ${effort}`)
		}

		this.setModeScopedSessionState(session.mode, sessionOverrides, (mode) => {
			const key = mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"
				; (sessionOverrides as Record<string, unknown>)[key] = effort
		})
	}

	applyThinkingBudgetConfigOption(session: DiracAcpSession, budgetValue: string, sessionOverrides: Partial<Settings>): void {
		const budget = Number.parseInt(budgetValue, 10)
		if (Number.isNaN(budget) || budget < 0) {
			throw new Error(`Invalid thinking budget: ${budgetValue}`)
		}

		this.setModeScopedSessionState(session.mode, sessionOverrides, (mode) => {
			const key = mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
				; (sessionOverrides as Record<string, unknown>)[key] = budget
		})
	}

	async applyProviderAndModel(
		session: DiracAcpSession,
		provider: ApiProvider,
		modelId: string,
		sessionOverrides: Partial<Settings>,
	): Promise<void> {
		this.setModeScopedSessionState(session.mode, sessionOverrides, (mode) => {
			const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
			const modelKey = getProviderModelIdKey(provider, mode)
			const modelInfoKey = getProviderModelInfoKey(provider, mode)
			const overrides = sessionOverrides as Record<string, unknown>
			overrides[providerKey] = provider
			overrides[modelKey] = modelId
			if (modelInfoKey) overrides[modelInfoKey] = undefined
		})
	}

	async getCurrentModeModelId(mode: Mode, provider?: ApiProvider, sessionOverrides?: Partial<Settings>): Promise<string> {
		if (!provider) return ""
		const modelKey = getProviderModelIdKey(provider, mode)
		return (sessionOverrides?.[modelKey] as string | undefined) || getDefaultModelId(provider)
	}

	assertTaskRuntimeAvailable(session: DiracAcpSession, sessionOverrides: Partial<Settings>): void {
		const providerKey = session.mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const provider = sessionOverrides[providerKey] as ApiProvider | undefined
		if (!provider) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProviderMissing,
				"No provider is selected for this ACP session",
				"Select a provider before starting work.",
			)
		}
		if (!isValidCliProvider(provider)) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProviderUnsupported,
				`Provider ${provider} is unavailable`,
				"Select an available provider before starting work.",
			)
		}
		this.providerConfiguration?.assertProviderEnabled(provider)

		const modelKey = getProviderModelIdKey(provider, session.mode)
		const modelId = sessionOverrides[modelKey] as string | undefined
		if (!modelId) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ModelUnavailable,
				`No model is selected for provider ${provider}`,
				"Select an available model before starting work.",
			)
		}
		this.assertModelAvailable(provider, modelId)
	}

	private async getModelConfigOptions(
		provider: ApiProvider | undefined,
		currentModelId: string | undefined,
	): Promise<acp.SessionConfigSelectOption[]> {
		const modelIds = await this.getAvailableModelIds(provider, currentModelId)
		return modelIds.map((modelId) => ({ value: modelId, name: modelId }))
	}

	private async getAvailableModelIds(provider: ApiProvider | undefined, currentModelId: string | undefined): Promise<string[]> {
		if (!provider) {
			return []
		}

		let modelIds: string[] = []
		try {
			if (usesOpenRouterModels(provider)) {
				modelIds = filterOpenRouterModelIds(await fetchOpenRouterModels(), provider)
			} else if (provider === "github-copilot") {
				modelIds = Object.keys(await refreshGithubCopilotModels()).sort((a, b) => a.localeCompare(b))
			} else if (hasStaticModels(provider)) {
				modelIds = getModelList(provider)
			}
		} catch (error) {
			Logger.error(
				`[SessionConfigManager] Could not refresh models for ${provider}; preserving the task's current selection`,
				error,
			)
		}

		if (currentModelId && !modelIds.includes(currentModelId)) {
			modelIds = [currentModelId, ...modelIds]
		}

		return modelIds
	}

	private withCurrentSelectOption(
		options: acp.SessionConfigSelectOption[],
		currentValue: string,
		currentName: string,
	): acp.SessionConfigSelectOption[] {
		if (!currentValue || options.some((option) => option.value === currentValue)) {
			return options
		}
		return [{ value: currentValue, name: currentName }, ...options]
	}

	private assertModelAvailable(provider: ApiProvider, modelId: string): void {
		if (hasStaticModels(provider) && !getModelList(provider).includes(modelId)) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ModelUnavailable,
				`Model ${modelId} is unavailable for provider ${provider}`,
				"Select an available replacement model before retrying.",
			)
		}
	}

	private setModeScopedSessionState(
		currentMode: Mode,
		sessionOverrides: Partial<Settings>,
		setter: (mode: Mode) => void,
	): void {
		setter(currentMode)

		const separateModels = sessionOverrides.planActSeparateModelsSetting ?? false
		if (!separateModels) {
			setter(currentMode === "act" ? "plan" : "act")
		}
	}
}
