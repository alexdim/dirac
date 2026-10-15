---
component_id: 1.5.1
component_name: Prompt Entry Point & Tool Specification Converters
---

# Prompt Entry Point & Tool Specification Converters

## Component Description

Provides the main system prompt entry point, section validation types, prompt sections, tool initialization, and provider-specific native tool schema converters.

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

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/spec.ts (lines 13-128)
```
export function toolSpecFunctionDefinition(tool: DiracToolSpec, context: SystemPromptContext, strict = false): OpenAITool {
	if (tool.contextRequirements && !tool.contextRequirements(context)) {
		throw new Error(`Tool ${tool.name} does not meet context requirements`)
	}

	const nullableType = (type: unknown): unknown => {
		if (Array.isArray(type)) return type.includes("null") ? type : [...type, "null"]
		return type === "null" ? type : [type, "null"]
	}

	const processSchema = (schema: any, optional = false): any => {
		const {
			type,
			properties: rawProperties,
			required: rawRequired,
			items: rawItems,
			enum: enumValues,
			...constraints
		} = schema

		if (type === "object") {
			const properties: Record<string, any> = {}
			const originalRequired = new Set<string>(rawRequired ?? [])
			for (const [key, value] of Object.entries(rawProperties ?? {})) {
				properties[key] = processSchema(value, !originalRequired.has(key))
			}
			return {
				...constraints,
				type: optional ? nullableType("object") : "object",
				properties,
				required: Object.keys(properties),
				additionalProperties: false,
			}
		}

		if (type === "array" && rawItems) {
			return {
				...constraints,
				type: optional ? nullableType("array") : "array",
				items: processSchema(rawItems),
			}
		}

		const processedEnum = optional && enumValues && !enumValues.includes(null) ? [...enumValues, null] : enumValues
		return {
			...constraints,
			type: optional ? nullableType(type) : type,
			...(processedEnum ? { enum: processedEnum } : {}),
		}
	}

	const properties: Record<string, any> = {}
	const required: string[] = []

	if (tool.parameters) {
		for (const param of tool.parameters) {
			if (param.contextRequirements && !param.contextRequirements(context)) {
				continue
			}

			if (param.required || strict) {
				required.push(param.name)
			}

			const paramType: string = param.type || "string"
			const paramSchema: any = {
				type: paramType,
				description: replacer(resolveInstruction(param.instruction, context), context),
			}

			if (paramType === "array" && param.items) {
				paramSchema.items = param.items
			}

			if (paramType === "object" && param.properties) {
				paramSchema.properties = param.properties
			}

			const reservedKeys = new Set([
				"name",
				"required",
				"instruction",
				"usage",
				"dependencies",
				"description",
				"contextRequirements",
				"type",
				"items",
				"properties",
			])

			for (const key in param) {
				if (!reservedKeys.has(key) && param[key] !== undefined) {
					paramSchema[key] = param[key]
				}
			}

			properties[param.name] = strict ? processSchema(paramSchema, !param.required) : paramSchema
		}
	}

	return {
		type: "function",
		function: {
			name: tool.name,
			strict,
			description: resolveToolDescription(tool, context),
			parameters: {
				type: "object",
				properties,
				required,
				additionalProperties: false,
			},
		},
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/spec.ts (lines 150-227)
```
export function toolSpecInputSchema(tool: DiracToolSpec, context: SystemPromptContext): AnthropicTool {
	// Check if the tool should be included based on context requirements
	if (tool.contextRequirements && !tool.contextRequirements(context)) {
		throw new Error(`Tool ${tool.name} does not meet context requirements`)
	}

	// Build the properties object for parameters
	const properties: Record<string, any> = {}
	const required: string[] = []

	if (tool.parameters) {
		for (const param of tool.parameters) {
			// Check if parameter should be included based on context requirements
			if (param.contextRequirements && !param.contextRequirements(context)) {
				continue
			}

			// Add to required array if parameter is required
			if (param.required) {
				required.push(param.name)
			}

			// Determine parameter type - use explicit type if provided.
			// Default to string
			const paramType: string = param.type || "string"

			// Build parameter schema
			const paramSchema: any = {
				type: paramType,
				description: replacer(resolveInstruction(param.instruction, context), context),
			}

			// Add items for array types
			if (paramType === "array" && param.items) {
				paramSchema.items = param.items
			}

			// Add properties for object types
			if (paramType === "object" && param.properties) {
				paramSchema.properties = param.properties
			}

			const reservedKeys = new Set([
				"name",
				"required",
				"instruction",
				"usage",
				"dependencies",
				"description",
				"contextRequirements",
				"type",
				"items",
				"properties",
			])
			for (const key in param) {
				if (!reservedKeys.has(key) && param[key] !== undefined) {
					paramSchema[key] = param[key]
				}
			}


			properties[param.name] = paramSchema
		}
	}

	// Build the Tool object
	const toolInputSchema: AnthropicTool = {
		name: tool.name,
		description: resolveToolDescription(tool, context),
		input_schema: {
			type: "object",
			properties,
			required,
		},
	}

	return toolInputSchema
}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/spec.ts (lines 242-353)
```
export function toolSpecFunctionDeclarations(tool: DiracToolSpec, context: SystemPromptContext): GoogleTool {
	// Check if the tool should be included based on context requirements
	if (tool.contextRequirements && !tool.contextRequirements(context)) {
		throw new Error(`Tool ${tool.name} does not meet context requirements`)
	}

	/**
	 * Recursively converts a JSON Schema-like property into a Google Gemini Schema.
	 */
	const toGoogleSchema = (prop: any): any => {
		const type = GOOGLE_TOOL_PARAM_MAP[prop.type || "string"] || GoogleToolParamType.OBJECT
		const schema: any = { type }

		if (prop.description) {
			schema.description = prop.description
		}

		if (prop.enum) {
			schema.enum = prop.enum
		}

		if ((type === "OBJECT" || type === GoogleToolParamType.OBJECT) && prop.properties) {
			schema.properties = {}
			const required: string[] = []
			for (const [key, value] of Object.entries<any>(prop.properties)) {
				if (key === "$schema") {
					continue
				}
				schema.properties[key] = toGoogleSchema(value)
				// Handle required fields in objects
				if (value.required || (Array.isArray(prop.required) && prop.required.includes(key))) {
					required.push(key)
				}
			}
			if (required.length > 0) {
				schema.required = required
			}
		}

		if ((type === "ARRAY" || type === GoogleToolParamType.ARRAY) && prop.items) {
			schema.items = toGoogleSchema(prop.items)
		}

		// Preserve any additional JSON Schema fields (e.g. pattern, format, etc.)
		const reservedKeys = new Set([
			"type",
			"description",
			"enum",
			"properties",
			"required",
			"items",
			"instruction",
			"name",
			"usage",
			"dependencies",
			"contextRequirements",
		])
		for (const key in prop) {
			if (!reservedKeys.has(key) && prop[key] !== undefined) {
				schema[key] = prop[key]
			}
		}

		return schema
	}

	// Build the parameters object
	const properties: Record<string, any> = {}
	const required: string[] = []

	if (tool.parameters) {
		for (const param of tool.parameters) {
			// Check if parameter should be included based on context requirements
			if (param.contextRequirements && !param.contextRequirements(context)) {
				continue
			}

			if (!param.name) {
				continue
			}

			// Add to required array if parameter is required
			if (param.required) {
				required.push(param.name)
			}

			// Top-level parameter schema
			const paramSchema = toGoogleSchema(param)

			// Resolve top-level instruction as description
			if (param.instruction) {
				const desc = replacer(resolveInstruction(param.instruction, context), context)
				if (desc) {
					paramSchema.description = desc
				}
			}

			properties[param.name] = paramSchema
		}
	}

	const googleTool: GoogleTool = {
		name: tool.name,
		description: resolveToolDescription(tool, context),
		parameters: {
			type: GoogleToolParamType.OBJECT,
			properties,
			required,
		},
	}
	return googleTool
}
```

### /Users/highlands/pools/Development/dirac/src/core/prompts/system-prompt/types.ts (lines 64-66)
```
export function isValidSystemPromptSection(section: string): section is SystemPromptSection {
	return Object.values(SystemPromptSection).includes(section as SystemPromptSection)
}
```


## Source Files:

- `src/core/prompts/system-prompt/index.ts`
- `src/core/prompts/system-prompt/spec.ts`
- `src/core/prompts/system-prompt/tools/init.ts`
- `src/core/prompts/system-prompt/types.ts`

