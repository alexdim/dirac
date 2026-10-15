---
component_id: 1.3.2
component_name: Message Format & Stream Transformers
---

# Message Format & Stream Transformers

## Component Description

Converts internal conversation messages, tool calls, usage metrics, and streaming chunks to and from provider-specific formats.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/api/transform/anthropic-format.ts (lines 14-43)
```
export function sanitizeAnthropicMessages(
	diracMessages: Array<DiracStorageMessage | Anthropic.MessageParam>,
	supportCache: boolean,
): Array<Anthropic.MessageParam> {
	// The latest message will be the new user message, one before will be the assistant message from a previous request,
	// and the user message before that will be a previously cached user message. So we need to mark the latest user message
	// as ephemeral to cache it for the next request, and mark the second to last user message as ephemeral to let the server
	// know the last message to retrieve from the cache for the current request.
	const userMsgIndices = diracMessages.reduce((acc, msg, index) => {
		if (msg.role === "user") {
			acc.push(index)
		}
		return acc
	}, [] as number[])
	// Set to -1 if there are no user messages so the indices are invalid
	const indicesLength = userMsgIndices.length ?? -1
	const lastUserMsgIndex = userMsgIndices[indicesLength - 1]
	const secondLastMsgUserIndex = userMsgIndices[indicesLength - 2]

	return diracMessages.map((msg, index) => {
		const anthropicMsg = convertDiracStorageToAnthropicMessage(msg as DiracStorageMessage)

		// Add cache control to the last two user messages
		if (supportCache && (index === lastUserMsgIndex || index === secondLastMsgUserIndex)) {
			return addCacheControl(anthropicMsg)
		}

		return anthropicMsg
	})
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/transform/openai-format.ts (lines 240-260)
```
export function convertToOpenAiMessages(
	anthropicMessages: Omit<DiracStorageMessage, "modelInfo">[],
	provider?: ApiProvider,
	supportsImages = true,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

	for (const anthropicMessage of anthropicMessages) {
		if (typeof anthropicMessage.content === "string") {
			openAiMessages.push({ role: anthropicMessage.role, content: anthropicMessage.content })
			continue
		}
		if (anthropicMessage.role === "user") {
			convertUserMessage(anthropicMessage.content, provider, supportsImages, openAiMessages)
		} else if (anthropicMessage.role === "assistant") {
			convertAssistantMessage(anthropicMessage.content, provider, openAiMessages)
		}
	}

	return openAiMessages
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/transform/gemini-format.ts (lines 10-32)
```
export function convertAnthropicMessagesToGemini(messages: DiracStorageMessage[], modelId?: string): Content[] {
	const toolUseIdToName = new Map<string, string>()

	for (const msg of messages) {
		if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (typeof block !== "string" && block.type === "tool_use") {
					toolUseIdToName.set(block.id, block.name)
				}
			}
		}
	}

	const useMultimodalFunctionResponses = supportsMultimodalFunctionResponses(modelId)
	return messages.map((message) => ({
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToGemini(
			message.content as DiracStorageMessage["content"],
			toolUseIdToName,
			useMultimodalFunctionResponses,
		),
	}))
}
```


## Source Files:

- `src/core/api/adapters/index.ts`
- `src/core/api/transform/anthropic-format.ts`
- `src/core/api/transform/gemini-format.ts`
- `src/core/api/transform/mistral-format.ts`
- `src/core/api/transform/openai-format.ts`
- `src/core/api/transform/openai-response-format.ts`
- `src/core/api/transform/openai-usage.ts`
- `src/core/api/transform/openrouter-stream.ts`
- `src/core/api/transform/r1-format.ts`
- `src/core/api/transform/stream.ts`
- `src/core/api/transform/tool-call-processor.ts`
- `src/core/api/transform/vercel-ai-gateway-stream.ts`

