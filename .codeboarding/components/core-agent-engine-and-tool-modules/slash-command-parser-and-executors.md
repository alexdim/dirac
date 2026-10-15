---
component_id: 1.6
component_name: Slash Command Parser & Executors
---

# Slash Command Parser & Executors

## Component Description

Parses and executes built-in, skill, workflow, and permission slash commands.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/slash-commands/commandParser.ts (lines 5-19)
```
export function findSlashCommandInTags(text: string): SlashCommandMatch | null {
	for (const { regex } of TAG_PATTERNS) {
		const regexObj = new RegExp(regex.source, regex.flags)
		const tagMatch = regexObj.exec(text)
		if (!tagMatch) continue

		const tagContent = tagMatch[1]
		const contentStartIndex = text.indexOf(tagContent, tagMatch.index)
		const slashMatch = SLASH_COMMAND_IN_TEXT_REGEX.exec(tagContent)
		if (!slashMatch) continue

		return { commandName: slashMatch[2], tagContent, contentStartIndex, slashMatch, regexObj }
	}
	return null
}
```

### /Users/highlands/pools/Development/dirac/src/core/slash-commands/PermissionsCommandHandler.ts (lines 5-48)
```
export async function handlePermissionsCommand(
	text: string,
	permissionController: CommandPermissionController,
): Promise<{ processedText: string; success: boolean }> {
	// Pattern: /permissions (allow|deny) <tool> <pattern>
	// Or: /permissions (allow|deny) <tool>
	const match = text.match(/\/permissions\s+(allow|deny)\s+([^\s]+)(?:\s+(.+))?/)

	if (!match) {
		return {
			processedText: "Invalid /permissions command. Usage: /permissions <allow|deny> <tool> [pattern]",
			success: false,
		}
	}

	const action = match[1] as "allow" | "deny"
	const tool = match[2]
	const pattern = match[3]?.trim()

	const newRule: ToolPermissionRule = {
		tool,
		pattern,
		action,
	}

	try {
		// Load current config
		// Note: We need a way to get the current config from the controller
		// For now, I'll assume we can just save a new rule.
		// Actually, I should add a method to add a rule to the controller.
		await permissionController.addRule(newRule)

		const patternDesc = pattern ? ` for pattern "${pattern}"` : ""
		return {
			processedText: `Permission updated: ${action} ${tool}${patternDesc}.`,
			success: true,
		}
	} catch (error) {
		return {
			processedText: `Failed to update permissions: ${getErrorMessage(error)}`,
			success: false,
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/slash-commands/SkillCommandExecutor.ts (lines 9-44)
```
export async function executeSkillCommand(
	match: SlashCommandMatch,
	fullText: string,
	ulid: string,
	availableSkills: SkillMetadata[],
): Promise<ParseSlashCommandResult | null> {
	const { commandName, contentStartIndex, slashMatch, regexObj } = match
	const skill = availableSkills.find((s) => s.name === commandName)
	if (!skill) return null

	try {
		const skillContent = await getSkillContent(skill.name, availableSkills)
		if (!skillContent) return null

		const textWithoutSlashCommand = removeSlashCommand(fullText, contentStartIndex, slashMatch)
		let processedText = `<explicit_instructions type="skill" name="${skillContent.name}">\n${skillContent.instructions}\n</explicit_instructions>\n`

		// If the tag is now empty, add a note so the agent acknowledges skill activation
		const newTagContentMatch = regexObj.exec(textWithoutSlashCommand)
		const newTagContent = newTagContentMatch ? newTagContentMatch[1].trim() : ""
		if (!newTagContent) {
			processedText += `\n(Note: The user has explicitly activated the "${skillContent.name}" skill via a slash command. This skill is now active. Please acknowledge its activation, summarize how you can help based on its instructions, and ask the user for the specific target or task they want you to perform, or propose a first step if appropriate.)\n`
		}

		processedText += textWithoutSlashCommand
		telemetryService.captureSlashCommandUsed(ulid, commandName, "skill")
		return {
			processedText,
			needsDiracrulesFileCheck: false,
			directAction: { type: "activateSkill", skillId: skillContent.name },
		}
	} catch (error) {
		Logger.error(`Error loading skill ${skill.name}: ${error}`)
		return null
	}
}
```


## Source Files:

- `src/core/slash-commands/BuiltinCommandExecutor.ts`
- `src/core/slash-commands/PermissionsCommandHandler.ts`
- `src/core/slash-commands/SkillCommandExecutor.ts`
- `src/core/slash-commands/WorkflowCommandExecutor.ts`
- `src/core/slash-commands/commandParser.ts`
- `src/core/slash-commands/commandRegistry.ts`
- `src/core/slash-commands/index.ts`

