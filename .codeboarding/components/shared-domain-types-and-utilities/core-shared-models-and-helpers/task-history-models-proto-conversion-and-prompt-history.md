---
component_id: 3.1.3
component_name: Task History Models, Proto Conversion & Prompt History
---

# Task History Models, Proto Conversion & Prompt History

## Component Description

Defines task and goal history item data structures, protocol-buffer conversion helpers, and user prompt extraction from message history.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/HistoryItem.ts (lines 3-23)
```
export interface RunHistoryItemBase {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	/**
	 * Legacy display text consumed by existing history surfaces. Goal entries keep
	 * their immutable initial display text here and expose the current objective
	 * separately through `objectivePreview`.
	 */
	task: string

	size?: number
	shadowGitConfigWorkTree?: string
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	workspaceRootPath?: string
	checkpointManagerErrorMessage?: string

	modelId?: string
}
```

### /Users/highlands/pools/Development/dirac/src/shared/HistoryItem.ts (lines 29-36)
```
export interface TaskHistoryItem extends RunHistoryItemBase {
	runKind?: "task"
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
}
```

### /Users/highlands/pools/Development/dirac/src/shared/HistoryItem.ts (lines 39-51)
```
export interface GoalHistoryItem extends RunHistoryItemBase {
	runKind: "goal"
	conversationUlid: string
	initialDisplayText: string
	objectivePreview: string
	objectiveRevision: number
	status: GoalStatus
	statusReason?: string
	createdAt: number
	updatedAt: number
	activeDurationMs: number
	accounting: GoalAccounting
}
```

### /Users/highlands/pools/Development/dirac/src/shared/HistoryItem.ts (lines 61-63)
```
export function isGoalHistoryItem(item: RunHistoryItem): item is GoalHistoryItem {
	return item.runKind === "goal"
}
```

### /Users/highlands/pools/Development/dirac/src/shared/HistoryItem.ts (lines 65-67)
```
export function isTaskHistoryItem(item: RunHistoryItem): item is TaskHistoryItem {
	return item.runKind !== "goal"
}
```

### /Users/highlands/pools/Development/dirac/src/shared/historyItemFromProto.ts (lines 8-37)
```
export function historyItemFromProto(item: TaskItem): HistoryItem {
	const base = historyBaseFromProto(item)
	if (item.runKind !== "goal") {
		return {
			...base,
			...(item.runKind === "task" ? { runKind: "task" as const } : {}),
			tokensIn: item.tokensIn ?? 0,
			tokensOut: item.tokensOut ?? 0,
			...(item.cacheWrites !== undefined ? { cacheWrites: item.cacheWrites } : {}),
			...(item.cacheReads !== undefined ? { cacheReads: item.cacheReads } : {}),
			totalCost: item.totalCost ?? 0,
		} satisfies TaskHistoryItem
	}

	const status = requiredGoalStatus(item.status, item.id)
	return {
		...base,
		runKind: "goal",
		conversationUlid: requiredString(item.conversationUlid, "conversationUlid", item.id),
		initialDisplayText: requiredString(item.initialDisplayText, "initialDisplayText", item.id),
		objectivePreview: requiredString(item.objectivePreview, "objectivePreview", item.id),
		objectiveRevision: requiredNonnegativeNumber(item.objectiveRevision, "objectiveRevision", item.id, true),
		status,
		...(item.statusReason ? { statusReason: item.statusReason } : {}),
		createdAt: requiredNonnegativeNumber(item.createdAt, "createdAt", item.id),
		updatedAt: requiredNonnegativeNumber(item.updatedAt, "updatedAt", item.id),
		activeDurationMs: requiredNonnegativeNumber(item.activeDurationMs, "activeDurationMs", item.id),
		accounting: accountingFromProto(item.accounting),
	} satisfies GoalHistoryItem
}
```

### /Users/highlands/pools/Development/dirac/src/shared/messages/prompt-history.ts (lines 9-15)
```
export function getUserPrompts(messages: DiracMessage[]): UserPrompt[] {
	return messages.flatMap(({ content, ts }) =>
		content.type === DiracMessageType.MARKDOWN && content.role === "user" && content.content.trim()
			? [{ text: content.content, ts }]
			: [],
	)
}
```

### /Users/highlands/pools/Development/dirac/src/shared/messages/prompt-history.ts (lines 17-20)
```
export function getRecentUniquePrompts(prompts: UserPrompt[], limit = 100): string[] {
	const newestFirst = [...prompts].sort((left, right) => right.ts - left.ts).map(({ text }) => text)
	return [...new Set(newestFirst)].slice(0, limit)
}
```


## Source Files:

- `src/shared/HistoryItem.ts`
- `src/shared/historyItemFromProto.ts`
- `src/shared/messages/prompt-history.ts`

