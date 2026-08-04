import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo } from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import OpenAI from "openai"
import { ChatCompletionTool } from "openai/resources/chat/completions"
import { convertToOpenAiMessages } from "./openai-format"
import { getOpenAIToolParams } from "./tool-call-processor"
import { Logger } from "@/shared/services/Logger"

export interface OpenRouterRoutingOptions {
	sort?: string
	allowedProviders?: string[]
	preventFallbacks?: boolean
}

interface OpenRouterProviderRequest {
	sort?: string
	order?: string[]
	allow_fallbacks?: false
}

export function buildOpenRouterProvider(routing: OpenRouterRoutingOptions | undefined): OpenRouterProviderRequest | undefined {
	if (!routing) return undefined

	const provider: OpenRouterProviderRequest = {}
	if (routing.allowedProviders?.length) provider.order = routing.allowedProviders
	else if (routing.sort) provider.sort = routing.sort
	if (routing.preventFallbacks) provider.allow_fallbacks = false
	return Object.keys(provider).length > 0 ? provider : undefined
}

export async function createOpenRouterStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
	reasoningEffort?: string,
	thinkingBudgetTokens?: number,
	routing?: OpenRouterRoutingOptions,
	tools?: Array<ChatCompletionTool>,
	enableParallelToolCalling?: boolean,
	signal?: AbortSignal,
) {
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		buildOpenRouterSystemMessage(systemPrompt, model.info.supportsPromptCache),
		...convertToOpenAiMessages(messages as any, undefined, model.info.supportsImages !== false),
	]

	if (model.info.supportsPromptCache) {
		addCacheControlToRecentUserMessages(openAiMessages)
	}

	const normalizedReasoningEffort =
		reasoningEffort === undefined ? undefined : normalizeOpenaiReasoningEffort(reasoningEffort)
	const reasoningPayload = buildOpenRouterReasoning(
		model.info,
		normalizedReasoningEffort,
		thinkingBudgetTokens,
	)
	const includeReasoning = model.info.supportsReasoning ? normalizedReasoningEffort !== "none" : undefined
	const temperature = reasoningPayload && "max_tokens" in reasoningPayload ? undefined : model.info.temperature
	const provider = buildOpenRouterProvider(routing)
	Logger.info(
		`[OpenRouter request] ${JSON.stringify({
			model: model.id,
			provider,
		})}`,
	)

	const requestPayload: Record<string, unknown> = {
		model: model.id,
		...(model.info.maxTokens ? { max_tokens: model.info.maxTokens } : {}),
		...(temperature !== undefined ? { temperature } : {}),
		messages: openAiMessages,
		stream: true,
		stream_options: { include_usage: true },
		...(includeReasoning !== undefined ? { include_reasoning: includeReasoning } : {}),
		...(reasoningPayload ? { reasoning: reasoningPayload } : {}),
		...(provider ? { provider } : {}),
		...getOpenAIToolParams(tools, !!enableParallelToolCalling),
	}

	// The OpenAI SDK does not type OpenRouter's provider and reasoning extensions.
	return client.chat.completions.create(requestPayload as any, { signal }) as unknown as Promise<
		AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
	>
}

function buildOpenRouterSystemMessage(
	systemPrompt: string,
	supportsPromptCache: boolean,
): OpenAI.Chat.ChatCompletionSystemMessageParam {
	if (!supportsPromptCache) return { role: "system", content: systemPrompt }
	return {
		role: "system",
		content: [
			{
				type: "text",
				text: systemPrompt,
				cache_control: { type: "ephemeral" },
			} as OpenAI.Chat.ChatCompletionContentPartText & { cache_control: { type: "ephemeral" } },
		],
	}
}

function addCacheControlToRecentUserMessages(messages: OpenAI.Chat.ChatCompletionMessageParam[]): void {
	const recentUserMessages = messages.filter((message) => message.role === "user").slice(-2)
	for (const message of recentUserMessages) {
		if (typeof message.content === "string") {
			message.content = [{ type: "text", text: message.content }]
		}
		if (!Array.isArray(message.content)) continue

		let lastTextPart = message.content.filter((part) => part.type === "text").pop()
		if (!lastTextPart) {
			lastTextPart = { type: "text", text: "..." }
			message.content.push(lastTextPart)
		}
		; (lastTextPart as typeof lastTextPart & { cache_control: { type: "ephemeral" } }).cache_control = {
			type: "ephemeral",
		}
	}
}

function buildOpenRouterReasoning(
	modelInfo: ModelInfo,
	reasoningEffort: ReturnType<typeof normalizeOpenaiReasoningEffort> | undefined,
	thinkingBudgetTokens: number | undefined,
): { max_tokens: number } | { effort: string } | undefined {
	if (!modelInfo.supportsReasoning || reasoningEffort === "none") return undefined
	if (thinkingBudgetTokens && thinkingBudgetTokens > 0) return { max_tokens: thinkingBudgetTokens }
	if (reasoningEffort && modelInfo.supportsReasoningEffort) return { effort: reasoningEffort }
	return undefined
}
