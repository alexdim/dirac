import type { ReasoningEffort as OpenAiSdkReasoningEffort } from "openai/resources/shared"

export type OpenaiReasoningEffort = Exclude<OpenAiSdkReasoningEffort, null>

export const DEFAULT_OPENAI_REASONING_EFFORT: OpenaiReasoningEffort = "high"

export const OPENAI_REASONING_EFFORT_LABELS = {
	none: "None",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
} as const satisfies Record<OpenaiReasoningEffort, string>

export const OPENAI_REASONING_EFFORT_OPTIONS = Object.freeze(
	Object.keys(OPENAI_REASONING_EFFORT_LABELS) as OpenaiReasoningEffort[],
)

export function isOpenaiReasoningEffort(value: unknown): value is OpenaiReasoningEffort {
	return typeof value === "string" && OPENAI_REASONING_EFFORT_OPTIONS.includes(value as OpenaiReasoningEffort)
}

export function normalizeOpenaiReasoningEffort(effort?: string): OpenaiReasoningEffort {
	const value = (effort || DEFAULT_OPENAI_REASONING_EFFORT).toLowerCase()
	return isOpenaiReasoningEffort(value) ? value : DEFAULT_OPENAI_REASONING_EFFORT
}

export type Mode = "plan" | "act"
