/**
 * Pure helpers shared by the Bedrock provider. Extracted out of
 * `src/core/api/providers/bedrock.ts` (FB-15b) — no class state.
 */

/** Approximate token count (4 characters per token). */
export function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / 4)
}

/** Extracts the visible text + reasoning text from a non-streaming Converse response. */
export function extractNonStreamingContent(response: any): { fullText: string; reasoningText: string } {
	let fullText = ""
	let reasoningText = ""
	if (!response.output?.message?.content) return { fullText, reasoningText }
	for (const block of response.output.message.content) {
		if ("reasoningContent" in block && block.reasoningContent) {
			const reasoning = block.reasoningContent
			if ("reasoningText" in reasoning && reasoning.reasoningText && "text" in reasoning.reasoningText) {
				reasoningText += reasoning.reasoningText.text
			}
		} else if ("text" in block && block.text) {
			fullText += block.text
		}
	}
	return { fullText, reasoningText }
}

/** Formats an unknown error for the Converse error message, naming it when present. */
export function formatConverseError(error: unknown, label: string): string {
	if (error instanceof Error) {
		const named = error as Error & { name?: string }
		return named.name ? `${named.name}: ${error.message}` : error.message
	}
	return `Failed to process ${label} model request`
}

/** Prepares system messages with optional Converse caching support. */
export function prepareSystemMessages(systemPrompt: string, enableCaching: boolean): any[] | undefined {
	if (!systemPrompt) {
		return undefined
	}
	if (enableCaching) {
		return [{ text: systemPrompt }, { cachePoint: { type: "default" } }]
	}
	return [{ text: systemPrompt }]
}

/** Chunks text into 1000-char segments and yields as the given chunk type. */
export function* chunkText(text: string, type: "text" | "reasoning"): Generator<any> {
	if (!text) return
	const chunkSize = 1000
	for (let i = 0; i < text.length; i += chunkSize) {
		const chunk = text.slice(i, Math.min(i + chunkSize, text.length))
		yield type === "reasoning" ? { type: "reasoning", reasoning: chunk } : { type: "text", text: chunk }
	}
}
