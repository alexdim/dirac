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

/**
 * Collects the current effective conversation and returns only a completed
 * condensation. It has no authority to mutate task or conversation state.
 */
export class ConversationCondensationService {
	private readonly serializer: ConversationTextSerializer

	constructor(private readonly dependencies: ConversationCondensationServiceDependencies) {
		this.serializer = dependencies.serializer ?? new ConversationTextSerializer()
	}

	async condenseEffectiveConversation(
		template: TextCondensationTemplateId,
		signal?: AbortSignal,
		additionalSourceText?: string,
	): Promise<string> {
		const effectiveHistory = this.getEffectiveHistory()
		const conversationSource = this.serializer.serialize(effectiveHistory)
		const source = additionalSourceText ? `${conversationSource}\n\n${additionalSourceText}` : conversationSource
		return await this.collect(this.dependencies.textCondenser.condense(this.sourceStream(source), { template, signal }))
	}

	private getEffectiveHistory(): DiracStorageMessage[] {
		const completeHistory = structuredClone(this.dependencies.messageState.getApiConversationHistory())
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
