import { isOpenaiReasoningEffort, OPENAI_REASONING_EFFORT_OPTIONS, type OpenaiReasoningEffort } from "@shared/storage/types"

export function normalizeReasoningEffort(value: unknown): OpenaiReasoningEffort {
	if (isOpenaiReasoningEffort(value)) {
		return value
	}
	return "low"
}

export function nextReasoningEffort(current: OpenaiReasoningEffort): OpenaiReasoningEffort {
	const idx = OPENAI_REASONING_EFFORT_OPTIONS.indexOf(current)
	return OPENAI_REASONING_EFFORT_OPTIONS[(idx + 1) % OPENAI_REASONING_EFFORT_OPTIONS.length]
}
