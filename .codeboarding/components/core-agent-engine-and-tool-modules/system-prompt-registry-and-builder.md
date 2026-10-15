---
component_id: 1.5
component_name: System Prompt Registry & Builder
---

# System Prompt Registry & Builder

## Component Description

Builds system prompts, registers prompt templates, and formats tool specifications for model invocations.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/index.ts (lines 16-20)
```
export async function getSystemPrompt(context: SystemPromptContext, toolSnapshot: ToolRequestSnapshot) {
	const registry = PromptRegistry.getInstance()
	const systemPrompt = await registry.get(context, toolSnapshot)
	return { systemPrompt }
}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/registry/PromptRegistry.ts (lines 6-70)
```
export class PromptRegistry {
	private static instance: PromptRegistry
	public nativeTools: DiracTool[] | undefined = undefined

	private cachedPrompt?: { fingerprint: string; result: string }

	private constructor() { }

	static getInstance(): PromptRegistry {
		if (!PromptRegistry.instance) {
			PromptRegistry.instance = new PromptRegistry()
		}
		return PromptRegistry.instance
	}

	/**
	 * Get unified system prompt
	 */
	async get(context: SystemPromptContext, toolSnapshot: ToolRequestSnapshot): Promise<string> {
		this.nativeTools = toolSnapshot.nativeTools

		const fingerprint = this.computePromptFingerprint(context, toolSnapshot)
		if (this.cachedPrompt?.fingerprint === fingerprint) {
			return this.cachedPrompt.result
		}

		const builder = new PromptBuilder(context)
		const result = await builder.build()
		this.cachedPrompt = { fingerprint, result }
		return result
	}

	private computePromptFingerprint(context: SystemPromptContext, toolSnapshot: ToolRequestSnapshot): string {
		return [
			// Tool snapshot — covers subagents, browser, multi-root, all contextRequirements-gated tools
			toolSnapshot.inventoryVersion,
			toolSnapshot.nativeTools.length,
			// Template text fields (template.ts)
			context.cwd,
			context.yoloModeToggled ? 1 : 0,
			context.utilityModelConfigured ? 1 : 0,
			context.activeShellIsPosix ? 1 : 0,
			context.activeShellType,
			context.activeShellPath,
			// PromptBuilder placeholders
			context.availableCores,
			context.skills?.length ?? 0,
			// Instruction content lengths (length change → content change)
			context.preferredLanguageInstructions?.length ?? 0,
			context.diracIgnoreInstructions?.length ?? 0,
			context.globalDiracRulesFileInstructions?.length ?? 0,
			context.localDiracRulesFileInstructions?.length ?? 0,
			context.localCursorRulesFileInstructions?.length ?? 0,
			context.localCursorRulesDirInstructions?.length ?? 0,
			context.localWindsurfRulesFileInstructions?.length ?? 0,
			context.localAgentsRulesFileInstructions?.length ?? 0,
			context.userInstructions?.length ?? 0,
			context.diracRules?.length ?? 0,
		].join(":")
	}

	public static dispose(): void {
		PromptRegistry.instance = null as unknown as PromptRegistry
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/registry/DiracToolSet.ts (lines 24-54)
```
	public static getDynamicSubagentToolSpecs(context: SystemPromptContext): DiracToolSpec[] {
		if (context.subagentsEnabled !== true) {
			return []
		}

		const agentConfigs = AgentConfigLoader.getInstance().getAllCachedConfigsWithToolNames()
		return agentConfigs.map(({ toolName, config }) => ({
			id: DiracDefaultTool.USE_SUBAGENTS,
			name: toolName,
			description: `Use the "${config.name}" subagent: ${config.description}`,
			contextRequirements: (ctx) => ctx.subagentsEnabled === true,
			parameters: [
				{
					name: "task_title",
					required: true,
					instruction: `Task header for user observability. No more than ${SUBAGENT_TASK_TITLE_MAX_WORDS} words or ${SUBAGENT_TASK_TITLE_MAX_CHARS} characters.`,
				},
				{
					name: "prompt",
					required: true,
					instruction: "Helpful instruction for the task that the subagent will perform.",
				},
				{
					name: "timeout",
					required: false,
					instruction: `Optional timeout in seconds for the subagent. Default: ${DEFAULT_SUBAGENT_TIMEOUT_SECONDS}.`,
				},
				...(context.utilityModelConfigured ? [UTILITY_MODEL_PARAMETER] : []),
			],
		}))
	}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/spec.ts (lines 358-386)
```
export function openAIToolToAnthropic(openAITool: OpenAITool): AnthropicTool {
	if (openAITool.type === "function") {
		const func = openAITool.function
		return {
			name: func.name,
			description: func.description || "",
			input_schema: {
				type: "object",
				...(Object.keys(func.parameters?.properties || {}).length > 0
					? {
						properties: func.parameters?.properties,
						required: (func.parameters as any)?.required || [],
					}
					: {}),
			},
		}
	}

	return {
		name: openAITool.custom.name,
		description: openAITool.custom.description || "",
		input_schema: {
			type: "object",
			required: openAITool.custom.format?.type === "text" ? ["text"] : [],
			properties:
				openAITool.custom.format?.type === "text" ? { text: { type: "string" } } : { grammar: { type: "object" } },
		},
	}
}
```


## Source Files:

- `src/core/prompts/system-prompt/index.ts`
- `src/core/prompts/system-prompt/registry/DiracToolSet.ts`
- `src/core/prompts/system-prompt/registry/PromptBuilder.ts`
- `src/core/prompts/system-prompt/registry/PromptRegistry.ts`
- `src/core/prompts/system-prompt/spec.ts`
- `src/core/prompts/system-prompt/templates/TemplateEngine.ts`
- `src/core/prompts/system-prompt/templates/placeholders.ts`
- `src/core/prompts/system-prompt/tools/init.ts`
- `src/core/prompts/system-prompt/types.ts`

