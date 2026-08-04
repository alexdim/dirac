import {
	ModelInfo,
	type OpenAiNativeModelId,
	type OpenAiNativeModelInfo,
	openAiNativeDefaultModelId,
	openAiNativeModels,
} from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import OpenAI from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool } from "openai/resources/chat/completions"
import { featureFlagsService } from "@/services/feature-flags"
import { DiracStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiFormat } from "@/shared/proto/dirac/models"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { isParallelToolCallingEnabled } from "@/utils/model-utils"
import {
	ApiHandler,
	CommonApiHandlerOptions,
	type ApiConversationCompactionRequest,
	type ApiConversationCompactionResult,
	type ApiConversationRequestOptions,
} from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { formatOpenAiCompatibleUsage } from "../transform/openai-usage"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"
import {
	buildResponseCreateParams,
	mapResponseTools,
	processResponsesEvents,
	ResponsesWebsocketManager,
	shouldRetryWithFullContext,
} from "./openai-responses-utils"

interface OpenAiNativeHandlerOptions extends CommonApiHandlerOptions {
	openAiNativeApiKey?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	apiModelId?: string
	openAiNativeUseResponsesWebsocket?: boolean
}

export class OpenAiNativeHandler implements ApiHandler {
	private responsesWsManager: ResponsesWebsocketManager | undefined
	private options: OpenAiNativeHandlerOptions
	private client: OpenAI | undefined
	// Removed unused websocket state properties
	private abortController?: AbortController
	private getResponsesWsManager(): ResponsesWebsocketManager {
		if (!this.responsesWsManager) {
			this.responsesWsManager = new ResponsesWebsocketManager({
				apiKey: this.options.openAiNativeApiKey || "",
			})
		}
		return this.responsesWsManager
	}

	private useWebsocketMode(apiFormat?: ApiFormat): boolean {
		if (featureFlagsService.getBooleanFlagEnabled(FeatureFlag.OPENAI_RESPONSES_WEBSOCKET_MODE)) {
			return apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
		}
		return false
	}


	private isCurrentModelResponse(message: DiracStorageMessage, modelId: OpenAiNativeModelId): boolean {
		return (
			message.id?.startsWith("resp_") === true &&
			message.modelInfo?.providerId === "openai-native" &&
			message.modelInfo.modelId === modelId
		)
	}
	constructor(options: OpenAiNativeHandlerOptions) {
		this.options = options
	}

	private shouldEnableParallelToolCalling(): boolean {
		return isParallelToolCallingEnabled(this.options.enableParallelToolCalling ?? false)
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiNativeApiKey) {
				throw new Error("OpenAI API key is required")
			}
			try {
				this.client = createOpenAIClient({
					apiKey: this.options.openAiNativeApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating OpenAI client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		if (!usage) return
		yield formatOpenAiCompatibleUsage(usage, info)
	}

	async compactConversation(request: ApiConversationCompactionRequest): Promise<ApiConversationCompactionResult> {
		const model = this.getModel()
		const apiFormat = model.info.apiFormat
		if (apiFormat !== ApiFormat.OPENAI_RESPONSES && apiFormat !== ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE) {
			throw new Error("OpenAI Native conversation compaction requires the Responses API")
		}

		const finalTools = [...((request.tools ?? []) as ChatCompletionTool[]), { type: "web_search" } as any]
		const responseTools = mapResponseTools(finalTools, model.info.supportsStrictTools)
		const input = [
			...(request.checkpoint?.input ?? []),
			...convertToOpenAIResponsesInput(request.messages).input,
		]
		const fullParams = buildResponseCreateParams({
			modelId: model.id,
			systemPrompt: request.systemPrompt,
			input: input as any,
			tools: responseTools,
			reasoningEffort: this.options.reasoningEffort,
			reasoningContext: model.info.supportsPersistedReasoning ? "all_turns" : undefined,
			enableParallelToolCalling: this.shouldEnableParallelToolCalling(),
		})
		const { stream, store, previous_response_id, ...compactParams } = fullParams as any
		void stream
		void store
		void previous_response_id

		this.abortController = new AbortController()
		try {
			const data = await this.ensureClient().responses.compact(compactParams, { signal: this.abortController.signal })
			const output = (data as any).output
			if (!Array.isArray(output)) throw new Error("OpenAI compact response did not contain replacement input items")
			const opaqueItem = output.find((item: any) => item?.type === "compaction")
			if (!opaqueItem || typeof opaqueItem.encrypted_content !== "string") {
				throw new Error("OpenAI compact response did not contain opaque compaction state")
			}
			this.responsesWsManager?.close()
			return { input: output }
		} finally {
			this.abortController = undefined
		}
	}


	@withRetry()
	async *createMessage(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools?: ChatCompletionTool[],
		options?: ApiConversationRequestOptions,
	): ApiStream {
		const finalTools = [...(tools || [])]
		finalTools.push({ type: "web_search" } as any)
		const apiFormat = this.getModel()?.info?.apiFormat
		if (apiFormat === ApiFormat.OPENAI_RESPONSES || apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE) {
			if (!tools?.length) {
				throw new Error("Native Tool Call must be enabled in your setting for OpenAI Responses API")
			}
			yield* this.createResponseStream(systemPrompt, messages, finalTools, options)
			return
		}
		yield* this.createCompletionStream(systemPrompt, messages, finalTools)
	}

	private async *createCompletionStream(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools?: ChatCompletionTool[],
	): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const toolCallProcessor = new ToolCallProcessor()
		this.abortController = new AbortController()

		// Handle o1 models separately as they don't support streaming
		if (model.info.supportsStreaming === false) {
			const response = await client.chat.completions.create(
				{
					model: model.id,
					messages: [{ role: "user", content: systemPrompt }, ...convertToOpenAiMessages(messages, "openai-native")],
				},
				{ signal: this.abortController?.signal },
			)
			yield {
				type: "text",
				text: response.choices[0]?.message.content || "",
			}
			yield* this.yieldUsage(model.info, response.usage)
			return
		}

		const systemRole = model.info.systemRole ?? "system"
		const includeReasoning = model.info.supportsReasoningEffort
		const includeTools = model.info.supportsTools ?? true
		const requestedEffort = normalizeOpenaiReasoningEffort(this.options.reasoningEffort)
		const reasoningEffort =
			includeReasoning && requestedEffort !== "none" ? (requestedEffort as ChatCompletionReasoningEffort) : undefined

		const stream = await client.chat.completions.create(
			{
				model: model.id,
				messages: [{ role: systemRole, content: systemPrompt }, ...convertToOpenAiMessages(messages, "openai-native")],
				stream: true,
				stream_options: { include_usage: true },
				reasoning_effort: reasoningEffort,
				...(model.info.temperature !== undefined ? { temperature: model.info.temperature } : {}),
				...(includeTools ? getOpenAIToolParams(tools, this.shouldEnableParallelToolCalling()) : {}),
			},
			{ signal: this.abortController.signal },
		)

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				// Only last chunk contains usage
				yield* this.yieldUsage(model.info, chunk.usage)
			}
		}
	}

	private async *createResponseStream(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools: ChatCompletionTool[],
		options?: ApiConversationRequestOptions,
	): ApiStream {
		const model = this.getModel()
		const usePersistedReasoning = model.info.supportsPersistedReasoning === true
		const useWebsocket = this.useWebsocketMode(model.info.apiFormat) && !usePersistedReasoning
		const usePreviousResponseId = !options?.breakProviderContinuation && (usePersistedReasoning || useWebsocket)

		if (options?.breakProviderContinuation) this.responsesWsManager?.close()
		if (useWebsocket) {
			this.getResponsesWsManager()
				.ensureWebsocket()
				.catch((error) => Logger.debug("OpenAI websocket preconnect failed:", error))
		}

		const converted = convertToOpenAIResponsesInput(messages, {
			usePreviousResponseId,
			canUsePreviousResponse: usePersistedReasoning
				? (message) => this.isCurrentModelResponse(message, model.id)
				: undefined,
		})
		const fullInput = [
			...(options?.checkpoint?.input ?? []),
			...convertToOpenAIResponsesInput(messages).input,
		]
		const input = converted.previousResponseId ? converted.input : fullInput
		const fallbackInput = fullInput
		const responseTools = mapResponseTools(tools, model.info.supportsStrictTools)
		this.abortController = new AbortController()

		const params = buildResponseCreateParams({
			modelId: model.id,
			systemPrompt,
			input: input as any,
			previousResponseId: converted.previousResponseId,
			tools: responseTools,
			reasoningEffort: this.options.reasoningEffort,
			reasoningContext: usePersistedReasoning ? "all_turns" : undefined,
			store: usePersistedReasoning ? true : undefined,
			enableParallelToolCalling: this.shouldEnableParallelToolCalling(),
		})
		const fallbackParams = buildResponseCreateParams({
			modelId: model.id,
			systemPrompt,
			input: fallbackInput as any,
			tools: responseTools,
			reasoningEffort: this.options.reasoningEffort,
			reasoningContext: usePersistedReasoning ? "all_turns" : undefined,
			store: usePersistedReasoning ? true : undefined,
			enableParallelToolCalling: this.shouldEnableParallelToolCalling(),
		})

		if (usePersistedReasoning) {
			const functionCallOutputs = input.filter((item: any) => item.type === "function_call_output").length
			Logger.log(
				`[OpenAI Native persisted reasoning] request=${converted.previousResponseId ? "continuation" : "full_context"} input_items=${input.length} function_call_outputs=${functionCallOutputs}`,
			)
		}

		if (useWebsocket && converted.previousResponseId) {
			let didEmitWebsocketOutput = false
			try {
				try {
					const wsManager = this.getResponsesWsManager()
					for await (const chunk of processResponsesEvents(wsManager.createResponseEvents(params), model.info)) {
						didEmitWebsocketOutput = true
						yield chunk
					}
					return
				} catch (error) {
					if (!didEmitWebsocketOutput && shouldRetryWithFullContext(error, !!params.previous_response_id)) {
						Logger.log("Retrying websocket response with full context after previous_response_not_found or 404")
						this.responsesWsManager?.close()
						const wsManager = this.getResponsesWsManager()
						for await (const chunk of processResponsesEvents(
							wsManager.createResponseEvents(fallbackParams),
							model.info,
						)) {
							didEmitWebsocketOutput = true
							yield chunk
						}
						return
					}
					throw error
				}
			} catch (error) {
				if (didEmitWebsocketOutput) throw error
				Logger.error("OpenAI websocket mode failed, falling back to HTTP Responses API:", error)
				this.responsesWsManager?.close()
			}
		}

		let didEmitHttpOutput = false
		try {
			for await (const chunk of this.createResponseStreamHttp(params, model.info)) {
				didEmitHttpOutput = true
				yield chunk
			}
		} catch (error) {
			if (!didEmitHttpOutput && shouldRetryWithFullContext(error, !!params.previous_response_id)) {
				Logger.log("Retrying HTTP response with full context after previous_response_not_found or 404")
				yield* this.createResponseStreamHttp(fallbackParams, model.info)
				return
			}
			throw error
		}
	}

	private async *createResponseStreamHttp(
		params: OpenAI.Responses.ResponseCreateParamsStreaming,
		modelInfo: ModelInfo,
	): ApiStream {
		const client = this.ensureClient()
		const stream = await client.responses.create(params, { signal: this.abortController?.signal })
		yield* processResponsesEvents(stream, modelInfo)
	}

	abort(): void {
		this.responsesWsManager?.close()
		this.abortController?.abort()
		this.abortController = undefined
	}

	getModel(): { id: OpenAiNativeModelId; info: OpenAiNativeModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiNativeModels) {
			const id = modelId as OpenAiNativeModelId
			const info = openAiNativeModels[id]
			return { id, info: { ...info, supportsStrictTools: true } }
		}
		return {
			id: openAiNativeDefaultModelId,
			info: { ...openAiNativeModels[openAiNativeDefaultModelId], supportsStrictTools: true },
		}
	}
}
