---
component_id: 1.1.7
component_name: Task History Reconstruction Command
---

# Task History Reconstruction Command

## Component Description

Reconstructs task and goal history items from persisted storage records.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/commands/reconstructTaskHistory.ts (lines 90-151)
```
async function performTaskHistoryReconstruction(): Promise<TaskReconstructionResult> {
	const result: TaskReconstructionResult = {
		totalTasks: 0,
		reconstructedTasks: 0,
		skippedTasks: 0,
		errors: [],
	}

	// Backup existing task history
	await backupExistingTaskHistory()

	// Get tasks directory
	const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")

	// Check if tasks directory exists
	if (!(await fileExistsAtPath(tasksDir))) {
		throw new Error("No tasks directory found. Nothing to reconstruct.")
	}

	// Scan for task directories
	const taskIds = await scanTaskDirectories(tasksDir)
	const goals = await new GoalStore().list()
	const goalOwnedDirectoryIds = new Set(goals.flatMap((goal) => [goal.id, ...goal.children.map((child) => child.id)]))
	const ordinaryTaskIds = taskIds.filter((taskId) => !goalOwnedDirectoryIds.has(taskId))
	result.totalTasks = ordinaryTaskIds.length + goals.length

	if (result.totalTasks === 0) {
		throw new Error("No task directories found. Nothing to reconstruct.")
	}

	// Process each task
	const reconstructedItems: HistoryItem[] = []
	for (const goal of goals) {
		const messages = await getSavedDiracMessages(goal.id)
		reconstructedItems.push(createGoalHistoryItem(goal, initialGoalDisplayText(messages, goal.objective.markdown)))
		result.reconstructedTasks++
	}

	for (const taskId of ordinaryTaskIds) {
		try {
			const historyItem = await reconstructTaskHistoryItem(taskId)
			if (historyItem) {
				reconstructedItems.push(historyItem)
				result.reconstructedTasks++
			} else {
				result.skippedTasks++
			}
		} catch (error) {
			result.skippedTasks++
			const errorMsg = getErrorMessage(error)
			result.errors.push(`Task ${taskId}: ${errorMsg}`)
		}
	}

	// Sort by timestamp (newest first)
	reconstructedItems.sort((a, b) => b.ts - a.ts)

	// Write reconstructed history
	await writeTaskHistoryToState(reconstructedItems)

	return result
}
```


## Source Files:

- `src/core/commands/reconstructTaskHistory.ts`

