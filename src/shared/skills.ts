/**
 * Skill metadata loaded at startup for discovery.
 * Only name and description are parsed from frontmatter initially.
 */
export const NATIVE_WEB_SEARCH_SKILL_NAME = "web-search"

export type SkillProviderCapability = "native_web_search"
export type SkillProviderCapabilities = Record<SkillProviderCapability, boolean>

export interface SkillMetadata {
	name: string
	description: string
	path: string
	source: "builtin" | "global" | "project"
	interactiveOnly?: boolean
	/** Provider runtime capability required before this skill may be advertised or activated. */
	requiredProviderCapability?: SkillProviderCapability
	/** Built-in-only dependencies injected while this skill is active. */
	toolDependencies?: readonly string[]
}

/**
 * Full skill content loaded on-demand when skill is activated.
 */
export interface SkillContent extends SkillMetadata {
	instructions: string
}

export function filterSkillsByProviderCapabilities(
	skills: SkillMetadata[],
	capabilities: SkillProviderCapabilities,
): SkillMetadata[] {
	return skills.filter((skill) => !skill.requiredProviderCapability || capabilities[skill.requiredProviderCapability])
}
