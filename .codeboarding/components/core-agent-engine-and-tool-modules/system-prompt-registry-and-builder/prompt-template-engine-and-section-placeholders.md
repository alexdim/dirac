---
component_id: 1.5.3
component_name: Prompt Template Engine & Section Placeholders
---

# Prompt Template Engine & Section Placeholders

## Component Description

Defines system prompt section placeholder constants and resolves template placeholders into rendered prompt content via TemplateEngine.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/templates/TemplateEngine.ts (lines 3-91)
```
export class TemplateEngine {
	/**
	 * Resolves template placeholders in the format {{PLACEHOLDER}} with provided values
	 */
	resolve(
		template: string | ((context: SystemPromptContext) => string),
		context: SystemPromptContext,
		placeholders: Record<string, unknown>,
	): string {
		if (typeof template === "function") {
			template = template(context)
		}

		return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
			const trimmedKey = key.trim()

			// Support nested object access using dot notation
			const value = this.getNestedValue(placeholders, trimmedKey)

			if (value !== undefined && value !== null) {
				return typeof value === "string" ? value : JSON.stringify(value)
			}

			// Keep placeholder if not found (allows for partial resolution)
			return match
		})
	}

	/**
	 * Validates that a template has all required placeholders filled
	 */
	validate(template: string, requiredPlaceholders: string[]): string[] {
		const missingPlaceholders: string[] = []

		for (const placeholder of requiredPlaceholders) {
			const regex = new RegExp(`\\{\\{\\s*${placeholder}\\s*\\}\\}`, "g")
			if (!regex.test(template)) {
				missingPlaceholders.push(placeholder)
			}
		}

		return missingPlaceholders
	}

	/**
	 * Extracts all placeholder names from a template
	 */
	extractPlaceholders(template: string): string[] {
		const placeholders: string[] = []
		const regex = /\{\{([^}]+)\}\}/g
		let match: RegExpExecArray | null = null

		match = regex.exec(template)
		while (match !== null) {
			const placeholder = match[1].trim()
			if (!placeholders.includes(placeholder)) {
				placeholders.push(placeholder)
			}
			match = regex.exec(template)
		}

		return placeholders
	}

	/**
	 * Gets nested value from object using dot notation (e.g., "user.name" -> obj.user.name)
	 */
	private getNestedValue(obj: unknown, path: string): unknown {
		return path.split(".").reduce((current, key) => {
			return current && typeof current === "object" && current !== null
				? (current as Record<string, unknown>)[key]
				: undefined
		}, obj)
	}

	/**
	 * Escapes template placeholders to prevent accidental resolution
	 */
	escape(template: string): string {
		return template.replace(/\{\{/g, "\\{\\{").replace(/\}\}/g, "\\}\\}")
	}

	/**
	 * Unescapes template placeholders
	 */
	unescape(template: string): string {
		return template.replace(/\\{\\{/g, "{{").replace(/\\}\\}/g, "}}")
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/templates/TemplateEngine.ts (lines 7-29)
```
	resolve(
		template: string | ((context: SystemPromptContext) => string),
		context: SystemPromptContext,
		placeholders: Record<string, unknown>,
	): string {
		if (typeof template === "function") {
			template = template(context)
		}

		return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
			const trimmedKey = key.trim()

			// Support nested object access using dot notation
			const value = this.getNestedValue(placeholders, trimmedKey)

			if (value !== undefined && value !== null) {
				return typeof value === "string" ? value : JSON.stringify(value)
			}

			// Keep placeholder if not found (allows for partial resolution)
			return match
		})
	}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/templates/placeholders.ts (lines 1-16)
```
export enum SystemPromptSection {
	AGENT_ROLE = "AGENT_ROLE_SECTION",
	TOOL_USE = "TOOL_USE_SECTION",
	TOOLS = "TOOLS_SECTION",
	EDITING_FILES = "EDITING_FILES_SECTION",
	ACT_VS_PLAN = "ACT_VS_PLAN_SECTION",
	TODO = "TODO_SECTION",
	CAPABILITIES = "CAPABILITIES_SECTION",
	SKILLS = "SKILLS_SECTION",
	RULES = "RULES_SECTION",
	SYSTEM_INFO = "SYSTEM_INFO_SECTION",
	OBJECTIVE = "OBJECTIVE_SECTION",
	USER_INSTRUCTIONS = "USER_INSTRUCTIONS_SECTION",
	FEEDBACK = "FEEDBACK_SECTION",
	TASK_PROGRESS = "TASK_PROGRESS_SECTION",
}
```


## Source Files:

- `src/core/prompts/system-prompt/templates/TemplateEngine.ts`
- `src/core/prompts/system-prompt/templates/placeholders.ts`

