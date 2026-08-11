/**
 * Bedrock ConverseStream chunk parser. Extracted from `bedrock.ts` (FB-15b).
 */
import { calculateApiCostOpenAI } from "@utils/cost"
import type { ModelInfo } from "@shared/api"

interface ExtendedMetadata {
	usage?: {
		inputTokens?: number
		outputTokens?: number
		cacheReadInputTokens?: number
		cacheWriteInputTokens?: number
	}
	additionalModelResponseFields?: {
		thinkingResponse?: {
			reasoning?: Array<{
				type: string
				text?: string
				signature?: string
			}>
		}
	}
}

interface ContentBlockStart {
	contentBlockIndex?: number
	start?: {
		type?: string
		thinking?: string
		signature?: string
		toolUse?: ToolUseStart
	}
	contentBlock?: {
		type?: string
		thinking?: string
		signature?: string
	}
	type?: string
	thinking?: string
	// Redacted thinking block data
	data?: string
}

interface ContentBlockDelta {
	contentBlockIndex?: number
	delta?: {
		type?: string
		thinking?: string
		text?: string
		signature?: string
		reasoningContent?: {
			text?: string
		}
		toolUse?: ToolUseDelta
	}
}

interface ToolUseStart {
	toolUseId: string
	name: string
}

interface ToolUseDelta {
	input: string
}

export class BedrockStreamParser {
	private contentBuffers: Record<number, string> = {}
	private blockTypes = new Map<number, "reasoning" | "text">()
	private activeToolCalls: Map<number, { toolUseId: string; name: string }> = new Map()

	public *parseChunk(chunk: any, modelInfo: ModelInfo): Generator<any> {
		yield* this.handleMetadata(chunk, modelInfo)
		yield* this.handleContentBlockStart(chunk)
		yield* this.handleContentBlockDelta(chunk)
		yield* this.handleContentBlockStop(chunk)
		yield* this.handleStreamError(chunk)
	}

	private *handleMetadata(chunk: any, modelInfo: ModelInfo): Generator<any> {
		const metadata = chunk.metadata as ExtendedMetadata | undefined
		if (metadata?.additionalModelResponseFields?.thinkingResponse) {
			yield* this.parseThinkingResponse(metadata.additionalModelResponseFields.thinkingResponse)
		}
		if (chunk.metadata?.usage) yield this.buildUsageChunk(chunk.metadata.usage, modelInfo)
	}

	private *parseThinkingResponse(thinkingResponse: any): Generator<any> {
		if (!thinkingResponse.reasoning || !Array.isArray(thinkingResponse.reasoning)) return
		for (const block of thinkingResponse.reasoning) {
			if (block.type === "text" && block.text) {
				yield { type: "reasoning", reasoning: block.text, ...(block.signature ? { signature: block.signature } : {}) }
			}
		}
	}

	private buildUsageChunk(usage: any, modelInfo: ModelInfo): any {
		const inputTokens = usage.inputTokens || 0
		const outputTokens = usage.outputTokens || 0
		const cacheReadInputTokens = usage.cacheReadInputTokens || 0
		const cacheWriteInputTokens = usage.cacheWriteInputTokens || 0
		return {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheReadTokens: cacheReadInputTokens,
			cacheWriteTokens: cacheWriteInputTokens,
			totalCost: calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteInputTokens, cacheReadInputTokens),
		}
	}

	private *handleContentBlockStart(chunk: any): Generator<any> {
		if (!chunk.contentBlockStart) return
		const blockStart = chunk.contentBlockStart as ContentBlockStart
		const blockIndex = chunk.contentBlockStart.contentBlockIndex
		if (blockStart.start?.toolUse?.toolUseId && blockStart.start.toolUse.name && blockIndex !== undefined) {
			this.activeToolCalls.set(blockIndex, {
				toolUseId: blockStart.start.toolUse.toolUseId,
				name: blockStart.start.toolUse.name,
			})
		}
		yield* this.handleThinkingBlockStart(blockStart, blockIndex)
		yield* this.handleRedactedThinkingBlockStart(blockStart)
	}

	private *handleThinkingBlockStart(blockStart: ContentBlockStart, blockIndex: number | undefined): Generator<any> {
		const isThinking =
			blockStart.start?.type === "thinking" ||
			blockStart.contentBlock?.type === "thinking" ||
			blockStart.type === "thinking"
		if (!isThinking || blockIndex === undefined) return
		this.blockTypes.set(blockIndex, "reasoning")
		const signature = blockStart.start?.signature || blockStart.contentBlock?.signature || undefined
		const initialContent = blockStart.start?.thinking || blockStart.contentBlock?.thinking || blockStart.thinking || ""
		if (initialContent || signature) {
			yield { type: "reasoning", reasoning: initialContent || "", ...(signature ? { signature } : {}) }
		}
	}

	private *handleRedactedThinkingBlockStart(blockStart: ContentBlockStart): Generator<any> {
		const isRedacted =
			blockStart.start?.type === "redacted_thinking" ||
			blockStart.contentBlock?.type === "redacted_thinking" ||
			blockStart.type === "redacted_thinking"
		if (!isRedacted) return
		yield {
			type: "reasoning",
			reasoning: "[Redacted thinking block]",
			...(blockStart.data ? { redacted_data: blockStart.data } : {}),
		}
	}

	private *handleContentBlockDelta(chunk: any): Generator<any> {
		if (!chunk.contentBlockDelta) return
		const blockIndex = chunk.contentBlockDelta.contentBlockIndex
		if (blockIndex === undefined) return
		if (!(blockIndex in this.contentBuffers)) this.contentBuffers[blockIndex] = ""

		const blockType = this.blockTypes.get(blockIndex)
		const delta = chunk.contentBlockDelta.delta as ContentBlockDelta["delta"]
		yield* this.parseDelta(delta, blockIndex, blockType, chunk)
	}

	private *parseDelta(
		delta: ContentBlockDelta["delta"],
		blockIndex: number,
		blockType: "reasoning" | "text" | undefined,
		chunk: any,
	): Generator<any> {
		if (delta?.type === "signature_delta" && delta?.signature) {
			yield { type: "reasoning", reasoning: "", signature: delta.signature }
			return
		}
		if (delta?.type === "thinking_delta" || delta?.thinking) {
			const thinkingContent = delta.thinking || delta.text || ""
			if (thinkingContent) yield { type: "reasoning", reasoning: thinkingContent }
			return
		}
		if (delta?.reasoningContent?.text) {
			yield { type: "reasoning", reasoning: delta.reasoningContent.text }
			return
		}
		if (delta?.toolUse?.input !== undefined) {
			yield* this.parseToolUseDelta(delta.toolUse.input, blockIndex)
			return
		}
		if (chunk.contentBlockDelta.delta?.text) {
			yield* this.parseTextDelta(chunk.contentBlockDelta.delta.text, blockIndex, blockType)
		}
	}

	private *parseToolUseDelta(toolInput: any, blockIndex: number): Generator<any> {
		const toolCall = this.activeToolCalls.get(blockIndex)
		if (!toolCall || typeof toolInput !== "string") return
		yield {
			type: "tool_calls",
			tool_call: {
				call_id: toolCall.toolUseId,
				function: { id: toolCall.toolUseId, name: toolCall.name, arguments: toolInput },
			},
		}
	}

	private *parseTextDelta(
		textContent: string,
		blockIndex: number,
		blockType: "reasoning" | "text" | undefined,
	): Generator<any> {
		this.contentBuffers[blockIndex] += textContent
		yield blockType === "reasoning" ? { type: "reasoning", reasoning: textContent } : { type: "text", text: textContent }
	}

	private *handleContentBlockStop(chunk: any): Generator<void> {
		if (!chunk.contentBlockStop) return
		const blockIndex = chunk.contentBlockStop.contentBlockIndex
		if (blockIndex === undefined) return
		delete this.contentBuffers[blockIndex]
		this.blockTypes.delete(blockIndex)
		this.activeToolCalls.delete(blockIndex)
	}

	private *handleStreamError(chunk: any): Generator<any> {
		if (chunk.internalServerException) {
			yield { type: "text", text: `[ERROR] Internal server error: ${chunk.internalServerException.message}` }
		} else if (chunk.modelStreamErrorException) {
			yield { type: "text", text: `[ERROR] Model stream error: ${chunk.modelStreamErrorException.message}` }
		} else if (chunk.validationException) {
			const message = chunk.validationException.message || ""
			const isContextError = /input.*too long|context.*exceed|maximum.*token|input length.*max.*tokens/i.test(message)
			if (isContextError) throw chunk.validationException
			yield { type: "text", text: `[ERROR] Validation error: ${message}` }
		} else if (chunk.throttlingException) {
			yield { type: "text", text: `[ERROR] Throttling error: ${chunk.throttlingException.message}` }
		} else if (chunk.serviceUnavailableException) {
			yield { type: "text", text: `[ERROR] Service unavailable: ${chunk.serviceUnavailableException.message}` }
		}
	}
}
