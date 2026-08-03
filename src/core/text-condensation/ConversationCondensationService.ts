import type { ContextManager } from "@core/context/context-management/ContextManager"
import type { MessageStateHandler } from "@core/task/message-state"
import type { DiracStorageMessage } from "@shared/messages/content"
import type { TextCondenser, TextCondensationTemplateId, TextStream } from "./TextCondenser"
import { ConversationTextSerializer } from "./ConversationTextSerializer"

export interface ConversationCondensationServiceDependencies {
	messageState: Pick<MessageStateHandler, "getApiConversationHistory">
	contextManager: Pick<ContextManager, "getTruncatedMessages">
	getConversationHistoryDeletedRange: () => [number, number] | undefined
	textCondenser: TextCondenser
	serializer?: ConversationTextSerializer
}

export type ConversationHistoryScope = "complete" | "effective"

export interface ConversationCondensationOptions {
	historyScope: ConversationHistoryScope
	signal?: AbortSignal
	additionalSourceText?: string
}

/**
 * Collects the requested view of the current conversation and returns only a
 * completed condensation. It has no authority to mutate task or conversation state.
 */
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
