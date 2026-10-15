---
component_id: 9
component_name: State & Conversation Storage
---

# State & Conversation Storage

## Component Description

Persists application state, API configurations, secrets, task metadata, and conversation history on disk and in host storage.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/storage/StateManager.ts (lines 87-471)
```
export class StateManager {
	private static instance: StateManager | null = null

	private globalStateCache: GlobalStateAndSettings = {} as GlobalStateAndSettings
	private taskStateCache: Partial<Settings> = {}
	private sessionOverrideCache: Partial<Settings> = {}
	private secretsCache: Secrets = {} as Secrets
	private workspaceStateCache: LocalState = {} as LocalState

	private storage: StorageContext
	private persistence: StatePersistenceManager
	private isInitialized = false

	// In-memory model info cache (not persisted to disk) — keyed by `${provider}Models`
	private modelInfoCache: ModelCache = {}

	// Callback to sync external state changes with the UI client
	onSyncExternalChange?: () => void | Promise<void>

	// Delegate persistence-error callback to the persistence manager
	get onPersistenceError(): ((event: PersistenceErrorEvent) => void) | undefined {
		return this.persistence.onPersistenceError
	}
	set onPersistenceError(cb: ((event: PersistenceErrorEvent) => void) | undefined) {
		this.persistence.onPersistenceError = cb
	}

	// State change notification subscribers (from main)
	private stateChangeListeners = new Set<() => void>()

	private constructor(storage: StorageContext) {
		this.storage = storage
		this.persistence = new StatePersistenceManager(storage, {
			getGlobalStateValue: (key) => this.globalStateCache[key],
			getTaskStateValue: (key) => this.taskStateCache[key],
			getSecretValue: (key) => this.secretsCache[key],
			getWorkspaceStateValue: (key) => this.workspaceStateCache[key],
			setTaskHistoryInCache: (value) => {
				this.globalStateCache.taskHistory = value
			},
			onTaskHistoryCommitMerged: () => {
				this.notifyStateChange()
				void Promise.resolve(this.onSyncExternalChange?.()).catch((error) => {
					Logger.error("[StateManager] Failed to publish merged task history:", error)
				})
			},
		})
	}

	private get settingsCaches(): StateManagerSettingsCaches {
		return {
			sessionOverrideCache: this.sessionOverrideCache,
			taskStateCache: this.taskStateCache,
			globalStateCache: this.globalStateCache,
			secretsCache: this.secretsCache,
		}
	}

	private get allCaches(): StateManagerGetterCaches {
		return {
			...this.settingsCaches,
			workspaceStateCache: this.workspaceStateCache,
		}
	}

	private get settersContext(): StateManagerSettersContext {
		return {
			isInitialized: this.isInitialized,
			globalStateCache: this.globalStateCache,
			taskStateCache: this.taskStateCache,
			sessionOverrideCache: this.sessionOverrideCache,
			secretsCache: this.secretsCache,
			workspaceStateCache: this.workspaceStateCache,
			persistence: this.persistence,
			notifyStateChange: () => this.notifyStateChange(),
		}
	}

	/**
	 * Initialize the cache by loading data from the file-backed StorageContext.
	 */
	public static async initialize(storage: StorageContext): Promise<StateManager> {
		if (!StateManager.instance) {
			StateManager.instance = new StateManager(storage)
		}

		if (StateManager.instance.isInitialized) {
			throw new Error("StateManager has already been initialized.")
		}

		try {
			await initializeDistinctId(storage)

			// Load all extension state from file-backed stores
			const { globalState, secrets, workspaceState } = await StateManager.instance.persistence.readAllFromDisk()
			const rawLegacyUtilityModelEnabled = storage.globalStateBackingStore.get<boolean>("utilityModelEnabled")
			const rawUtilityModelUseCondense = storage.globalStateBackingStore.get<boolean>("utilityModelUseCondense")
			const rawUtilityModelUseNewTask = storage.globalStateBackingStore.get<boolean>("utilityModelUseNewTask")
			const rawUtilityModelUseGenerateCommitMessage = storage.globalStateBackingStore.get<boolean>(
				"utilityModelUseGenerateCommitMessage",
			)
			const legacyModelIdUpdates = buildLegacyModelIdStateUpdates(globalState)
			if (Object.keys(legacyModelIdUpdates).length > 0) {
				await storage.globalStateBackingStore.setBatch(legacyModelIdUpdates)
				Object.assign(globalState, legacyModelIdUpdates)
			}

			// Split the legacy Utility switch into independent use cases without changing an
			// existing user's intent. Read directly from the backing store because the
			// normalized state reader fills missing settings with their defaults.
			const utilityUseCaseUpdates: Partial<
				Pick<Settings, "utilityModelUseCondense" | "utilityModelUseNewTask" | "utilityModelUseGenerateCommitMessage">
			> = {}
			if (rawLegacyUtilityModelEnabled !== undefined) {
				const enabled = rawLegacyUtilityModelEnabled === true
				if (rawUtilityModelUseCondense === undefined) utilityUseCaseUpdates.utilityModelUseCondense = enabled
				if (rawUtilityModelUseNewTask === undefined) utilityUseCaseUpdates.utilityModelUseNewTask = enabled
				if (rawUtilityModelUseGenerateCommitMessage === undefined) {
					utilityUseCaseUpdates.utilityModelUseGenerateCommitMessage = enabled
				}
			}
			if (Object.keys(utilityUseCaseUpdates).length > 0) {
				await storage.globalStateBackingStore.setBatch(utilityUseCaseUpdates)
				Object.assign(globalState, utilityUseCaseUpdates)
			}

			// Populate the cache with all extension state and secrets fields
			StateManager.instance.populateCache(globalState, secrets, workspaceState)

			// Start watcher for taskHistory.json so external edits update cache (no persist loop)
			await StateManager.instance.persistence.setupTaskHistoryWatcher(
				() => StateManager.instance?.isInitialized ?? false,
				async () => {
					await StateManager.instance?.onSyncExternalChange?.()
				},
			)

			StateManager.instance.isInitialized = true

			await AgentConfigLoader.getInstance().ready()
		} catch (error) {
			Logger.error("[StateManager] Failed to initialize:", error)
			throw error
		}

		return StateManager.instance
	}

	public static isInitialized(): boolean {
		return StateManager.instance?.isInitialized === true
	}

	public static get(): StateManager {
		if (!StateManager.instance) {
			throw new Error("StateManager has not been initialized")
		}
		return StateManager.instance
	}

	/**
	 * Register callbacks for state manager events
	 */
	public registerCallbacks(callbacks: {
		onPersistenceError?: (event: PersistenceErrorEvent) => void | Promise<void>
		onSyncExternalChange?: () => void | Promise<void>
	}): void {
		if (callbacks.onPersistenceError) {
			this.persistence.onPersistenceError = callbacks.onPersistenceError as (event: PersistenceErrorEvent) => void
		}
		if (callbacks.onSyncExternalChange) {
			this.onSyncExternalChange = callbacks.onSyncExternalChange
		}
	}

	/**
	 * Subscribe to global state changes. The listener is called whenever global state
	 * is modified through StateManager setters. Returns an unsubscribe function.
	 */
	public subscribe(listener: () => void): () => void {
		this.stateChangeListeners.add(listener)
		return () => {
			this.stateChangeListeners.delete(listener)
		}
	}

	private notifyStateChange(): void {
		for (const listener of this.stateChangeListeners) {
			listener()
		}
	}

	setGlobalState<K extends keyof GlobalStateAndSettings>(key: K, value: GlobalStateAndSettings[K]): void {
		setGlobalState(this.settersContext, key, value)
	}

	refreshModelProviderPresetsFromDisk(): void {
		refreshModelProviderPresetsFromDisk(this.settersContext)
	}

	setGlobalStateBatch(updates: Partial<GlobalStateAndSettings>): void {
		setGlobalStateBatch(this.settersContext, updates)
	}

	upsertTaskHistoryItem(item: RunHistoryItem): RunHistoryItem[] {
		return mutateTaskHistory(this.settersContext, { kind: "upsert", item })
	}

	setTaskHistoryFavorite(id: string, isFavorited: boolean): RunHistoryItem[] {
		return mutateTaskHistory(this.settersContext, { kind: "setFavorite", id, isFavorited })
	}

	removeTaskHistoryItems(ids: string[]): RunHistoryItem[] {
		return mutateTaskHistory(this.settersContext, { kind: "remove", ids })
	}

	insertMissingTaskHistoryItems(items: RunHistoryItem[]): RunHistoryItem[] {
		return mutateTaskHistory(this.settersContext, { kind: "insertMissing", items })
	}

	replaceTaskHistory(items: RunHistoryItem[]): RunHistoryItem[] {
		return mutateTaskHistory(this.settersContext, { kind: "replace", items })
	}

	setTaskSettings<K extends keyof Settings>(taskId: string, key: K, value: Settings[K]): void {
		setTaskSettings(this.settersContext, taskId, key, value)
	}

	setTaskSettingsBatch(taskId: string, updates: Partial<Settings>): void {
		setTaskSettingsBatch(this.settersContext, taskId, updates)
	}

	hasTaskSetting<K extends keyof Settings>(key: K): boolean {
		return hasTaskSetting(this.settersContext, key)
	}

	getTaskSetting<K extends keyof Settings>(key: K): Settings[K] | undefined {
		return getTaskSetting(this.settersContext, key)
	}

	clearTaskSetting<K extends keyof Settings>(taskId: string, key: K): void {
		clearTaskSetting(this.settersContext, taskId, key)
	}

	async loadTaskSettings(taskId: string): Promise<void> {
		await loadTaskSettings(this.settersContext, taskId)
	}

	async clearTaskSettings(): Promise<void> {
		await clearTaskSettings(this.settersContext)
	}

	setSecret<K extends keyof Secrets>(key: K, value: Secrets[K]): void {
		setSecret(this.settersContext, key, value)
	}

	setSecretsBatch(updates: Partial<Secrets>): void {
		setSecretsBatch(this.settersContext, updates)
	}

	setWorkspaceState<K extends keyof LocalState>(key: K, value: LocalState[K]): void
	setWorkspaceState(key: string, value: unknown): void
	setWorkspaceState(key: string, value: unknown): void {
		setWorkspaceState(this.settersContext, key, value)
	}

	setWorkspaceStateBatch(updates: Partial<LocalState>): void {
		setWorkspaceStateBatch(this.settersContext, updates)
	}

	setSessionOverride<K extends keyof Settings>(key: K, value: Settings[K]): void {
		setSessionOverride(this.settersContext, key, value)
	}


	hasSessionOverride<K extends keyof Settings>(key: K): boolean {
		return hasSessionOverride(this.settersContext, key)
	}

	clearSessionOverride<K extends keyof Settings>(key: K): void {
		clearSessionOverride(this.settersContext, key)
	}


	setModelsCache(provider: string, models: Record<string, ModelInfo>): void {
		setModelsCache(this.modelInfoCache, provider, models)
	}

	getModelsCache(provider: string): Record<string, ModelInfo> | null {
		return getModelsCache(this.modelInfoCache, provider)
	}

	getModelInfo(
		provider: "openRouter" | "groq" | "baseten" | "huggingFace" | "requesty" | "huaweiCloudMaas" | "aihubmix" | "liteLlm",
		modelId: string,
	): ModelInfo | undefined {
		return getModelInfo(this.modelInfoCache, provider, modelId)
	}

	getApiConfiguration(): ApiConfiguration {
		return getApiConfiguration(this.settingsCaches, this.isInitialized)
	}

	/**
	 * Capture a detached task-owned effective configuration from already loaded state.
	 * Explicit runtime overrides participate as a highest-precedence, session-like
	 * input but are never installed into StateManager caches.
	 */
	captureEffectiveTaskConfiguration(
		explicitOverrides?: Partial<Settings>,
		executionOptions?: Partial<TaskExecutionOptions>,
	): TaskWorkingConfiguration {
		if (!this.isInitialized) throw new Error("StateManager has not been initialized")

		return createTaskWorkingConfiguration({
			revision: 1,
			settings: buildEffectiveSettingsFromCache(this.settingsCaches, explicitOverrides),
			apiConfiguration: buildEffectiveApiConfigurationFromCache(this.settingsCaches, explicitOverrides),
			workspaceConfiguration: this.workspaceStateCache,
			executionOptions: {
				terminalReuseEnabled: executionOptions?.terminalReuseEnabled ?? this.globalStateCache.terminalReuseEnabled,
				vscodeTerminalExecutionMode:
					executionOptions?.vscodeTerminalExecutionMode ?? this.globalStateCache.vscodeTerminalExecutionMode,
				multiRootEnabled: executionOptions?.multiRootEnabled ?? this.globalStateCache.multiRootEnabled,
			},
		})
	}

	setApiConfiguration(apiConfiguration: ApiConfiguration): void {
		setApiConfiguration(this.settersContext, apiConfiguration)
	}

	getGlobalSettingsKey<K extends keyof Settings>(key: K): Settings[K] {
		return getGlobalSettingsKey(key, this.settingsCaches, this.isInitialized)
	}

	/** Read a system default without inheriting active session or task state. */
	getSystemDefaultSettingsKey<K extends keyof Settings>(key: K): Settings[K] {
		return getSystemDefaultSettingsKey(key, this.settingsCaches, this.isInitialized)
	}

	getGlobalStateKey<K extends keyof GlobalState>(key: K): GlobalState[K] {
		return getGlobalStateKey(key, this.settingsCaches, this.isInitialized)
	}

	getSecretKey<K extends keyof Secrets>(key: K): Secrets[K] {
		return getSecretKey(key, this.settingsCaches, this.isInitialized)
	}

	getWorkspaceStateKey<K extends keyof LocalState>(key: K): LocalState[K]
	getWorkspaceStateKey(key: string): unknown
	getWorkspaceStateKey(key: string): unknown {
		return getWorkspaceStateKey(this.allCaches, this.isInitialized, key)
	}

	async reInitialize(currentTaskId?: string): Promise<void> {
		await this.persistence.flushPendingState()
		await this.dispose()
		await StateManager.initialize(this.storage)
		if (currentTaskId) await this.loadTaskSettings(currentTaskId)
	}

	private async dispose(): Promise<void> {
		this.sessionOverrideCache = {}
		this.isInitialized = false
		await this.persistence.dispose()
	}

	async flushPendingState(): Promise<void> {
		await this.persistence.flushPendingState()
	}

	getAllGlobalStateEntries(): Record<string, unknown> {
		return getAllGlobalStateEntries(this.settingsCaches, this.isInitialized)
	}

	getAllWorkspaceStateEntries(): Record<string, unknown> {
		return getAllWorkspaceStateEntries(this.allCaches, this.isInitialized)
	}

	private populateCache(globalState: GlobalState, secrets: Secrets, workspaceState: LocalState): void {
		Object.assign(this.globalStateCache, globalState)
		Object.assign(this.secretsCache, secrets)
		Object.assign(this.workspaceStateCache, workspaceState)
	}
}
```

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

### /Users/highlands/pools/Development/dirac/src/core/storage/conversationHistory.ts (lines 40-53)
```
export async function getSavedApiConversationState(taskId: string): Promise<SavedApiConversationHistory> {
	const taskDirectory = await ensureTaskDirectoryExists(taskId)
	const filePath = path.join(taskDirectory, GlobalFileNames.apiConversationHistory)
	const baselinePath = path.join(taskDirectory, GlobalFileNames.apiConversationHistoryBaseline)
	let { messages, lastOffset } = await readApiConversationBaseline(filePath, baselinePath)
	const operationPath = path.join(path.dirname(filePath), GlobalFileNames.apiConversationHistoryOperations)
	await replayOperationRecords<ApiConversationOperation>(operationPath, (operation) => {
		if (operation.offset <= lastOffset) return
		assertNextOffset(operation.offset, lastOffset, operationPath, operation.type === "reset")
		lastOffset = operation.offset
		messages = applyApiConversationOperation(messages, operation)
	})
	return { messages, lastOffset }
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/taskHistory.ts (lines 73-85)
```
export async function readTaskHistoryFromState(): Promise<RunHistoryItem[]> {
	try {
		const filePath = await getTaskHistoryStateFilePath()
		if (!(await fileExistsAtPath(filePath))) {
			return []
		}
		const contents = await fs.readFile(filePath, "utf8")
		return parseTaskHistoryContents(filePath, contents)
	} catch (error) {
		telemetryService.captureExtensionStorageError(error, "readTaskHistoryFromState")
		throw error
	}
}
```


## Source Files:

- `src/core/controller/TaskHistoryController.ts`
- `src/core/storage/StateManager.ts`
- `src/core/storage/StateManagerGetters.ts`
- `src/core/storage/StateManagerModelCache.ts`
- `src/core/storage/StateManagerSetters.ts`
- `src/core/storage/StateManagerSettings.ts`
- `src/core/storage/StatePersistenceManager.ts`
- `src/core/storage/atomicWrite.ts`
- `src/core/storage/conversationHistory.ts`
- `src/core/storage/conversationHistoryFiles.ts`
- `src/core/storage/directoryEnsurers.ts`
- `src/core/storage/environmentMetadata.ts`
- `src/core/storage/fileNames.ts`
- `src/core/storage/globalStorageDir.ts`
- `src/core/storage/hooksStorage.ts`
- `src/core/storage/operationLog.ts`
- `src/core/storage/paths.ts`
- `src/core/storage/remoteConfigCache.ts`
- `src/core/storage/skillsStorage.ts`
- `src/core/storage/state-migrations.ts`
- `src/core/storage/taskDirectory.ts`
- `src/core/storage/taskHistory.ts`
- `src/core/storage/taskStorage.ts`
- `src/core/storage/utils/state-helpers.ts`
- `src/services/telemetry/UserTelemetry.ts`
- `src/shared/messages/content.ts`
- `src/shared/storage/DiracBlobStorage.ts`
- `src/shared/storage/DiracFileStorage.ts`
- `src/shared/storage/DiracStorage.ts`
- `src/shared/storage/adapters.ts`
- `src/shared/storage/env-config.ts`
- `src/shared/storage/legacy-model-id-migration.ts`
- `src/shared/storage/provider-keys.ts`
- `src/shared/storage/state-keys.ts`
- `src/shared/storage/storage-context.ts`
- `src/shared/storage/types.ts`
- `src/utils/storage.ts`

