---
component_id: 1.1.4
component_name: Goal Store & Tool Environment Manager
---

# Goal Store & Tool Environment Manager

## Component Description

Manages goal records, storage, history, lifecycle accounting, and coordinator/child tool execution environments.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/goal/GoalCoordinatorEnvironment.ts (lines 101-110)
```
	create(config: TaskConfig, toolName: string): ToolExecutionEnvironment {
		const surface = new SurfaceAdapter(config, toolName)
		surface.customMetadata = {
			goalId: config.taskId,
			goalAttribution: config.isSubagentExecution
				? `goal/subagent:${config.agentIdentity?.id ?? "unknown"}`
				: "goal",
		}
		return new GoalCoordinatorToolEnvironment(surface, this.createGoalTrait(surface), this.interactionOwner)
	}
```

### /Users/highlands/pools/Development/dirac/src/core/goal/GoalTaskEnvironment.ts (lines 183-185)
```
	getCreatedCards() {
		return this.base.getCreatedCards()
	}
```

### /Users/highlands/pools/Development/dirac/src/core/goal/GoalStore.ts (lines 112-241)
```
export class GoalStore {
	constructor(private readonly clock: () => number = Date.now) {}

	async create(goalId: string, conversationUlid: string, objectiveMarkdown: string): Promise<GoalRecord> {
		if (!objectiveMarkdown.trim()) throw new Error("A Goal objective cannot be empty")
		if (!conversationUlid) throw new Error("A Goal conversation ULID cannot be empty")
		return withGoalLock(goalId, async () => {
			const filePath = goalStatePath(goalId)
			if (await fileExistsAtPath(filePath)) throw new Error(`Goal ${goalId} already exists`)
			const now = this.clock()
			assertClockTime(now)
			await ensureTaskDirectoryExists(goalId)
			const record: GoalRecord = {
				version: 1,
				id: goalId,
				conversationUlid,
				status: "paused",
				statusReason: "Created",
				objective: { markdown: objectiveMarkdown, revision: 1, updatedAt: now },
				createdAt: now,
				updatedAt: now,
				lastPausedAt: now,
				activeDurationMs: 0,
				wakeSequence: 0,
				eventSequence: 0,
				events: [],
				children: [],
				accountingSources: {},
				accounting: {},
			}
			await writeGoalRecord(record)
			return structuredClone(record)
		})
	}

	async read(goalId: string): Promise<GoalRecord> {
		return withGoalLock(goalId, async () => structuredClone(await readGoalRecord(goalId)))
	}

	async list(): Promise<GoalRecord[]> {
		const taskIds = await listTaskDirectoryIds()
		const goalIds: string[] = []
		for (const taskId of taskIds) {
			if (await containsCurrentGoalRecord(taskId)) goalIds.push(taskId)
		}
		const records = await Promise.all(goalIds.map((goalId) => this.read(goalId)))
		return records.sort((left, right) => left.createdAt - right.createdAt)
	}

	async update(goalId: string, update: GoalRecordUpdate): Promise<GoalRecord> {
		return withGoalLock(goalId, async () => {
			const record = await readGoalRecord(goalId)
			const now = this.clock()
			assertClockTime(now)
			if (now < record.updatedAt) throw new Error(`Goal ${goalId} update time predates its persisted state`)
			const before = lifecycleSnapshot(record)
			await update(record, now)
			assertLifecycleUnchanged(record, before)
			record.updatedAt = now
			await writeGoalRecord(record)
			return structuredClone(record)
		})
	}

	async transition(goalId: string, transition: GoalStatusTransition, mutate?: GoalRecordUpdate): Promise<GoalRecord> {
		return withGoalLock(goalId, async () => {
			const record = await readGoalRecord(goalId)
			if (record.status === transition.status) return structuredClone(record)
			const now = this.clock()
			assertClockTime(now)
			if (now < record.updatedAt) throw new Error(`Goal ${goalId} transition time predates its persisted state`)
			const before = lifecycleSnapshot(record)
			if (mutate) await mutate(record, now)
			assertLifecycleUnchanged(record, before)
			applyGoalStatusTransition(record, transition, now)
			if (isSettledGoalStatus(record.status)) record.events = []
			await writeGoalRecord(record)
			return structuredClone(record)
		})
	}

	/** Removes only the Goal record. The owning controller deletes linked run directories after stopping execution. */
	async delete(goalId: string): Promise<void> {
		await withGoalLock(goalId, async () => {
			await fs.rm(goalStatePath(goalId), { force: true })
		})
	}

	async reconcileOnStartup(): Promise<GoalStartupReconciliationReport> {
		const taskIds = await listTaskDirectoryIds()
		const goalIds: string[] = []
		const failures: GoalStartupReconciliationFailure[] = []
		for (const taskId of taskIds) {
			try {
				if (await containsCurrentGoalRecord(taskId)) goalIds.push(taskId)
			} catch (error) {
				failures.push({ goalId: taskId, error: error instanceof Error ? error : new Error(String(error)) })
			}
		}
		const now = this.clock()
		assertClockTime(now)

		const records: GoalRecord[] = []
		for (const goalId of goalIds) {
			try {
				const record = await withGoalLock(goalId, async () => {
					const current = await readGoalRecord(goalId)
					if (now < current.updatedAt) throw new Error(`Goal ${goalId} recovery time predates its persisted state`)
					const interruptedChildren = interruptNonterminalGoalChildren(current, now)
					const wasActive = isActiveGoalStatus(current.status)
					if (wasActive) {
						applyGoalStatusTransition(
							current,
							{ status: "paused", statusReason: "Paused after interrupted process restart" },
							now,
						)
					}
					if (interruptedChildren || wasActive) current.events = []
					if (interruptedChildren && !wasActive) current.updatedAt = now
					if (interruptedChildren || wasActive) await writeGoalRecord(current)
					return structuredClone(current)
				})
				records.push(record)
			} catch (error) {
				failures.push({ goalId, error: error instanceof Error ? error : new Error(String(error)) })
			}
		}
		return { records: records.sort((left, right) => left.createdAt - right.createdAt), failures }
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/goal/GoalHistory.ts (lines 5-28)
```
export function createGoalHistoryItem(
	record: GoalRecord,
	initialDisplayText: string,
	workspaceRootPath?: string,
): GoalHistoryItem {
	return {
		runKind: "goal",
		id: record.id,
		ulid: record.conversationUlid,
		conversationUlid: record.conversationUlid,
		ts: record.updatedAt,
		task: initialDisplayText,
		initialDisplayText,
		objectivePreview: objectivePreview(record.objective.markdown),
		objectiveRevision: record.objective.revision,
		status: record.status,
		...(record.statusReason ? { statusReason: record.statusReason } : {}),
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		activeDurationMs: goalActiveDurationAt(record, Date.now()),
		accounting: record.accounting,
		workspaceRootPath,
	}
}
```


## Source Files:

- `src/core/goal/GoalAccounting.ts`
- `src/core/goal/GoalCoordinatorEnvironment.ts`
- `src/core/goal/GoalHistory.ts`
- `src/core/goal/GoalLifecycle.ts`
- `src/core/goal/GoalStore.ts`
- `src/core/goal/GoalTaskEnvironment.ts`
- `src/core/goal/GoalTaskFactory.ts`
- `src/core/goal/validateGoalRecord.ts`

