---
component_id: 10.1.3
component_name: API Conversation Compaction & State Contracts
---

# API Conversation Compaction & State Contracts

## Component Description

Defines TypeScript data contracts for provider-level API conversation checkpoints, continuation resets, pending history compaction ranges, and compaction request/response payloads.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/api/conversation.ts (lines 4-9)
```
export interface ApiConversationCheckpoint {
	providerId: string
	modelId: string
	compactedThroughHistoryIndex: number
	input: unknown[]
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/conversation.ts (lines 17-22)
```
export interface ApiConversationProviderState {
	checkpoint?: ApiConversationCheckpoint
	continuationReset?: ApiConversationContinuationReset
	pendingCompaction?: PendingApiConversationCompaction
	deliveredSteeringMessageIds?: string[]
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/conversation.ts (lines 29-33)
```
export interface ApiConversationRequestOptions {
	checkpoint?: ApiConversationCheckpoint
	breakProviderContinuation?: boolean
	enableNativeWebSearch?: boolean
}
```

### /Users/highlands/pools/Development/dirac/src/core/api/conversation.ts (lines 35-40)
```
export interface ApiConversationCompactionRequest {
	systemPrompt: string
	messages: DiracStorageMessage[]
	tools?: DiracTool[]
	checkpoint?: ApiConversationCheckpoint
}
```


## Source Files:

- `src/core/api/conversation.ts`

