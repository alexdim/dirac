import type { DiracStorageMessage } from "@/shared/messages/content"
import type { DiracTool } from "@/shared/tools"

export interface ApiConversationCheckpoint {
	providerId: string
	modelId: string
	compactedThroughHistoryIndex: number
	input: unknown[]
}

export interface ApiConversationContinuationReset {
	providerId: string
	modelId: string
	compactedThroughHistoryIndex: number
}

export interface ApiConversationProviderState {
	checkpoint?: ApiConversationCheckpoint
	continuationReset?: ApiConversationContinuationReset
	pendingCompaction?: PendingApiConversationCompaction
}

export interface PendingApiConversationCompaction {
	conversationHistoryDeletedRange: [number, number]
	previousConversationHistoryDeletedRange?: [number, number]
}

export interface ApiConversationRequestOptions {
	checkpoint?: ApiConversationCheckpoint
	breakProviderContinuation?: boolean
}

export interface ApiConversationCompactionRequest {
	systemPrompt: string
	messages: DiracStorageMessage[]
	tools?: DiracTool[]
	checkpoint?: ApiConversationCheckpoint
}

export interface ApiConversationCompactionResult {
	input: unknown[]
}
