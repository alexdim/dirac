import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { DiracAssistantThinkingBlock, DiracStorageMessage, DiracUserToolResultContentBlock } from "@/shared/messages/content"

/**
 * DeepSeek Reasoner message format with reasoning_content support.
 */
export type DeepSeekReasonerMessage =
	| OpenAI.Chat.ChatCompletionSystemMessageParam
	| OpenAI.Chat.ChatCompletionUserMessageParam
	| (OpenAI.Chat.ChatCompletionAssistantMessageParam & { reasoning_content?: string })
	| OpenAI.Chat.ChatCompletionToolMessageParam
	| OpenAI.Chat.ChatCompletionFunctionMessageParam

export function addReasoningContent(
	openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[],
	originalMessages: DiracStorageMessage[],
): DeepSeekReasonerMessage[] {
	// Find last user message index (start of current turn)
	// If no user message exists (lastUserIndex = -1), all messages are in the "current turn",
	// so reasoning_content will be added to all assistant messages. This is intentional.
	let lastUserIndex = -1
	for (let i = openAiMessages.length - 1; i >= 0; i--) {
		if (openAiMessages[i].role === "user") {
			lastUserIndex = i
			break
		}
	}

	// Extract thinking content from original messages, keyed by assistant index
	const thinkingByIndex = new Map<number, string>()
	let assistantIdx = 0
	for (const msg of originalMessages) {
		if (msg.role === "assistant") {
			if (Array.isArray(msg.content)) {
				const thinking = msg.content
					.filter((p): p is DiracAssistantThinkingBlock => p.type === "thinking")
					.map((p) => p.thinking)
					.join("\n")
				if (thinking) {
					thinkingByIndex.set(assistantIdx, thinking)
				}
			}
			assistantIdx++
		}
	}

	// Add reasoning_content to assistant messages
	let aiIdx = 0
	return openAiMessages.map((msg, i): DeepSeekReasonerMessage => {
		if (msg.role === "assistant") {
			const thinking = thinkingByIndex.get(aiIdx++)
			if (thinking) {
				// Always add reasoning_content if it exists to maintain the reasoning chain,
				// which is required by DeepSeek when tool calls are involved in the conversation.
				// DeepSeek docs state that it will be ignored if not needed, so it's safe to always include.
				return { ...msg, reasoning_content: thinking } as DeepSeekReasonerMessage
			}
		}
		return msg as DeepSeekReasonerMessage
	})
}

/**
 * Converts Dirac messages to DeepSeek format, merging consecutive messages with the same role
 * and adding reasoning_content from thinking blocks.
 */
export function convertToDeepSeekMessages(
	messages: DiracStorageMessage[],
	systemPrompt: string,
	supportsImages: boolean = false,
): DeepSeekReasonerMessage[] {
	const openAiMessages: DeepSeekReasonerMessage[] = [{ role: "system", content: systemPrompt }]

	for (const msg of messages) {
		const lastMsg = openAiMessages[openAiMessages.length - 1]

		// Extract thinking and text content
		let thinking = ""
		let text = ""
		const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []

		if (typeof msg.content === "string") {
			text = msg.content
		} else if (Array.isArray(msg.content)) {
			msg.content.forEach((part) => {
				if (part.type === "text") {
					text += (text ? "\n" : "") + part.text
				} else if (part.type === "thinking") {
					thinking += (thinking ? "\n" : "") + part.thinking
				} else if (part.type === "tool_use") {
					toolCalls.push({
						id: part.id,
						type: "function",
						function: {
							name: part.name,
							arguments: JSON.stringify((part as any).input || (part as any).params || {}),
						},
					})
				}
			})
		}

		if (msg.role === "user") {
			// For user messages, we handle tool results and text/images
			if (Array.isArray(msg.content)) {
				const toolResults = msg.content.filter((p): p is DiracUserToolResultContentBlock => p.type === "tool_result")
				const nonToolParts = msg.content.filter((p) => p.type !== "tool_result")

				// Add tool results first
				toolResults.forEach((tr) => {
					openAiMessages.push({
						role: "tool",
						tool_call_id: tr.tool_use_id,
						content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
					} as DeepSeekReasonerMessage)
				})

				// Add non-tool parts as a user message
				if (nonToolParts.length > 0) {
					const content = nonToolParts.map((p) => {
						if (p.type === "text") return { type: "text", text: p.text }
						if (p.type === "image") {
							if (supportsImages) {
								return {
									type: "image_url",
									image_url: {
										url:
											p.source.type === "base64"
												? `data:${p.source.media_type};base64,${p.source.data}`
												: (p.source as any).url,
									},
								}
							} else {
								return { type: "text", text: "[Image]" }
							}
						}
						return { type: "text", text: "" }
					}) as OpenAI.Chat.ChatCompletionUserMessageParam["content"]

					if (lastMsg && lastMsg.role === "user") {
						if (typeof lastMsg.content === "string") {
							lastMsg.content = [{ type: "text", text: lastMsg.content }, ...(content as any)]
						} else if (Array.isArray(lastMsg.content)) {
							lastMsg.content.push(...(content as any))
						}
					} else {
						openAiMessages.push({ role: "user", content } as DeepSeekReasonerMessage)
					}
				}
			} else {
				if (lastMsg && lastMsg.role === "user") {
					if (typeof lastMsg.content === "string") {
						lastMsg.content += "\n" + msg.content
					} else {
						lastMsg.content.push({ type: "text", text: msg.content as string })
					}
				} else {
					openAiMessages.push({ role: "user", content: msg.content as string } as DeepSeekReasonerMessage)
				}
			}
		} else if (msg.role === "assistant") {
			if (lastMsg && lastMsg.role === "assistant") {
				// Merge with last assistant message
				if (text) {
					if (typeof lastMsg.content === "string") {
						lastMsg.content += "\n" + text
					} else if (Array.isArray(lastMsg.content)) {
						lastMsg.content.push({ type: "text", text })
					} else if (lastMsg.content === null) {
						lastMsg.content = text
					}
				}
				if (thinking) {
					lastMsg.reasoning_content = (lastMsg.reasoning_content ? lastMsg.reasoning_content + "\n" : "") + thinking
				}
				if (toolCalls.length > 0) {
					lastMsg.tool_calls = [...(lastMsg.tool_calls || []), ...toolCalls]
				}
			} else {
				openAiMessages.push({
					role: "assistant",
					content: text || (toolCalls.length > 0 ? null : ""),
					reasoning_content: thinking || undefined,
					tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
				} as DeepSeekReasonerMessage)
			}
		}
	}

	return openAiMessages
}


export function convertToR1Format(
	messages: Anthropic.Messages.MessageParam[],
	supportsImages: boolean = false,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	return messages.reduce<OpenAI.Chat.ChatCompletionMessageParam[]>((merged, message) => {
		const lastMessage = merged[merged.length - 1]
		let messageContent: string | (OpenAI.Chat.ChatCompletionContentPartText | OpenAI.Chat.ChatCompletionContentPartImage)[] =
			""
		let hasImages = false

		if (Array.isArray(message.content)) {
			const textParts: string[] = []
			const imageParts: OpenAI.Chat.ChatCompletionContentPartImage[] = []

			message.content.forEach((part) => {
				if (part.type === "text") {
					textParts.push(part.text || "")
				}
				if (part.type === "image") {
					if (supportsImages) {
						hasImages = true
						imageParts.push({
							type: "image_url",
							image_url: {
								url:
									part.source.type === "base64"
										? `data:${part.source.media_type};base64,${part.source.data}`
										: (part.source as any).url,
							},
						})
					} else {
						textParts.push("[Image]")
					}
				}
			})

			if (hasImages) {
				const parts: (OpenAI.Chat.ChatCompletionContentPartText | OpenAI.Chat.ChatCompletionContentPartImage)[] = []
				if (textParts.length > 0) {
					parts.push({ type: "text", text: textParts.join("\n") })
				}
				parts.push(...imageParts)
				messageContent = parts
			} else {
				messageContent = textParts.join("\n")
			}
		} else {
			messageContent = message.content
		}

		// If the last message has the same role, merge the content
		if (lastMessage?.role === message.role) {
			if (typeof lastMessage.content === "string" && typeof messageContent === "string") {
				lastMessage.content += `\n${messageContent}`
			} else {
				const lastContent = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text" as const, text: lastMessage.content || "" }]

				const newContent = Array.isArray(messageContent)
					? messageContent
					: [{ type: "text" as const, text: messageContent }]

				if (message.role === "assistant") {
					const mergedContent = [
						...lastContent,
						...newContent,
					] as OpenAI.Chat.ChatCompletionAssistantMessageParam["content"]
					lastMessage.content = mergedContent
				} else {
					const mergedContent = [...lastContent, ...newContent] as OpenAI.Chat.ChatCompletionUserMessageParam["content"]
					lastMessage.content = mergedContent
				}
			}
		} else {
			// Adds new message with the correct type based on role
			if (message.role === "assistant") {
				const newMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
					role: "assistant",
					content: messageContent as OpenAI.Chat.ChatCompletionAssistantMessageParam["content"],
				}
				merged.push(newMessage)
			} else {
				const newMessage: OpenAI.Chat.ChatCompletionUserMessageParam = {
					role: "user",
					content: messageContent as OpenAI.Chat.ChatCompletionUserMessageParam["content"],
				}
				merged.push(newMessage)
			}
		}
		return merged
	}, [])
}
