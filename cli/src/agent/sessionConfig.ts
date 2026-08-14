import type * as acp from "@agentclientprotocol/sdk"
import { ApiConfigurationError, ApiConfigurationErrorCode, resolveModelIdForProvider } from "@core/api"
import type { ApiConfiguration, ApiProvider } from "@shared/api"
import { getProviderModelIdKey, getProviderModelInfoKey } from "@shared/storage/provider-keys"
import type { Settings } from "@shared/storage/state-keys"
import { refreshGithubCopilotModels } from "@/core/controller/models/refreshGithubCopilotModels"
import { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import {
	DEFAULT_OPENAI_REASONING_EFFORT,
	OPENAI_REASONING_EFFORT_LABELS,
	OPENAI_REASONING_EFFORT_OPTIONS,
	type Mode,
} from "@/shared/storage/types"
import { filterOpenRouterModelIds } from "@/shared/utils/model-filters"
import { getDefaultModelId, getModelList, hasStaticModels } from "../utils/model-metadata.js"
import { fetchOpenRouterModels, usesOpenRouterModels } from "../utils/openrouter-models"
import { getProviderLabel, getValidCliProviders, isValidCliProvider } from "../utils/providers.js"
import type { ProviderConfigurationManager } from "./providerConfiguration.js"
import type { DiracAcpSession } from "./public-types.js"

/** ACP operating modes are mutually exclusive; approval qualifiers are separate booleans. */
export type AcpModeId = Mode

const ACP_MODE_OPTIONS: { value: AcpModeId; name: string; description: string }[] = [
	{ value: "plan", name: "Plan", description: "Gather information and create a detailed plan" },
	{ value: "act", name: "Act", description: "Execute actions" },
]

const REASONING_EFFORT_OPTIONS: acp.SessionConfigSelectOption[] = OPENAI_REASONING_EFFORT_OPTIONS.map((value) => ({
	value,
	name: OPENAI_REASONING_EFFORT_LABELS[value],
}))

const THINKING_BUDGET_OPTIONS: acp.SessionConfigSelectOption[] = [
	{ value: "0", name: "Off" },
	{ value: "1024", name: "1,024 tokens" },
	{ value: "4096", name: "4,096 tokens" },
	{ value: "8192", name: "8,192 tokens" },
	{ value: "16384", name: "16,384 tokens" },
	{ value: "32768", name: "32,768 tokens" },
]

export class SessionConfigManager {
	constructor(private readonly providerConfiguration?: ProviderConfigurationManager) {}

	computeCurrentAcpModeId(mode: Mode, sessionOverrides: Partial<Settings>): AcpModeId {
		return sessionOverrides.mode === "plan" || sessionOverrides.mode === "act" ? sessionOverrides.mode : mode
	}

	private getSessionMode(session: DiracAcpSession, sessionOverrides: Partial<Settings>): Mode {
		return this.computeCurrentAcpModeId(session.mode, sessionOverrides)
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

	async normalizeSessionConfig(
		session: DiracAcpSession,
		sessionOverrides: Partial<Settings>,
		modelCandidates: Map<string, Promise<string[]>> = new Map(),
	): Promise<void> {
		const mode = this.getSessionMode(session, sessionOverrides)
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const requestedProvider = sessionOverrides[providerKey] as ApiProvider | undefined
		const providers = requestedProvider
			? [requestedProvider, ...getValidCliProviders().filter((provider) => provider !== requestedProvider)]
			: getValidCliProviders()

		for (const providerValue of providers) {
			if (!isValidCliProvider(providerValue) || !this.isProviderEnabled(providerValue)) continue
			const provider = providerValue as ApiProvider
			const catalog = await this.getProviderModelCatalog(provider, mode, sessionOverrides, [], true, modelCandidates)
			if (catalog.modelIds.length === 0) continue

			const currentModelId = await this.getCurrentModeModelId(mode, provider, sessionOverrides)
			const modelId = catalog.modelIds.includes(currentModelId) ? currentModelId : catalog.defaultModelId
			if (!modelId) continue
			if (requestedProvider === provider && currentModelId === modelId) return

			await this.applyProviderAndModel(session, provider, modelId, sessionOverrides)
			return
		}

		throw new ApiConfigurationError(
			ApiConfigurationErrorCode.ModelUnavailable,
			"No enabled ACP provider has a usable model configuration",
			"Configure an enabled provider with at least one available model before retrying.",
		)
	}

	async getSessionConfigOptions(
		session: DiracAcpSession,
		sessionOverrides: Partial<Settings>,
		modelCandidates: Map<string, Promise<string[]>> = new Map(),
	): Promise<acp.SessionConfigOption[]> {
		await this.normalizeSessionConfig(session, sessionOverrides, modelCandidates)
		const mode = this.getSessionMode(session, sessionOverrides)
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = sessionOverrides[providerKey] as ApiProvider
		const currentCatalog = await this.getProviderModelCatalog(
			currentProvider,
			mode,
			sessionOverrides,
			[],
			true,
			modelCandidates,
		)
		const currentModelId = await this.getCurrentModeModelId(mode, currentProvider, sessionOverrides)
		const thinkingKey = mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
		const thinkingBudget = String(sessionOverrides[thinkingKey] ?? 0)
		const reasoningKey = mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"
		const reasoningEffort = String(sessionOverrides[reasoningKey] ?? DEFAULT_OPENAI_REASONING_EFFORT)
		const providerOptions = await this.getProviderOptions(mode, sessionOverrides, modelCandidates)

		return [
			{
				id: "mode",
				name: "Mode",
				description: "Session operating mode",
				type: "select",
				category: "mode",
				currentValue: mode,
				options: ACP_MODE_OPTIONS,
			},
			{
				id: "auto_approve",
				name: "Auto-approve",
				description: "Automatically approve actions when YOLO is disabled",
				type: "boolean",
				category: "mode",
				currentValue: Boolean(sessionOverrides.autoApproveAllToggled),
			},
			{
				id: "yolo",
				name: "YOLO",
				description: "Bypass approval and safety prompts; takes priority over auto-approve",
				type: "boolean",
				category: "mode",
				currentValue: Boolean(sessionOverrides.yoloModeToggled),
			},
			{
				id: "provider",
				name: "Provider",
				description: "API provider",
				type: "select",
				category: "_provider",
				currentValue: currentProvider,
				options: providerOptions,
			},
			{
				id: "model",
				name: "Model",
				description: "Model for the current mode",
				type: "select",
				category: "model",
				currentValue: currentModelId,
				options: currentCatalog.modelIds.map((modelId) => ({ value: modelId, name: modelId })),
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
	): Promise<acp.SessionConfigOption[]> {
		if (!isValidCliProvider(providerValue)) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProviderUnsupported,
				`Provider ${providerValue} is unavailable`,
				"Select one of the available providers before retrying.",
			)
		}

		const provider = providerValue as ApiProvider
		this.providerConfiguration?.assertProviderEnabled(provider)
		const mode = this.getSessionMode(session, sessionOverrides)
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = sessionOverrides[providerKey] as ApiProvider | undefined
		const currentModelId = await this.getCurrentModeModelId(mode, currentProvider, sessionOverrides)
		const modelCandidates = new Map<string, Promise<string[]>>()
		const catalog = await this.getProviderModelCatalog(provider, mode, sessionOverrides, [], true, modelCandidates)
		if (catalog.modelIds.length === 0 || !catalog.defaultModelId) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ModelUnavailable,
				`Provider ${provider} has no usable models`,
				"Configure a model for this provider before retrying.",
			)
		}

		const modelId = catalog.modelIds.includes(currentModelId) ? currentModelId : catalog.defaultModelId
		await this.applyProviderAndModel(session, provider, modelId, sessionOverrides)
		return this.getSessionConfigOptions(session, sessionOverrides, modelCandidates)
	}

	async applyModelConfigOption(
		session: DiracAcpSession,
		modelValue: string,
		sessionOverrides: Partial<Settings>,
	): Promise<acp.SessionConfigOption[]> {
		const mode = this.getSessionMode(session, sessionOverrides)
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const provider = sessionOverrides[providerKey] as ApiProvider | undefined
		if (!provider) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.ProviderMissing,
				"Cannot set model before a provider is selected",
				"Select a provider before choosing a model.",
			)
		}

		this.providerConfiguration?.assertProviderEnabled(provider)
		const modelCandidates = new Map<string, Promise<string[]>>()
		const catalog = await this.getProviderModelCatalog(provider, mode, sessionOverrides, [], true, modelCandidates)
		this.assertModelAvailable(provider, modelValue, catalog.modelIds)
		await this.applyProviderAndModel(session, provider, modelValue, sessionOverrides)
		return this.getSessionConfigOptions(session, sessionOverrides, modelCandidates)
	}

	applyReasoningEffortConfigOption(session: DiracAcpSession, effort: string, sessionOverrides: Partial<Settings>): void {
		if (!REASONING_EFFORT_OPTIONS.some((option) => option.value === effort)) {
			throw new Error(`Invalid reasoning effort: ${effort}`)
		}

		this.setModeScopedSessionState(this.getSessionMode(session, sessionOverrides), sessionOverrides, (mode) => {
			const key = mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"
			;(sessionOverrides as Record<string, unknown>)[key] = effort
		})
	}

	applyThinkingBudgetConfigOption(session: DiracAcpSession, budgetValue: string, sessionOverrides: Partial<Settings>): void {
		const budget = Number.parseInt(budgetValue, 10)
		if (Number.isNaN(budget) || budget < 0) {
			throw new Error(`Invalid thinking budget: ${budgetValue}`)
		}

		this.setModeScopedSessionState(this.getSessionMode(session, sessionOverrides), sessionOverrides, (mode) => {
			const key = mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
			;(sessionOverrides as Record<string, unknown>)[key] = budget
		})
	}

	async applyProviderAndModel(
		session: DiracAcpSession,
		provider: ApiProvider,
		modelId: string,
		sessionOverrides: Partial<Settings>,
	): Promise<void> {
		this.setModeScopedSessionState(this.getSessionMode(session, sessionOverrides), sessionOverrides, (mode) => {
			const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
			const modelKey = getProviderModelIdKey(provider, mode)
			const modelInfoKey = getProviderModelInfoKey(provider, mode)
			const customSelectedKey = mode === "act" ? "actModeAwsBedrockCustomSelected" : "planModeAwsBedrockCustomSelected"
			const customBaseModelKey =
				mode === "act" ? "actModeAwsBedrockCustomModelBaseId" : "planModeAwsBedrockCustomModelBaseId"
			const overrides = sessionOverrides as Record<string, unknown>
			const preserveCustomBedrockModel =
				provider === "bedrock" &&
				overrides[providerKey] === "bedrock" &&
				overrides[modelKey] === modelId &&
				overrides[customSelectedKey] === true

			overrides[providerKey] = provider
			overrides[modelKey] = modelId
			if (modelInfoKey) overrides[modelInfoKey] = undefined
			if (provider === "bedrock" && !preserveCustomBedrockModel) {
				overrides[customSelectedKey] = false
				overrides[customBaseModelKey] = undefined
			}
		})
	}

	async getCurrentModeModelId(mode: Mode, provider?: ApiProvider, sessionOverrides?: Partial<Settings>): Promise<string> {
		if (!provider) return ""
		const modelKey = getProviderModelIdKey(provider, mode)
		return (sessionOverrides?.[modelKey] as string | undefined) || getDefaultModelId(provider)
	}

	async assertTaskRuntimeAvailable(session: DiracAcpSession, sessionOverrides: Partial<Settings>): Promise<void> {
		const mode = this.getSessionMode(session, sessionOverrides)
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
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

		const modelId = await this.getCurrentModeModelId(mode, provider, sessionOverrides)
		const catalog = await this.getProviderModelCatalog(provider, mode, sessionOverrides)
		this.assertModelAvailable(provider, modelId, catalog.modelIds)
	}

	private async getProviderOptions(
		mode: Mode,
		sessionOverrides: Partial<Settings>,
		modelCandidates: Map<string, Promise<string[]>>,
	): Promise<acp.SessionConfigSelectOption[]> {
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const activeProvider = sessionOverrides[providerKey] as ApiProvider | undefined
		const catalogs = await Promise.all(
			getValidCliProviders().map(async (providerValue) => {
				if (!this.isProviderEnabled(providerValue)) return undefined
				const provider = providerValue as ApiProvider
				if (usesOpenRouterModels(provider)) return provider
				const catalog = await this.getProviderModelCatalog(
					provider,
					mode,
					sessionOverrides,
					[],
					provider === activeProvider,
					modelCandidates,
				)
				return catalog.modelIds.length > 0 ? provider : undefined
			}),
		)
		return catalogs
			.filter((provider): provider is ApiProvider => provider !== undefined)
			.map((provider) => ({ value: provider, name: getProviderLabel(provider) }))
	}

	private async getProviderModelCatalog(
		provider: ApiProvider,
		mode: Mode,
		sessionOverrides: Partial<Settings>,
		extraCandidates: string[] = [],
		refreshDynamicCatalog = true,
		modelCandidates: Map<string, Promise<string[]>> = new Map(),
	): Promise<{ modelIds: string[]; defaultModelId: string }> {
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const selectedProvider = sessionOverrides[providerKey] as ApiProvider | undefined
		const modelKey = getProviderModelIdKey(provider, mode)
		const usesProviderSpecificModel = modelKey !== `${mode}ModeApiModelId`
		const configuredModelId =
			selectedProvider === provider || usesProviderSpecificModel
				? await this.getCurrentModeModelId(mode, provider, sessionOverrides)
				: ""
		const candidates = [...(await this.getProviderModelCandidates(provider, refreshDynamicCatalog, modelCandidates))]
		const declaredDefault = getDefaultModelId(provider)
		for (const modelId of [configuredModelId, declaredDefault, ...extraCandidates]) {
			if (modelId && !candidates.includes(modelId)) candidates.push(modelId)
		}

		const configuration = this.getInferenceConfiguration(sessionOverrides)
		const modelIds = candidates.filter((modelId) => this.isModelAcceptedByInference(configuration, provider, modelId, mode))
		const resolvedDefault = declaredDefault
			? this.resolveInferenceModelId(configuration, provider, declaredDefault, mode)
			: undefined
		const defaultModelId =
			(resolvedDefault && modelIds.includes(resolvedDefault) ? resolvedDefault : undefined) ||
			(modelIds.includes(configuredModelId) ? configuredModelId : undefined) ||
			modelIds[0] ||
			""
		return { modelIds, defaultModelId }
	}

	private async getProviderModelCandidates(
		provider: ApiProvider,
		refreshDynamicCatalog: boolean,
		modelCandidates: Map<string, Promise<string[]>>,
	): Promise<string[]> {
		const cacheKey = `${provider}:${refreshDynamicCatalog ? "refresh" : "configured"}`
		let candidates = modelCandidates.get(cacheKey)
		if (!candidates) {
			candidates = (async () => {
				try {
					if (usesOpenRouterModels(provider)) {
						return refreshDynamicCatalog ? filterOpenRouterModelIds(await fetchOpenRouterModels(), provider) : []
					}
					if (provider === "github-copilot") {
						return refreshDynamicCatalog
							? Object.keys(await refreshGithubCopilotModels()).sort((a, b) => a.localeCompare(b))
							: []
					}
					if (hasStaticModels(provider)) return getModelList(provider)
					if (provider === "dify") return ["dify-workflow"]
					return []
				} catch (error) {
					Logger.error(`[SessionConfigManager] Could not refresh models for ${provider}`, error)
					return []
				}
			})()
			modelCandidates.set(cacheKey, candidates)
		}
		return candidates
	}

	private getInferenceConfiguration(sessionOverrides: Partial<Settings>): ApiConfiguration {
		const stateManager = StateManager.get()
		const previousOverrides = stateManager.getSessionOverrideCache()
		stateManager.setSessionOverrideCache({ ...sessionOverrides })
		try {
			return stateManager.getApiConfiguration()
		} finally {
			stateManager.setSessionOverrideCache(previousOverrides)
		}
	}

	private isModelAcceptedByInference(
		configuration: ApiConfiguration,
		provider: ApiProvider,
		modelId: string,
		mode: Mode,
	): boolean {
		return this.resolveInferenceModelId(configuration, provider, modelId, mode) === modelId
	}

	private resolveInferenceModelId(
		configuration: ApiConfiguration,
		provider: ApiProvider,
		modelId: string,
		mode: Mode,
	): string | undefined {
		try {
			return resolveModelIdForProvider(configuration, provider, modelId, mode)
		} catch {
			return undefined
		}
	}

	private isProviderEnabled(provider: string): boolean {
		return this.providerConfiguration?.isProviderEnabled(provider) ?? true
	}

	private withCurrentSelectOption(
		options: acp.SessionConfigSelectOption[],
		currentValue: string,
		currentName: string,
	): acp.SessionConfigSelectOption[] {
		if (!currentValue || options.some((option) => option.value === currentValue)) return options
		return [{ value: currentValue, name: currentName }, ...options]
	}

	private assertModelAvailable(provider: ApiProvider, modelId: string, modelIds: string[]): void {
		if (modelIds.includes(modelId)) return
		throw new ApiConfigurationError(
			ApiConfigurationErrorCode.ModelUnavailable,
			`Model ${modelId} is unavailable for provider ${provider}`,
			"Select an available replacement model before retrying.",
		)
	}

	private setModeScopedSessionState(
		currentMode: Mode,
		sessionOverrides: Partial<Settings>,
		setter: (mode: Mode) => void,
	): void {
		setter(currentMode)
		const separateModels = sessionOverrides.planActSeparateModelsSetting ?? false
		if (!separateModels) setter(currentMode === "act" ? "plan" : "act")
	}
}
