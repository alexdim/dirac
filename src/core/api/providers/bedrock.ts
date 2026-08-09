// Import proper AWS SDK types

import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import type { ContentBlock, Message, ToolConfiguration } from "@aws-sdk/client-bedrock-runtime"
import {
	BedrockRuntimeClient,
	ConversationRole,
	ConverseCommand,
	ConverseStreamCommand,
	InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime"
import {
	type BedrockModelId,
	bedrockDefaultModelId,
	bedrockModels,
	isAnthropicAdaptiveThinkingSupported,
	type ModelInfo,
} from "@shared/api"
import { calculateApiCostOpenAI, calculateApiCostQwen } from "@utils/cost"
import { estimateTokenCount, extractNonStreamingContent, formatConverseError, prepareSystemMessages, chunkText } from "./bedrock-converse-utils"
import { createBedrockClient, resolveAwsCredentials } from "./bedrock-client"
import { BedrockStreamParser } from "./bedrock-stream-parser"
import { ExtensionRegistryInfo } from "@/registry"
import { getErrorMessage } from "@/shared/errors"
import type { DiracStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import type { DiracTool } from "@/shared/tools"
import type { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToR1Format } from "../transform/r1-format"
import type { ApiStream } from "../transform/stream"

const BEDROCK_USER_AGENT_APP_ID = `dirac#${ExtensionRegistryInfo.version}`

export interface AwsBedrockHandlerOptions extends CommonApiHandlerOptions {
	apiModelId?: string
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	awsAuthentication?: string
	awsBedrockApiKey?: string
	awsUseCrossRegionInference?: boolean
	awsUseGlobalInference?: boolean
	awsBedrockUsePromptCache?: boolean
	awsUseProfile?: boolean
	awsProfile?: string
	awsBedrockEndpoint?: string
	awsBedrockCustomSelected?: boolean
	awsBedrockCustomModelBaseId?: string
	thinkingBudgetTokens?: number
	reasoningEffort?: string
}

export interface BedrockMessageConfig {
	systemPrompt: string
	messages: DiracStorageMessage[]
	modelId: string
	model: { id: string; info: ModelInfo }
	tools?: DiracTool[]
	abortSignal?: AbortSignal
}







type SupportedContentType = "text" | "image" | "thinking" | "redacted_thinking" | "document"

interface ContentItem {
	type: SupportedContentType
	text?: string
	source?: {
		data: string | Buffer | Uint8Array
		media_type?: string
	}
}

// Define cache point type for AWS Bedrock
interface CachePointContentBlock {
	cachePoint: {
		type: "default"
	}
}

// Define provider options type based on AWS SDK patterns

// a special jp inference profile was created for sonnet 4.6, opus 4.6, sonnet 4.5 & haiku 4.5
// https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html
const JP_SUPPORTED_CRIS_MODELS = [
	"anthropic.claude-sonnet-4-6",
	"anthropic.claude-opus-4-6-v1",
	"anthropic.claude-sonnet-4-5-20250929-v1:0",
	"anthropic.claude-haiku-4-5-20251001-v1:0",
	"anthropic.claude-sonnet-5",
]

// Parses Bedrock ConverseStream events into Dirac ApiStreamChunk objects.
// Tracks per-block state (content buffers, block types, active tool calls) across the stream.


// https://docs.anthropic.com/en/api/claude-on-amazon-bedrock
export class AwsBedrockHandler implements ApiHandler {
	private options: AwsBedrockHandlerOptions
	private abortController?: AbortController

	constructor(options: AwsBedrockHandlerOptions) {
		this.options = options
	}

	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: DiracTool[]): ApiStream {
		const abortController = new AbortController()
		this.abortController = abortController
		try {
			yield* this.createMessageWithSignal(systemPrompt, messages, tools, abortController.signal)
		} finally {
			if (this.abortController === abortController) this.abortController = undefined
		}
	}

	@withRetry({ maxRetries: 4 })
	private async *createMessageWithSignal(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools: DiracTool[] | undefined,
		signal: AbortSignal,
	): ApiStream {
		signal.throwIfAborted()
		// cross region inference requires prefixing the model id with the region
		const modelId = await this.getModelId()

		const model = this.getModel()

		// This baseModelId is used to indicate the capabilities of the model.
		// If the user selects a custom model, baseModelId will be set to the base model ID of the custom model.
		// Otherwise, baseModelId will be the same as modelId.
		const baseModelId =
			(this.options.awsBedrockCustomSelected ? this.options.awsBedrockCustomModelBaseId : modelId) || modelId

		const baseConfig = { systemPrompt, messages, modelId, model, tools, abortSignal: signal }

		// Check if this is an Amazon Nova model
		if (baseModelId.includes("amazon.nova")) {
			yield* this.createNovaMessage(baseConfig)
			return
		}

		if (baseModelId.includes("openai")) {
			yield* this.createOpenAIMessage(baseConfig)
			return
		}

		// Check if this is a Qwen model
		if (baseModelId.includes("qwen")) {
			yield* this.createQwenMessage(baseConfig)
			return
		}

		// Check if this is a Deepseek model
		if (baseModelId.includes("deepseek")) {
			yield* this.createDeepseekMessage(baseConfig)
			return
		}

		// Default: Use Anthropic Converse API for all Anthropic models
		yield* this.createAnthropicMessage(baseConfig)
	}

	abort(): void {
		this.abortController?.abort()
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId) {
			// Direct match in model map
			if (modelId in bedrockModels) {
				return { id: modelId as BedrockModelId, info: bedrockModels[modelId as BedrockModelId] }
			}

			// Strip cross-region/global inference prefix (e.g. "us.", "eu.", "ap.", "apac.", "jp.", "global.")
			// so "us.anthropic.claude-sonnet-4-6" resolves to "anthropic.claude-sonnet-4-6" for capability info
			// but the original prefixed ID is returned for the actual API call
			const stripped = modelId.replace(/^(us|eu|ap|apac|jp|global)\./, "")
			if (stripped !== modelId && stripped in bedrockModels) {
				return { id: modelId, info: bedrockModels[stripped as BedrockModelId] }
			}
		}

		const customSelected = this.options.awsBedrockCustomSelected
		const baseModel = this.options.awsBedrockCustomModelBaseId

		// Handle custom models
		if (customSelected && modelId) {
			// If base model is provided and valid, use its capabilities
			if (baseModel && baseModel in bedrockModels) {
				return {
					id: modelId,
					info: bedrockModels[baseModel as BedrockModelId],
				}
			}
			// For custom models without valid base model in bedrock model list, use default model's capabilities
			return {
				id: modelId,
				info: bedrockModels[bedrockDefaultModelId],
			}
		}

		return {
			id: bedrockDefaultModelId,
			info: bedrockModels[bedrockDefaultModelId],
		}
	}

	// Default AWS region
	private static readonly DEFAULT_REGION = "us-east-1"

	/**
	 * Gets AWS credentials using the provider chain
	 * Centralizes credential retrieval logic for all AWS services
	 */

	/**
	 * Gets the AWS region to use, with fallback to default
	 */
	private getRegion(): string {
		return this.options.awsRegion || AwsBedrockHandler.DEFAULT_REGION
	}

	/**
	 * Creates a BedrockRuntimeClient with the appropriate credentials
	 */
	/** Resolves AWS credentials for this handler from options or the node provider chain. */
	public getAwsCredentials(): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }> {
		return resolveAwsCredentials(this.options, this.getRegion(), BEDROCK_USER_AGENT_APP_ID)
	}

	private async getBedrockClient(): Promise<BedrockRuntimeClient> {
		return createBedrockClient(this.options, AwsBedrockHandler.DEFAULT_REGION, BEDROCK_USER_AGENT_APP_ID)
	}

	/**
	 * Gets the appropriate model ID, accounting for cross-region inference if enabled.
	 * For custom models, returns the raw model ID without any encoding.
	 */
	async getModelId(): Promise<string> {
		if (!this.options.awsBedrockCustomSelected && this.options.awsUseCrossRegionInference) {
			if (this.getModel().info.supportsGlobalEndpoint && this.options.awsUseGlobalInference) {
				return `global.${this.getModel().id}`
			}
			const regionPrefix = this.getRegion().slice(0, 3)
			switch (regionPrefix) {
				case "us-":
					return `us.${this.getModel().id}`
				case "eu-":
					return `eu.${this.getModel().id}`
				case "ap-":
					if (JP_SUPPORTED_CRIS_MODELS.includes(this.getModel().id)) {
						return `jp.${this.getModel().id}`
					}
					return `apac.${this.getModel().id}`
				default:
					// cross region inference is not supported in this region, falling back to default model
					return this.getModel().id
			}
		}
		return this.getModel().id
	}

	/**
	 * Creates a message using the Deepseek R1 model through AWS Bedrock.
	 * DeepSeek R1 uses InvokeModelWithResponseStream (not the Converse API)
	 * and does not support native tool calling, so tools are intentionally unused.
	 */
	private async *createDeepseekMessage(config: BedrockMessageConfig): ApiStream {
		const { systemPrompt, messages, modelId, model, abortSignal } = config
		// Get Bedrock client with proper credentials
		const client = await this.getBedrockClient()
		try {
			// Format prompt for DeepSeek R1 according to documentation
			const formattedPrompt = this.formatDeepseekR1Prompt(systemPrompt, messages)

			// Prepare the request based on DeepSeek R1's expected format
			const command = new InvokeModelWithResponseStreamCommand({
				modelId: modelId,
				contentType: "application/json",
				accept: "application/json",
				body: JSON.stringify({
					prompt: formattedPrompt,
					max_tokens: model.info.maxTokens || 8000,
					temperature: model.info.temperature ?? 0,
				}),
			})

			// Track token usage
			const inputTokenEstimate = this.estimateInputTokens(systemPrompt, messages)
			let outputTokens = 0
			let isFirstChunk = true
			let accumulatedTokens = 0
			const TOKEN_REPORT_THRESHOLD = 100 // Report usage after accumulating this many tokens

			// Execute the streaming request
			const response = await client.send(command, { abortSignal })

			if (response.body) {
				for await (const chunk of response.body) {
					if (chunk.chunk?.bytes) {
						try {
							// Parse the response chunk
							const decodedChunk = new TextDecoder().decode(chunk.chunk.bytes)
							const parsedChunk = JSON.parse(decodedChunk)

							// Report usage on first chunk
							if (isFirstChunk) {
								isFirstChunk = false
								const totalCost = calculateApiCostOpenAI(model.info, inputTokenEstimate, 0, 0, 0)
								yield {
									type: "usage",
									inputTokens: inputTokenEstimate,
									outputTokens: 0,
									totalCost: totalCost,
								}
							}

							// Handle DeepSeek R1 response format
							if (parsedChunk.choices && parsedChunk.choices.length > 0) {
								// For non-streaming response (full response)
								const text = parsedChunk.choices[0].text
								if (text) {
									const chunkTokens = estimateTokenCount(text)
									outputTokens += chunkTokens
									accumulatedTokens += chunkTokens

									yield {
										type: "text",
										text: text,
									}

									if (accumulatedTokens >= TOKEN_REPORT_THRESHOLD) {
										const totalCost = calculateApiCostOpenAI(model.info, 0, accumulatedTokens, 0, 0)
										yield {
											type: "usage",
											inputTokens: 0,
											outputTokens: accumulatedTokens,
											totalCost: totalCost,
										}
										accumulatedTokens = 0
									}
								}
							} else if (parsedChunk.delta?.text) {
								// For streaming response (delta updates)
								const text = parsedChunk.delta.text
								const chunkTokens = estimateTokenCount(text)
								outputTokens += chunkTokens
								accumulatedTokens += chunkTokens

								yield {
									type: "text",
									text: text,
								}
								// Report aggregated token usage only when threshold is reached
								if (accumulatedTokens >= TOKEN_REPORT_THRESHOLD) {
									const totalCost = calculateApiCostOpenAI(model.info, 0, accumulatedTokens, 0, 0)
									yield {
										type: "usage",
										inputTokens: 0,
										outputTokens: accumulatedTokens,
										totalCost: totalCost,
									}
									accumulatedTokens = 0
								}
							}
						} catch (error) {
							Logger.error("Error parsing Deepseek response chunk:", error)
							// Propagate the error by yielding a text response with error information
							yield {
								type: "text",
								text: `[ERROR] Failed to parse Deepseek response: ${getErrorMessage(error)}`,
							}
						}
					}
				}

				// Report any remaining accumulated tokens at the end of the stream
				if (accumulatedTokens > 0) {
					const totalCost = calculateApiCostOpenAI(model.info, 0, accumulatedTokens, 0, 0)
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: accumulatedTokens,
						totalCost: totalCost,
					}
				}

				// Add final total cost calculation that includes both input and output tokens
				const finalTotalCost = calculateApiCostOpenAI(model.info, inputTokenEstimate, outputTokens, 0, 0)
				yield {
					type: "usage",
					inputTokens: inputTokenEstimate,
					outputTokens: outputTokens,
					totalCost: finalTotalCost,
				}
			}
		} finally {
			client.destroy()
		}
	}

	/**
	 * Formats prompt for DeepSeek R1 model according to documentation
	 * First uses convertToR1Format to merge consecutive messages with the same role,
	 * then converts to the string format that DeepSeek R1 expects
	 */
	private formatDeepseekR1Prompt(systemPrompt: string, messages: DiracStorageMessage[]): string {
		// First use convertToR1Format to merge consecutive messages with the same role
		const r1Messages = convertToR1Format(
			[{ role: "user", content: systemPrompt }, ...messages],
			this.getModel().info.supportsImages !== false,
		)

		// Then convert to the special string format expected by DeepSeek R1
		let combinedContent = ""

		for (const message of r1Messages) {
			let content = ""

			if (message.content) {
				if (typeof message.content === "string") {
					content = message.content
				} else {
					// Extract text content from message parts
					content = message.content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n")
				}
			}

			combinedContent += message.role === "user" ? "User: " + content + "\n" : "Assistant: " + content + "\n"
		}

		// Format according to DeepSeek R1's expected prompt format
		return `<｜begin▁of▁sentence｜><｜User｜>${combinedContent}<｜Assistant｜><think>\n`
	}

	/**
	 * Estimates token count based on text length (approximate)
	 * Note: This is a rough estimation, as the actual token count depends on the tokenizer
	 */
	private estimateInputTokens(systemPrompt: string, messages: DiracStorageMessage[]): number {
		// For Deepseek R1, we estimate the token count of the formatted prompt
		// The formatted prompt includes special tokens and consistent formatting
		const formattedPrompt = this.formatDeepseekR1Prompt(systemPrompt, messages)
		return Math.ceil(formattedPrompt.length / 4)
	}

	/**
	 * Estimates token count for a text string
	 */

	/**
	 * Converts Dirac's tool definitions (Anthropic format with `input_schema`) to the
	 * Bedrock Converse API `ToolConfiguration` shape. Returns `undefined` when no tools
	 * are provided so callers can conditionally spread into the command params.
	 */
	private mapDiracToolsToBedrockToolConfig(tools?: DiracTool[]): ToolConfiguration | undefined {
		if (!tools || tools.length === 0) {
			return undefined
		}

		const isAnthropicTool = (tool: DiracTool): tool is AnthropicTool => "input_schema" in tool

		const bedrockTools = tools.filter(isAnthropicTool).map((tool) => {
			return {
				toolSpec: {
					name: tool.name,
					description: tool.description || tool.name || "Tool",
					inputSchema: {
						json: tool.input_schema,
					},
				},
			}
		})

		if (bedrockTools.length === 0) {
			return undefined
		}

		const toolConfig: ToolConfiguration = {
			tools: bedrockTools as unknown as ToolConfiguration["tools"],
			toolChoice: { auto: {} },
		}

		return toolConfig
	}

	/**
	 * Executes a Converse API stream command and handles the response
	 * Common implementation for both Anthropic and Nova models
	 */
	private async *executeConverseStream(
		command: ConverseStreamCommand,
		modelInfo: ModelInfo,
		abortSignal?: AbortSignal,
	): ApiStream {
		const client = await this.getBedrockClient()
		try {
			const response = await client.send(command, { abortSignal })
			if (!response.stream) return

			const parser = new BedrockStreamParser()
			for await (const chunk of response.stream) {
				yield* parser.parseChunk(chunk, modelInfo)
			}
		} finally {
			client.destroy()
		}
	}

	/**
	 * Prepares system messages with optional caching support
	 */

	/**
	 * Gets inference configuration for different model types
	 */
	private getInferenceConfig(modelInfo: ModelInfo, modelType: "anthropic" | "nova"): any {
		// For Anthropic models with thinking enabled, temperature must be 1
		if (modelType === "anthropic") {
			const budget_tokens = this.options.thinkingBudgetTokens || 0
			const reasoningOn = modelInfo.supportsReasoning && budget_tokens > 0

			return {
				maxTokens: modelInfo.maxTokens || 8192,
				temperature: reasoningOn ? undefined : (modelInfo.temperature ?? undefined),
			}
		}

		return {
			maxTokens: modelInfo.maxTokens || (modelType === "nova" ? 5000 : 8192),
			temperature: modelInfo.temperature ?? 0,
		}
	}

	/**
	 * Creates a message using Anthropic Claude models through AWS Bedrock Converse API
	 * Implements support for Anthropic Claude models using the unified Converse API
	 */
	private async *createAnthropicMessage(config: BedrockMessageConfig): ApiStream {
		const { systemPrompt, messages, modelId, model, tools } = config
		// Format messages for Anthropic model using unified formatter
		const formattedMessages = this.formatMessagesForConverseAPI(messages, model.info.supportsImages !== false)

		// Get model info and message indices for caching
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Apply caching controls to messages if enabled
		const messagesWithCache = this.options.awsBedrockUsePromptCache
			? this.applyCacheControlToMessages(formattedMessages, [secondLastMsgUserIndex, lastUserMsgIndex])
			: formattedMessages

		// Prepare system message with caching support
		const systemMessages = prepareSystemMessages(systemPrompt, this.options.awsBedrockUsePromptCache || false)

		// Get thinking configuration
		const budget_tokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = model.info.supportsReasoning && budget_tokens > 0
		const useAdaptive = isAnthropicAdaptiveThinkingSupported(modelId, model.info)

		// Prepare request for Anthropic model using Converse API
		const toolConfig = this.mapDiracToolsToBedrockToolConfig(tools)
		const command = new ConverseStreamCommand({
			modelId: modelId,
			messages: messagesWithCache,
			system: systemMessages,
			inferenceConfig: this.getInferenceConfig(model.info, "anthropic"),
			...(toolConfig ? { toolConfig } : {}),
			additionalModelRequestFields: {
				// Add thinking configuration as per LangChain documentation
				...(reasoningOn && {
					thinking: useAdaptive
						? { type: "adaptive", display: "summarized" }
						: { type: "enabled", budget_tokens: budget_tokens },
				}),
				...(reasoningOn &&
					useAdaptive && {
						output_config: { effort: this.options.reasoningEffort || "high" },
					}),
			},
		})

		// Execute the streaming request using unified handler
		yield* this.executeConverseStream(command, model.info, config.abortSignal)
	}

	/**
	 * Formats messages for models using the Converse API specification
	 * Used by both Anthropic and Nova models to avoid code duplication
	 */
	private formatMessagesForConverseAPI(messages: DiracStorageMessage[], supportsImages = true): Message[] {
		return messages.map((message) => {
			// Determine role (user or assistant)
			const role = message.role === "user" ? ConversationRole.USER : ConversationRole.ASSISTANT

			// Process content based on type
			let content: ContentBlock[] = []

			if (typeof message.content === "string") {
				// Simple text content
				content = [{ text: message.content }]
			} else if (Array.isArray(message.content)) {
				// Convert Anthropic content format to Converse API content format
				const processedContent = message.content
					.map((item) => {
						// Text content
						if (item.type === "text") {
							return { text: item.text }
						}

						// Image content
						if (item.type === "image") {
							if (supportsImages) {
								return this.processImageContent(item)
							}
							return { text: "[Image]" }
						}

						if (item.type === "tool_use") {
							return {
								toolUse: {
									toolUseId: item.id,
									name: item.name,
									input: item.input,
								},
							}
						}

						// Skip thinking blocks - Bedrock Converse API handles thinking via
						// the thinking config parameter, not by replaying blocks in history
						if (item.type === "thinking" || item.type === "redacted_thinking") {
							return null
						}

						if (item.type === "tool_result") {
							const content = (() => {
								if (typeof item.content === "string") {
									return [{ text: item.content }]
								}
								if (Array.isArray(item.content)) {
									return item.content
										.map((block) => {
											if (block.type === "text") {
												return { text: block.text }
											}
											if (block.type === "image") {
												if (supportsImages) {
													return this.processImageContent(block)
												}
												return { text: "[Image]" }
											}
											return null
										})
										.filter((block): block is ContentBlock => block !== null)
								}

								return [{ text: JSON.stringify(item.content) }]
							})()

							return {
								toolResult: {
									toolUseId: item.tool_use_id,
									content,
									status: item.is_error ? "error" : "success",
								},
							}
						}

						// Log unsupported content types for debugging
						Logger.warn(`Unsupported content type: ${(item as ContentItem).type}`)
						return null
					})
					.filter((item): item is ContentBlock => item !== null)

				content = processedContent
			}

			// Return formatted message
			return {
				role,
				content,
			}
		})
	}

	/**
	 * Processes image content with proper error handling and user notification
	 */
	private processImageContent(item: any): ContentBlock | null {
		let imageData: Uint8Array
		let format: "png" | "jpeg" | "gif" | "webp" = "jpeg" // default format

		// Extract format from media_type if available
		if (item.source.media_type) {
			// Extract format from media_type (e.g., "image/jpeg" -> "jpeg")
			const formatMatch = item.source.media_type.match(/image\/(\w+)/)
			if (formatMatch && formatMatch[1]) {
				const extractedFormat = formatMatch[1]
				// Ensure format is one of the allowed values
				if (["png", "jpeg", "gif", "webp"].includes(extractedFormat)) {
					format = extractedFormat as "png" | "jpeg" | "gif" | "webp"
				}
			}
		}

		// Get image data with improved error handling
		try {
			if (typeof item.source.data === "string") {
				// Handle base64 encoded data
				const base64Data = item.source.data.replace(/^data:image\/\w+;base64,/, "")
				imageData = new Uint8Array(Buffer.from(base64Data, "base64"))
			} else if (item.source.data && typeof item.source.data === "object") {
				// Try to convert to Uint8Array
				imageData = new Uint8Array(Buffer.from(item.source.data as Buffer | Uint8Array))
			} else {
				throw new Error("Unsupported image data format")
			}

			return {
				image: {
					format,
					source: {
						bytes: imageData,
					},
				},
			}
		} catch (error) {
			Logger.error("Failed to process image content:", error)
			// Return a text content indicating the error instead of null
			// This ensures users are aware of the issue
			return {
				text: `[ERROR: Failed to process image - ${getErrorMessage(error, "Unknown error")}]`,
			}
		}
	}

	/**
	 * Applies cache control to messages for prompt caching using AWS Bedrock's cachePoint system
	 * AWS Bedrock uses cachePoint objects instead of Anthropic's cache_control approach
	 */
	private applyCacheControlToMessages(messages: Message[], userIndices: [number, number]): Message[] {
		const [, lastUserMsgIndex] = userIndices
		const secondLastMsgUserIndex = userIndices[0] ?? -1
		return messages.map((message, index) => {
			// Add cachePoint to the last user message and second-to-last user message
			if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
				// Clone the message to avoid modifying the original
				const messageWithCache = { ...message }

				if (messageWithCache.content && Array.isArray(messageWithCache.content)) {
					// Add cachePoint to the end of the content array
					messageWithCache.content = [
						...messageWithCache.content,
						{
							cachePoint: {
								type: "default",
							},
						} as CachePointContentBlock, // Properly typed cache point for AWS SDK
					]
				}

				return messageWithCache
			}

			return message
		})
	}

	/**
	 * Creates a message using Amazon Nova models through AWS Bedrock
	 * Implements support for Amazon Nova models with caching support
	 */
	private async *createNovaMessage(config: BedrockMessageConfig): ApiStream {
		const { systemPrompt, messages, modelId, model, tools } = config
		// Format messages for Nova model using unified formatter
		const formattedMessages = this.formatMessagesForConverseAPI(messages, model.info.supportsImages !== false)

		// Get model info and message indices for caching (for Nova models that support it)
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Apply caching controls to messages if model supports caching and option is enabled
		const messagesWithCache =
			this.options.awsBedrockUsePromptCache && model.info.supportsPromptCache
				? this.applyCacheControlToMessages(formattedMessages, [secondLastMsgUserIndex, lastUserMsgIndex])
				: formattedMessages

		// Prepare system message with caching support for Nova models that support it
		const enableCaching = this.options.awsBedrockUsePromptCache && model.info.supportsPromptCache
		const systemMessages = prepareSystemMessages(systemPrompt, enableCaching || false)

		// Prepare request for Nova model
		const toolConfig = this.mapDiracToolsToBedrockToolConfig(tools)
		const command = new ConverseStreamCommand({
			modelId: modelId,
			messages: messagesWithCache,
			system: systemMessages,
			inferenceConfig: this.getInferenceConfig(model.info, "nova"),
			...(toolConfig ? { toolConfig } : {}),
		})

		// Execute the streaming request using unified handler
		yield* this.executeConverseStream(command, model.info, config.abortSignal)
	}

	/**
	 * Creates a message using OpenAI models through AWS Bedrock
	 * Uses non-streaming Converse API and simulates streaming for models that don't support it
	 */
	private async *createOpenAIMessage(config: BedrockMessageConfig): ApiStream {
		yield* this.createNonStreamingConverseMessage(config, calculateApiCostOpenAI, "OpenAI")
	}

	/**
	 * Creates a message using Qwen models through AWS Bedrock
	 * Uses non-streaming Converse API and simulates streaming for models that don't support it
	 */
	private async *createQwenMessage(config: BedrockMessageConfig): ApiStream {
		yield* this.createNonStreamingConverseMessage(config, calculateApiCostQwen, "Qwen")
	}

	// Shared non-streaming Converse API logic for OpenAI and Qwen models.
	// Simulates streaming by chunking the response text into 1000-char segments.
	private async *createNonStreamingConverseMessage(
		config: BedrockMessageConfig,
		costFn: typeof calculateApiCostOpenAI,
		label: string,
	): ApiStream {
		const { systemPrompt, messages, modelId, model, tools } = config
		const client = await this.getBedrockClient()
		const formattedMessages = this.formatMessagesForConverseAPI(messages, model.info.supportsImages !== false)
		const systemMessages = systemPrompt ? [{ text: systemPrompt }] : undefined
		const toolConfig = this.mapDiracToolsToBedrockToolConfig(tools)
		const command = new ConverseCommand({
			modelId,
			messages: formattedMessages,
			system: systemMessages,
			inferenceConfig: { maxTokens: model.info.maxTokens || 8192, temperature: model.info.temperature ?? 0 },
			...(toolConfig ? { toolConfig } : {}),
		})

		try {
			const inputTokenEstimate = this.estimateInputTokens(systemPrompt, messages)
			const response = await client.send(command, { abortSignal: config.abortSignal })
			const { fullText, reasoningText } = extractNonStreamingContent(response)

			const outputTokens = response.usage
				? response.usage.outputTokens || estimateTokenCount(fullText + reasoningText)
				: estimateTokenCount(fullText + reasoningText)

			if (response.usage) {
				const actualInputTokens = response.usage.inputTokens || inputTokenEstimate
				yield {
					type: "usage",
					inputTokens: actualInputTokens,
					outputTokens,
					totalCost: costFn(model.info, actualInputTokens, outputTokens, 0, 0),
				}
			}

			yield* chunkText(reasoningText, "reasoning")
			yield* chunkText(fullText, "text")

			if (!response.usage) {
				yield {
					type: "usage",
					inputTokens: inputTokenEstimate,
					outputTokens,
					totalCost: costFn(model.info, inputTokenEstimate, outputTokens, 0, 0),
				}
			}
		} catch (error) {
			Logger.error(`Error with ${label} model via Converse API:`, error)
			yield { type: "text", text: `[ERROR] ${formatConverseError(error, label)}` }
		} finally {
			client.destroy()
		}
	}

	// Extracts text and reasoning content from a non-streaming Converse response.

	// Chunks text into 1000-char segments and yields as the given chunk type.

	// Formats an error from the Converse API into a human-readable message.
}
