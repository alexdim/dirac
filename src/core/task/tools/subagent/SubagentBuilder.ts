import { buildApiHandler } from "@core/api"
import { DiracDefaultTool } from "@shared/tools"
import { ApiProvider } from "@/shared/api"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import type { TaskConfig } from "../types/TaskConfig"
import type { SubagentIdentity } from "@shared/subagents"
import type { SubagentRunRecorder } from "./SubagentRunRecorder"
import type { AgentBaseConfig } from "./AgentConfigLoader"
import { AgentConfigLoader } from "./AgentConfigLoader"
import { LEGACY_RESPONSE_TOOLS, RESPOND_TOOL_NAME, ResponseOperation } from "@shared/responseTool"

export type AgentConfig = Partial<AgentBaseConfig>

export interface SubagentBuilderOptions {
	allowedTools?: string[]
	systemSuffix?: string
	agentIdentity?: SubagentIdentity
	recorder?: SubagentRunRecorder
}

export const SUBAGENT_DEFAULT_ALLOWED_TOOLS: string[] = [
	...Object.values(DiracDefaultTool).filter(
		(tool) =>
			tool !== DiracDefaultTool.USE_SUBAGENTS &&
			tool !== DiracDefaultTool.NEW_TASK &&
			tool !== DiracDefaultTool.CONDENSE &&
			tool !== DiracDefaultTool.RESPOND,
	),
	`${RESPOND_TOOL_NAME}:${ResponseOperation.PROGRESS}`,
	`${RESPOND_TOOL_NAME}:${ResponseOperation.COMPLETE}`,
]

export const SUBAGENT_SYSTEM_SUFFIX = `\n\n# Subagent Execution Mode
You are running as a research subagent spawned by the main agent. Perform the requested task and report back.
You may use any tool at your disposal to accomplish the task. You may create and execute scripts or temporary files, but **do not modify or delete any pre-existing files**.
Call respond with operation "complete" when finished or if the task is not making progress. Focus on actionable information and relevant file paths.
`

export const SUBAGENT_PROGRESS_INSTRUCTION = `
During the task, use respond with operation "progress" for timely trajectory updates at important points, such as a key finding, decision, blocker, or change in approach. Keep each update to one or two lines and skip routine or verbose status reports.
`

export class SubagentBuilder {
	private readonly agentConfig: AgentConfig = {}
	private readonly allowedTools: string[]
	private readonly apiHandler: ReturnType<typeof buildApiHandler>

	constructor(
		private readonly baseConfig: TaskConfig,
		subagentName?: string,
		private readonly options: SubagentBuilderOptions = {},
	) {
		const subagentConfig = AgentConfigLoader.getInstance().getCachedConfig(subagentName)
		this.agentConfig = subagentConfig ?? {}
		this.allowedTools = this.resolveAllowedTools(this.agentConfig.tools)

		const mode = this.baseConfig.services.stateManager.getGlobalSettingsKey("mode")
		const apiConfiguration = this.baseConfig.services.stateManager.getApiConfiguration()
		const effectiveApiConfiguration = {
			...apiConfiguration,
			ulid: this.baseConfig.ulid,
		} as Record<string, unknown>
		this.applyModelOverride(effectiveApiConfiguration, mode, this.agentConfig.modelId)
		this.apiHandler = buildApiHandler(effectiveApiConfiguration as typeof apiConfiguration, mode)
	}

	getApiHandler(): ReturnType<typeof buildApiHandler> {
		return this.apiHandler
	}

	getAllowedTools(): string[] {
		return this.allowedTools
	}

	getConfiguredSkills(): string[] | undefined {
		return this.agentConfig.skills
	}

	buildSystemPrompt(generatedSystemPrompt: string): string {
		const configuredSystemPrompt = this.agentConfig?.systemPrompt?.trim()
		const systemPrompt = configuredSystemPrompt || generatedSystemPrompt
		return `${systemPrompt}${this.buildAgentIdentitySystemPrefix()}${this.options.systemSuffix ?? SUBAGENT_SYSTEM_SUFFIX}${SUBAGENT_PROGRESS_INSTRUCTION}`
	}

	private resolveAllowedTools(configuredTools?: string[]): string[] {
		const sourceTools =
			this.options.allowedTools ??
			(configuredTools && configuredTools.length > 0 ? configuredTools : SUBAGENT_DEFAULT_ALLOWED_TOOLS)
		const migrated = sourceTools.map((tool) => {
			const operation = LEGACY_RESPONSE_TOOLS[tool as keyof typeof LEGACY_RESPONSE_TOOLS]
			return operation ? `${RESPOND_TOOL_NAME}:${operation}` : tool
		})
		return Array.from(
			new Set([
				...migrated,
				`${RESPOND_TOOL_NAME}:${ResponseOperation.PROGRESS}`,
				`${RESPOND_TOOL_NAME}:${ResponseOperation.COMPLETE}`,
			]),
		)
	}

	private buildAgentIdentitySystemPrefix(): string {
		const name = this.agentConfig?.name?.trim()
		const description = this.agentConfig?.description?.trim()
		if (!name && !description) {
			return ""
		}

		const lines = ["# Agent Profile"]
		if (name) {
			lines.push(`Name: ${name}`)
		}
		if (description) {
			lines.push(`Description: ${description}`)
		}

		return `${lines.join("\n")}\n\n`
	}

	private applyModelOverride(apiConfiguration: Record<string, unknown>, _mode: string, modelId?: string): void {
		const trimmedModelId = modelId?.trim()
		if (!trimmedModelId) {
			return
		}

		const mode = _mode === "plan" ? "plan" : "act"
		const provider = apiConfiguration[_mode === "plan" ? "planModeApiProvider" : "actModeApiProvider"] as ApiProvider
		apiConfiguration[getProviderModelIdKey(provider as ApiProvider, mode)] = trimmedModelId
	}
}
