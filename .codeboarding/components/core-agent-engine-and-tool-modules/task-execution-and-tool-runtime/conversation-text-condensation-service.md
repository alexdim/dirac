---
component_id: 1.1.3
component_name: Conversation Text Condensation Service
---

# Conversation Text Condensation Service

## Component Description

Serializes and condenses conversation history and task handoff context using utility models and prompt templates.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/text-condensation/ConversationCondensationService.ts (lines 27-67)
```
export class ConversationCondensationService {
	private readonly serializer: ConversationTextSerializer

	constructor(private readonly dependencies: ConversationCondensationServiceDependencies) {
		this.serializer = dependencies.serializer ?? new ConversationTextSerializer()
	}

	async condenseConversation(
		template: TextCondensationTemplateId,
		options: ConversationCondensationOptions,
	): Promise<string> {
		const history = this.getConversationHistory(options.historyScope)
		const conversationSource = this.serializer.serialize(history)
		const source = options.additionalSourceText
			? `${conversationSource}\n\n${options.additionalSourceText}`
			: conversationSource
		return await this.collect(
			this.dependencies.textCondenser.condense(this.sourceStream(source), { template, signal: options.signal }),
		)
	}

	private getConversationHistory(historyScope: ConversationHistoryScope): DiracStorageMessage[] {
		const completeHistory = structuredClone(this.dependencies.messageState.getApiConversationHistory())
		if (historyScope === "complete") return completeHistory

		return this.dependencies.contextManager.getTruncatedMessages(
			completeHistory,
			this.dependencies.getConversationHistoryDeletedRange(),
		) as DiracStorageMessage[]
	}

	private async *sourceStream(source: string): AsyncGenerator<string> {
		yield source
	}

	private async collect(stream: TextStream): Promise<string> {
		let output = ""
		for await (const chunk of stream) output += chunk
		return output
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/text-condensation/UtilityModelTextCondenser.ts (lines 20-75)
```
export class UtilityModelTextCondenser implements TextCondenser {
	constructor(
		private readonly runner: UtilityModelRequestRunner,
		private readonly templates: TextCondensationTemplateRegistry,
	) { }

	condense(input: TextStream, options: TextCondensationOptions): TextStream {
		return this.stream(input, options)
	}

	private async *stream(input: TextStream, options: TextCondensationOptions): AsyncGenerator<string> {
		const template = this.templates.get(options.template)
		const source = await this.collectInput(input, options.signal)
		if (source.length === 0) return
		const request: UtilityModelRequest = {
			systemPrompt: template.systemPrompt,
			messages: [{ role: "user", content: template.buildSourceMessage(source) }],
			signal: options.signal,
		}
		const output = await this.collectOutput(this.runner.run(request), options.signal)

		template.validateOutput(output, source)
		yield output
	}

	private async collectInput(input: TextStream, signal?: AbortSignal): Promise<string> {
		this.throwIfCancelled(signal)
		let source = ""
		for await (const chunk of input) {
			this.throwIfCancelled(signal)
			source += chunk
		}
		this.throwIfCancelled(signal)
		return source
	}

	private async collectOutput(stream: ApiStream, signal?: AbortSignal): Promise<string> {
		let output = ""
		for await (const chunk of stream) {
			this.throwIfCancelled(signal)
			if (chunk.type === "text") {
				output += chunk.text
				continue
			}
			if (chunk.type === "tool_calls") {
				throw new TextCondensationOutputError("Text condensation returned a tool call")
			}
		}
		this.throwIfCancelled(signal)
		return output
	}

	private throwIfCancelled(signal?: AbortSignal): void {
		if (signal?.aborted) throw new UtilityModelCancelledError()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/text-condensation/CurrentTurnUserRequests.ts (lines 41-43)
```
export function formatCurrentTurnUserRequests(requests: readonly string[]): string {
	return `=== CURRENT TURN USER REQUESTS (verbatim, oldest to newest; since the latest successful completion, or session start) ===\n${JSON.stringify(requests)}`
}
```


## Source Files:

- `src/core/text-condensation/ConversationCondensationService.ts`
- `src/core/text-condensation/ConversationTextSerializer.ts`
- `src/core/text-condensation/CurrentTurnUserRequests.ts`
- `src/core/text-condensation/TextCondensationTemplateRegistry.ts`
- `src/core/text-condensation/TextCondenser.ts`
- `src/core/text-condensation/UtilityModelTextCondenser.ts`
- `src/core/text-condensation/UtilityTextCondensationAvailability.ts`
- `src/core/text-condensation/templates/index.ts`
- `src/core/text-condensation/templates/taskHandoffTemplate.ts`

