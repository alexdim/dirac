---
component_id: 9.1.3
component_name: Conversation History & Operation Log
---

# Conversation History & Operation Log

## Component Description

Persists and reconstructs API conversation transcripts, presentation baselines, and append-only operation logs.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/storage/conversationHistory.ts (lines 36-38)
```
export async function getSavedApiConversationHistory(taskId: string): Promise<Anthropic.MessageParam[]> {
	return (await getSavedApiConversationState(taskId)).messages
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/conversationHistory.ts (lines 102-135)
```
export async function saveApiConversationHistory(taskId: string, apiConversationHistory: Anthropic.MessageParam[]) {
	if (apiConversationHistory.length === 0) {
		return
	}
	try {
		const fileName = GlobalFileNames.apiConversationHistory
		const taskDirectory = await ensureTaskDirectoryExists(taskId)
		const usesIncrementalStorage =
			(await fileExistsAtPath(path.join(taskDirectory, GlobalFileNames.apiConversationHistoryBaseline))) ||
			(await fileExistsAtPath(path.join(taskDirectory, GlobalFileNames.apiConversationHistoryOperations)))
		if (usesIncrementalStorage) {
			const current = await getSavedApiConversationState(taskId)
			await appendApiConversationOperations(
				taskId,
				[
					{
						offset: current.lastOffset + 1,
						type: "reset",
						messages: apiConversationHistory,
					},
				],
				apiConversationHistory,
			)
			return
		}
		const data = JSON.stringify(apiConversationHistory)
		syncWorker().enqueue(taskId, fileName, data)
		const filePath = path.join(taskDirectory, fileName)
		await atomicWriteFile(filePath, data)
	} catch (error) {
		Logger.error("Failed to save API conversation history:", error)
		throw error
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/conversationHistory.ts (lines 55-69)
```
export async function appendApiConversationOperations(
	taskId: string,
	operations: readonly ApiConversationOperation[],
	completeHistory?: readonly DiracStorageMessage[],
): Promise<number> {
	const taskDirectory = await ensureTaskDirectoryExists(taskId)
	const appendedBytes = await appendOperationRecords(
		path.join(taskDirectory, GlobalFileNames.apiConversationHistoryOperations),
		operations,
	)
	if (operations.length > 0 && completeHistory) {
		syncWorker().enqueue(taskId, GlobalFileNames.apiConversationHistory, JSON.stringify(completeHistory))
	}
	return appendedBytes
}
```


## Source Files:

- `src/core/storage/conversationHistory.ts`
- `src/core/storage/conversationHistoryFiles.ts`
- `src/core/storage/operationLog.ts`

