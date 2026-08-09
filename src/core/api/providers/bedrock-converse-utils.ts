/**
 * Pure helpers shared by the Bedrock provider. Extracted out of
 * `src/core/api/providers/bedrock.ts` (FB-15b) — no class state.
 */
import { calculateApiCostOpenAI } from "@utils/cost"
import { Logger } from "@/shared/services/Logger"
import { getErrorMessage } from "@/shared/errors"
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import type { ContentBlock, Message, ToolConfiguration } from "@aws-sdk/client-bedrock-runtime"
import type { DiracTool } from "@/shared/tools"

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

/** Cache-point content block type for AWS Bedrock Converse prompt caching. */
interface CachePointContentBlockShape {
	cachePoint: { type: "default" }
}

/**
 * Converts Dirac's tool definitions (Anthropic format with `input_schema`) to the
 * Bedrock Converse API `ToolConfiguration` shape.
 */
export function mapDiracToolsToBedrockToolConfig(tools?: DiracTool[]): ToolConfiguration | undefined {
	if (!tools || tools.length === 0) {
		return undefined
	}
	const isAnthropicTool = (tool: DiracTool): tool is AnthropicTool => "input_schema" in tool
	const bedrockTools = tools.filter(isAnthropicTool).map((tool) => ({
		toolSpec: {
			name: tool.name,
			description: tool.description || tool.name || "Tool",
			inputSchema: { json: tool.input_schema },
		},
	}))
	if (bedrockTools.length === 0) {
		return undefined
	}
	return {
		tools: bedrockTools as unknown as ToolConfiguration["tools"],
		toolChoice: { auto: {} },
	}
}

/** Converts a Dirac image content block into a Bedrock image content block. */
export function processImageContent(item: any): ContentBlock | null {
	let imageData: Uint8Array
	let format: "png" | "jpeg" | "gif" | "webp" = "jpeg"
	if (item.source.media_type) {
		const formatMatch = item.source.media_type.match(/image\/(\w+)/)
		if (formatMatch && formatMatch[1] && ["png", "jpeg", "gif", "webp"].includes(formatMatch[1])) {
			format = formatMatch[1] as "png" | "jpeg" | "gif" | "webp"
		}
	}
	try {
		if (typeof item.source.data === "string") {
			const base64Data = item.source.data.replace(/^data:image\/\w+;base64,/, "")
			imageData = new Uint8Array(Buffer.from(base64Data, "base64"))
		} else if (item.source.data && typeof item.source.data === "object") {
			imageData = new Uint8Array(Buffer.from(item.source.data as Buffer | Uint8Array))
		} else {
			throw new Error("Unsupported image data format")
		}
		return { image: { format, source: { bytes: imageData } } }
	} catch (error) {
		Logger.error("Failed to process image content:", error)
		return { text: `[ERROR: Failed to process image - ${getErrorMessage(error, "Unknown error")}]` }
	}
}

/** Applies Bedrock cache-point markers to the last + second-to-last user messages. */
export function applyCacheControlToMessages(messages: Message[], userIndices: [number, number]): Message[] {
	const [, lastUserMsgIndex] = userIndices
	const secondLastMsgUserIndex = userIndices[0] ?? -1
	return messages.map((message, index) => {
		if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
			const messageWithCache = { ...message }
			if (messageWithCache.content && Array.isArray(messageWithCache.content)) {
				messageWithCache.content = [
					...messageWithCache.content,
					{ cachePoint: { type: "default" } } as CachePointContentBlockShape,
				]
			}
			return messageWithCache
		}
		return message
	})
}
