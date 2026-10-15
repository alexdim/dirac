---
component_id: 9.1.2
component_name: Task History & Task Storage
---

# Task History & Task Storage

## Component Description

Controls task and run history lifecycle, persists task settings and metadata to storage, and provides atomic file writes.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/TaskHistoryController.ts (lines 38-152)
```
	await deleteTaskDirectory(item.id)
}

export class TaskHistoryController {
	constructor(
		private readonly stateManager: import("@core/storage/StateManager").StateManager,
		private readonly goalStore = new GoalStore(),
	) {}

	async readOpenRouterModels(): Promise<Record<string, import("@shared/api").ModelInfo> | undefined> {
		const openRouterModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.openRouterModels)
		try {
			if (await fileExistsAtPath(openRouterModelsFilePath)) {
				const fileContents = await fs.readFile(openRouterModelsFilePath, "utf8")
				const models = JSON.parse(fileContents)
				return removeLegacySynthetic1mModelEntries(models)
			}
		} catch (error) {
			Logger.error("Error reading cached OpenRouter models:", error)
		}
		return undefined
	}

	async getTaskWithId(id: string): Promise<{
		historyItem: TaskHistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const history = this.stateManager.getGlobalStateKey("taskHistory")
		const runHistoryItem = history.find((item) => item.id === id)
		if (runHistoryItem && isGoalHistoryItem(runHistoryItem)) {
			throw new Error(`Run ${id} is a Goal and cannot be loaded as a Task`)
		}
		const historyItem = runHistoryItem && isTaskHistoryItem(runHistoryItem) ? runHistoryItem : undefined
		if (historyItem) {
			const taskDirPath = getTaskDirectoryPath(id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const contextHistoryFilePath = path.join(taskDirPath, GlobalFileNames.contextHistory)
			const taskMetadataFilePath = path.join(taskDirPath, GlobalFileNames.taskMetadata)
			const hasConversationHistory = (
				await Promise.all([
					fileExistsAtPath(apiConversationHistoryFilePath),
					fileExistsAtPath(path.join(taskDirPath, GlobalFileNames.apiConversationHistoryBaseline)),
					fileExistsAtPath(path.join(taskDirPath, GlobalFileNames.apiConversationHistoryOperations)),
				])
			).some(Boolean)
			if (hasConversationHistory) {
				const apiConversationHistory = await getSavedApiConversationHistory(id)
				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					contextHistoryFilePath,
					taskMetadataFilePath,
					apiConversationHistory,
				}
			}
		}
		await this.deleteTaskFromState(id)
		throw new Error("Task not found")
	}

	/** Read recent public conversations only; Goal child prompts are agent-authored and private. */
	async getPromptHistory(workspacePath: string, excludedRunId?: string): Promise<UserPrompt[]> {
		const runs = this.stateManager
			.getGlobalStateKey("taskHistory")
			.filter(
				(item) =>
					item.id !== excludedRunId &&
					[item.cwdOnTaskInitialization, item.workspaceRootPath, item.shadowGitConfigWorkTree].some(
						(workspace) => workspace && arePathsEqual(workspace, workspacePath),
					),
			)
			.sort((left, right) => right.ts - left.ts)
			.slice(0, 20)
		const prompts = await Promise.all(
			runs.map(async (run) => {
				const saved = getUserPrompts(await getSavedDiracMessages(run.id))
				return saved.length > 0 ? saved : run.task.trim() ? [{ text: run.task, ts: run.ts }] : []
			}),
		)
		return prompts.flat()
	}

	getRunHistoryItem(id: string): RunHistoryItem {
		const item = this.stateManager.getGlobalStateKey("taskHistory").find((candidate) => candidate.id === id)
		if (!item) throw new Error(`Run ${id} is not present in top-level history`)
		return item
	}

	getGoalHistoryItem(id: string): GoalHistoryItem {
		const item = this.getRunHistoryItem(id)
		if (!isGoalHistoryItem(item)) throw new Error(`Run ${id} is not a Goal`)
		return item
	}

	async exportTaskWithId(id: string) {
		const { taskDirPath } = await this.getTaskWithId(id)
		Logger.log(`[EXPORT] Opening task directory: ${taskDirPath}`)
		const open = (await import("open")).default
		await open(taskDirPath)
	}

	async deleteTaskFromState(id: string): Promise<RunHistoryItem[]> {
		return this.stateManager.removeTaskHistoryItems([id])
	}

	async updateRunHistory(item: RunHistoryItem): Promise<RunHistoryItem[]> {
		return this.stateManager.upsertTaskHistoryItem(item)
```

### /Users/highlands/pools/Development/dirac/src/core/storage/taskHistory.ts (lines 238-285)
```
export function applyTaskHistoryMutations(
	initialItems: RunHistoryItem[],
	mutations: readonly TaskHistoryMutation[],
): RunHistoryItem[] {
	let items = [...initialItems]
	for (const mutation of mutations) {
		switch (mutation.kind) {
			case "upsert": {
				const index = items.findIndex((item) => item.id === mutation.item.id)
				if (index === -1) {
					items.push(mutation.item)
					break
				}
				const existing = items[index]
				assertMatchingRunKinds(existing, mutation.item)
				items[index] = {
					...mutation.item,
					...(existing.isFavorited !== undefined ? { isFavorited: existing.isFavorited } : {}),
				}
				break
			}
			case "setFavorite": {
				const index = items.findIndex((item) => item.id === mutation.id)
				if (index === -1) throw new Error(`Run ${mutation.id} is not present in top-level history`)
				items[index] = { ...items[index], isFavorited: mutation.isFavorited }
				break
			}
			case "remove": {
				const removedIds = new Set(mutation.ids)
				items = items.filter((item) => !removedIds.has(item.id))
				break
			}
			case "insertMissing": {
				const existingIds = new Set(items.map((item) => item.id))
				for (const item of mutation.items) {
					if (existingIds.has(item.id)) continue
					items.push(item)
					existingIds.add(item.id)
				}
				break
			}
			case "replace":
				items = [...mutation.items]
				break
		}
	}
	return items
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/taskStorage.ts (lines 75-88)
```
export async function readTaskSettingsFromStorage(taskId: string): Promise<Partial<GlobalState>> {
	try {
		const taskDirectoryFilePath = await ensureTaskDirectoryExists(taskId)
		const settingsFilePath = path.join(taskDirectoryFilePath, "settings.json")
		if (await fileExistsAtPath(settingsFilePath)) {
			const settingsContent = await fs.readFile(settingsFilePath, "utf8")
			return JSON.parse(settingsContent)
		}
		return {}
	} catch (error) {
		Logger.error("[Disk] Failed to read task settings:", error)
		throw error
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/atomicWrite.ts (lines 5-14)
```
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	try {
		await fs.writeFile(tmpPath, data, "utf8")
		await fs.rename(tmpPath, filePath)
	} catch (error) {
		fs.unlink(tmpPath).catch(() => {})
		throw error
	}
}
```


## Source Files:

- `src/core/controller/TaskHistoryController.ts`
- `src/core/storage/atomicWrite.ts`
- `src/core/storage/taskDirectory.ts`
- `src/core/storage/taskHistory.ts`
- `src/core/storage/taskStorage.ts`

