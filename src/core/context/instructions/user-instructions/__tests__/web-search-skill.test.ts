import { strict as assert } from "node:assert"
import * as fs from "fs/promises"
import { describe, it } from "mocha"
import { parseYamlFrontmatter } from "@utils/frontmatter"
import { BUILTIN_SKILLS, getSkillContent } from "../skills"

async function getEmbeddedInstructions(): Promise<string> {
	const content = await getSkillContent("web-search", BUILTIN_SKILLS)
	assert.ok(content)
	return content.instructions
}

async function getCanonicalInstructions(): Promise<string> {
	const content = await fs.readFile("src/core/prompts/skills/web-search/SKILL.md", "utf8")
	return parseYamlFrontmatter(content).body.trim()
}

describe("web-search skill template", () => {
	for (const [label, loadInstructions] of [
		["embedded", getEmbeddedInstructions],
		["canonical", getCanonicalInstructions],
	] as const) {
		it(`${label} instructions enable native search for subsequent requests`, async () => {
			const instructions = await loadInstructions()
			assert.match(instructions, /Provider-native web search is now enabled/)
			assert.match(instructions, /current or externally verifiable information/)
		})
	}
})
