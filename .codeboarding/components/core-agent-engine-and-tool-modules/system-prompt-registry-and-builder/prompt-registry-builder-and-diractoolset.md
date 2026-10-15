---
component_id: 1.5.2
component_name: Prompt Registry, Builder & DiracToolSet
---

# Prompt Registry, Builder & DiracToolSet

## Component Description

Manages prompt variant registration, orchestrates prompt assembly via PromptBuilder, and converts registered DiracToolSet definitions into native tool schemas.

---

## Key References:

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

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/registry/PromptBuilder.ts (lines 7-101)
```
export class PromptBuilder {
	private templateEngine: TemplateEngine

	constructor(private context: SystemPromptContext) {
		this.templateEngine = new TemplateEngine()
	}

	async build(): Promise<string> {
		const promptTemplate = SYSTEM_PROMPT(this.context)
		const placeholders = this.preparePlaceholders()
		const prompt = this.templateEngine.resolve(promptTemplate, this.context, placeholders)
		return this.postProcess(prompt)
	}

	private preparePlaceholders(): Record<string, unknown> {
		const placeholders: Record<string, unknown> = {}

		placeholders["OS"] = process.platform
		placeholders["SHELL"] = this.context.activeShellPath || userShell() || "bash"
		placeholders["SHELL_TYPE"] = this.context.activeShellType || "bash"
		placeholders["HOME_DIR"] = homeEnvDir() || ""
		placeholders["CURRENT_DATE"] = new Date().toISOString().split("T")[0]
		placeholders["AVAILABLE_CORES"] = this.context.availableCores || 1

		// Add runtime placeholders if any
		const runtimePlaceholders = (this.context as any).runtimePlaceholders
		if (runtimePlaceholders) {
			Object.assign(placeholders, runtimePlaceholders)
		}

		if (this.context.skills && this.context.skills.length > 0) {
			placeholders["SKILLS_SECTION"] = this.formatSkillsSection(this.context.skills)
		} else {
			placeholders["SKILLS_SECTION"] = ""
		}

		return placeholders
	}

	private postProcess(prompt: string): string {
		if (!prompt) {
			return ""
		}

		return prompt
			.replace(/\n\s*\n\s*\n/g, "\n\n") // Remove multiple consecutive empty lines
			.trim() // Remove leading/trailing whitespace
			.replace(/====+\s*$/, "") // Remove trailing ==== after trim
			.replace(/\n====+\s*\n+\s*====+\n/g, "\n====\n") // Remove empty sections between separators
			.replace(/====\s*\n\s*====\s*\n/g, "====\n") // Remove consecutive empty sections
			.replace(/^##\s*$[\r\n]*/gm, "") // Remove empty section headers (## with no content)
			.replace(/\n##\s*$[\r\n]*/gm, "") // Remove empty section headers that appear mid-document
			.replace(/====+\n(?!\n)([^\n])/g, (match, _nextChar, offset, string) => {
				const beforeContext = string.substring(Math.max(0, offset - 50), offset)
				const afterContext = string.substring(offset, Math.min(string.length, offset + 50))
				const isDiffLike = /SEARCH|REPLACE|\+\+\+\+\+\+\+|-------/.test(beforeContext + afterContext)
				return isDiffLike ? match : match.replace(/\n/, "\n\n")
			})
			.replace(/([^\n])\n(?!\n)====+/g, (match, prevChar, offset, string) => {
				const beforeContext = string.substring(Math.max(0, offset - 50), offset)
				const afterContext = string.substring(offset, Math.min(string.length, offset + 50))
				const isDiffLike = /SEARCH|REPLACE|\+\+\+\+\+\+\+|-------/.test(beforeContext + afterContext)
				return isDiffLike ? match : prevChar + "\n\n" + match.substring(1).replace(/\n/, "")
			})
			.replace(/\n\s*\n\s*\n/g, "\n\n") // Clean up any multiple empty lines created by header removal
			.trim() // Final trim
	}

	private formatSkillsSection(skills: SkillMetadata[]): string {
		const filtered = this.context.yoloModeToggled ? skills.filter((s) => !s.interactiveOnly) : skills
		if (filtered.length === 0) return ""

		let section = "\n\n# AVAILABLE SKILLS\n"
		section += "You have access to specialized skills. Use the 'use_skill' tool to activate one.\n\n"

		// Keep provider capabilities visible, then prioritize project guidance, built-ins, and global skills.
		const capabilitySkills = filtered.filter((s) => s.requiredProviderCapability !== undefined)
		const capabilityNames = new Set(capabilitySkills.map((s) => s.name))
		const projectSkills = filtered.filter((s) => s.source === "project" && !capabilityNames.has(s.name))
		const builtinSkills = filtered.filter((s) => s.source === "builtin" && !capabilityNames.has(s.name))
		const globalSkills = filtered.filter((s) => s.source === "global" && !capabilityNames.has(s.name))

		const displaySkills = [...capabilitySkills, ...projectSkills, ...builtinSkills, ...globalSkills].slice(0, 10)

		displaySkills.forEach((skill) => {
			section += `- ${skill.name}: ${skill.description}\n`
		})

		if (filtered.length > 10) {
			section += `\n... and ${filtered.length - 10} more. Use the 'list_skills' tool to see the full list.\n`
		}

		return section
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/registry/DiracToolSet.ts (lines 105-112)
```
	public static convertSpecsToNativeTools(specs: DiracToolSpec[], context: SystemPromptContext): DiracTool[] {
		const enabledTools = specs.filter((tool) => typeof tool.description === "string" && tool.description.trim().length > 0)
		const providerId = context.providerInfo?.providerId || "openai"
		const modelId = context.providerInfo?.model?.id
		const converter = DiracToolSet.getNativeConverter(providerId, modelId)

		return enabledTools.map((tool) => converter(tool, context))
	}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/registry/DiracToolSet.ts (lines 117-135)
```
	public static getNativeConverter(providerId: string, modelId?: string) {
		switch (providerId) {
			case "minimax":
			case "anthropic":
			case "bedrock":
				return toolSpecInputSchema
			case "gemini":
				return toolSpecFunctionDeclarations
			case "vertex":
				if (modelId?.includes("gemini")) {
					return toolSpecFunctionDeclarations
				}
				return toolSpecInputSchema
			default:
				// Default to OpenAI Compatible converter
				return (tool: DiracToolSpec, ctx: SystemPromptContext) =>
					toolSpecFunctionDefinition(tool, ctx, shouldUseStrictToolSchemas(ctx.providerInfo))
		}
	}
```


## Source Files:

- `src/core/prompts/system-prompt/registry/DiracToolSet.ts`
- `src/core/prompts/system-prompt/registry/PromptBuilder.ts`
- `src/core/prompts/system-prompt/registry/PromptRegistry.ts`

