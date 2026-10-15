---
component_id: 9.1.1
component_name: State Manager & Persistence
---

# State Manager & Persistence

## Component Description

Manages in-memory application state, getters/setters, state migrations, batch disk persistence, and storage path resolution.

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

### /Users/highlands/pools/Development/dirac/src/core/storage/StatePersistenceManager.ts (lines 50-404)
```
export class StatePersistenceManager {
	private storage: StorageContext
	private accessors: CacheAccessors

	private pendingGlobalState = new Set<GlobalStateAndSettingsKey>()
	private pendingTaskState = new Map<string, Set<SettingsKey>>()
	private pendingSecrets = new Set<SecretKey>()
	private pendingWorkspaceState = new Set<LocalStateKey>()
	private pendingTaskHistoryMutations: TaskHistoryMutation[] = []
	private inFlightTaskHistoryMutations: TaskHistoryMutation[] = []
	private persistenceTimeout: NodeJS.Timeout | null = null
	private persistenceTail: Promise<void> = Promise.resolve()
	private readonly PERSISTENCE_DELAY_MS = 500
	private taskHistoryWatcher: FSWatcher | null = null
	private readonly taskHistoryWatcherCloser = new ChokidarWatcherCloser()

	onPersistenceError?: (event: PersistenceErrorEvent) => void

	constructor(storage: StorageContext, accessors: CacheAccessors) {
		this.storage = storage
		this.accessors = accessors
	}

	// ── Pending-state tracking ──────────────────────────────────────────

	addPendingGlobalState(key: GlobalStateAndSettingsKey): void {
		if (key === "taskHistory") throw new Error("Task history requires an ID-scoped mutation")
		this.pendingGlobalState.add(key)
		this.scheduleDebouncedPersistence()
	}

	addPendingGlobalStateBatch(keys: GlobalStateAndSettingsKey[]): void {
		if (keys.includes("taskHistory")) throw new Error("Task history requires an ID-scoped mutation")
		keys.forEach((key) => this.pendingGlobalState.add(key))
		this.scheduleDebouncedPersistence()
	}

	addPendingTaskState(taskId: string, key: SettingsKey): void {
		if (!this.pendingTaskState.has(taskId)) {
			this.pendingTaskState.set(taskId, new Set())
		}
		this.pendingTaskState.get(taskId)?.add(key)
		this.scheduleDebouncedPersistence()
	}

	addPendingTaskStateBatch(taskId: string, keys: SettingsKey[]): void {
		if (!this.pendingTaskState.has(taskId)) {
			this.pendingTaskState.set(taskId, new Set())
		}
		keys.forEach((key) => this.pendingTaskState.get(taskId)?.add(key))
		this.scheduleDebouncedPersistence()
	}

	addPendingSecret(key: SecretKey): void {
		this.pendingSecrets.add(key)
		this.scheduleDebouncedPersistence()
	}

	addPendingSecretBatch(keys: SecretKey[]): void {
		keys.forEach((key) => this.pendingSecrets.add(key))
		this.scheduleDebouncedPersistence()
	}

	addPendingWorkspaceState(key: LocalStateKey): void {
		this.pendingWorkspaceState.add(key)
		this.scheduleDebouncedPersistence()
	}

	addPendingWorkspaceStateBatch(keys: LocalStateKey[]): void {
		keys.forEach((key) => this.pendingWorkspaceState.add(key))
		this.scheduleDebouncedPersistence()
	}

	addPendingTaskHistoryMutation(mutation: TaskHistoryMutation): void {
		this.pendingTaskHistoryMutations.push(structuredClone(mutation))
		this.scheduleDebouncedPersistence()
	}

	// ── Task-state queries ──────────────────────────────────────────────

	hasPendingTaskState(): boolean {
		return this.pendingTaskState.size > 0
	}

	async persistAndClearPendingTaskState(): Promise<void> {
		try {
			await this.persistTaskStateBatch(this.pendingTaskState)
			this.pendingTaskState.clear()
		} catch (error) {
			Logger.error("[StatePersistenceManager] Failed to persist task settings before clearing:", error)
		}
	}

	clearPendingTaskState(): void {
		this.pendingTaskState.clear()
	}

	// ── Flush / persist ─────────────────────────────────────────────────

	async persistPendingState(): Promise<void> {
		const operation = this.persistenceTail.then(() => this.persistNextBatch())
		this.persistenceTail = operation.catch(() => undefined)
		return operation
	}

	private async persistNextBatch(): Promise<void> {
		// Early return if nothing to persist
		if (
			this.pendingGlobalState.size === 0 &&
			this.pendingSecrets.size === 0 &&
			this.pendingWorkspaceState.size === 0 &&
			this.pendingTaskState.size === 0 &&
			this.pendingTaskHistoryMutations.length === 0
		) {
			return
		}

		const pendingGlobalState = this.pendingGlobalState
		const pendingSecrets = this.pendingSecrets
		const pendingWorkspaceState = this.pendingWorkspaceState
		const pendingTaskState = this.pendingTaskState
		const pendingTaskHistoryMutations = this.pendingTaskHistoryMutations
		this.pendingGlobalState = new Set()
		this.pendingSecrets = new Set()
		this.pendingWorkspaceState = new Set()
		this.pendingTaskState = new Map()
		this.pendingTaskHistoryMutations = []
		this.inFlightTaskHistoryMutations = pendingTaskHistoryMutations

		try {
			const [regularResult, taskHistoryResult] = await Promise.allSettled([
				Promise.all([
					this.persistGlobalStateBatch(pendingGlobalState),
					this.persistSecretsBatch(pendingSecrets),
					this.persistWorkspaceStateBatch(pendingWorkspaceState),
					this.persistTaskStateBatch(pendingTaskState),
				]),
				this.persistTaskHistoryBatch(pendingTaskHistoryMutations),
			])
			if (regularResult.status === "rejected") {
				for (const key of pendingGlobalState) this.pendingGlobalState.add(key)
				for (const key of pendingSecrets) this.pendingSecrets.add(key)
				for (const key of pendingWorkspaceState) this.pendingWorkspaceState.add(key)
				for (const [taskId, keys] of pendingTaskState) {
					const queuedKeys = this.pendingTaskState.get(taskId) ?? new Set<SettingsKey>()
					for (const key of keys) queuedKeys.add(key)
					this.pendingTaskState.set(taskId, queuedKeys)
				}
			}
			if (taskHistoryResult.status === "rejected") {
				this.pendingTaskHistoryMutations = [
					...pendingTaskHistoryMutations,
					...this.pendingTaskHistoryMutations,
				]
			}
			if (regularResult.status === "rejected") throw regularResult.reason
			if (taskHistoryResult.status === "rejected") throw taskHistoryResult.reason
		} finally {
			this.inFlightTaskHistoryMutations = []
		}
	}

	async flushPendingState(): Promise<void> {
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
			this.persistenceTimeout = null
		}
		await this.persistPendingState()
	}

	// Dispose watcher and pending timers — called by StateManager.dispose()
	async dispose(): Promise<void> {
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
			this.persistenceTimeout = null
		}
		const watcher = this.taskHistoryWatcher
		this.taskHistoryWatcher = null
		await this.taskHistoryWatcherCloser.closeAll(watcher ? [watcher] : [])
	}

	// ── Debounced scheduling ────────────────────────────────────────────

	private scheduleDebouncedPersistence(): void {
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
		}
		this.persistenceTimeout = setTimeout(async () => {
			this.persistenceTimeout = null
			try {
				await this.persistPendingState()
			} catch (error) {
				Logger.error("[StatePersistenceManager] Failed to persist pending changes:", error)
				this.onPersistenceError?.({ error: error })
			}
		}, this.PERSISTENCE_DELAY_MS)
	}

	// ── Batch persist implementations ───────────────────────────────────

	private async persistGlobalStateBatch(keys: Set<GlobalStateAndSettingsKey>): Promise<void> {
		const regularEntries: Record<string, any> = {}
		for (const key of keys) {
			regularEntries[key] = this.accessors.getGlobalStateValue(key)
		}
		if (Object.keys(regularEntries).length > 0) {
			this.storage.globalStateBackingStore.setBatch(regularEntries)
		}
	}

	private async persistTaskHistoryBatch(mutations: TaskHistoryMutation[]): Promise<void> {
		if (mutations.length === 0) return
		const committed = await commitTaskHistoryMutations(mutations)
		const visible = applyTaskHistoryMutations(committed, this.pendingTaskHistoryMutations)
		const cached = this.accessors.getGlobalStateValue("taskHistory")
		this.accessors.setTaskHistoryInCache(visible)
		if (JSON.stringify(visible) !== JSON.stringify(cached)) this.accessors.onTaskHistoryCommitMerged()
	}

	private async persistTaskStateBatch(pendingTaskStates: Map<string, Set<SettingsKey>>): Promise<void> {
		if (pendingTaskStates.size === 0) return
		await Promise.all(
			Array.from(pendingTaskStates.entries()).map(([taskId, keys]) => {
				if (keys.size === 0) return Promise.resolve()
				const settingsToWrite: Record<string, any> = {}
				for (const key of keys) {
					const value = this.accessors.getTaskStateValue(key)
					if (value !== undefined) {
						settingsToWrite[key] = value
					}
				}
				return writeTaskSettingsToStorage(taskId, settingsToWrite)
			}),
		)
	}

	private async persistSecretsBatch(keys: Set<SecretKey>): Promise<void> {
		const entries: Record<string, string | undefined> = {}
		for (const key of keys) {
			const value = this.accessors.getSecretValue(key)
			entries[key] = value || undefined // Convert empty strings to undefined (delete)
		}
		this.storage.secrets.setBatch(entries)
	}

	private async persistWorkspaceStateBatch(keys: Set<LocalStateKey>): Promise<void> {
		const entries: Record<string, any> = {}
		for (const key of keys) {
			entries[key] = this.accessors.getWorkspaceStateValue(key)
		}
		this.storage.workspaceState.setBatch(entries)
	}

	// ── Disk reads ──────────────────────────────────────────────────────

	readGlobalStateKeyFromDisk<K extends GlobalStateAndSettingsKey>(key: K): GlobalStateAndSettings[K] | undefined {
		this.storage.globalStateBackingStore.reloadFromDisk()
		return this.storage.globalStateBackingStore.get(key)
	}

	async readAllFromDisk(): Promise<{ globalState: GlobalState; secrets: Secrets; workspaceState: LocalState }> {
		const globalState = await readGlobalStateFromStorage(this.storage.globalState)
		const secrets = readSecretsFromStorage(this.storage.secrets)
		const workspaceState = readWorkspaceStateFromStorage(this.storage.workspaceState)
		return { globalState, secrets, workspaceState }
	}

	async loadTaskSettingsFromDisk(taskId: string): Promise<Partial<GlobalState>> {
		try {
			return await readTaskSettingsFromStorage(taskId)
		} catch (error) {
			Logger.error(
				"[StatePersistenceManager] Failed to load task settings, defaulting to globally selected settings.",
				error,
			)
			return {}
		}
	}

	async setupTaskHistoryWatcher(isInitialized: () => boolean, onSyncExternalChange: () => void | Promise<void>): Promise<void> {
		try {
			await this.taskHistoryWatcherCloser.closeAll()
			const historyFile = await getTaskHistoryStateFilePath()

			if (this.taskHistoryWatcher) {
				const previousWatcher = this.taskHistoryWatcher
				this.taskHistoryWatcher = null
				await this.taskHistoryWatcherCloser.close(previousWatcher)
			}

			const watcher = chokidar.watch(historyFile, {
				persistent: true,
				ignoreInitial: true,
				atomic: true,
				awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
			})
			this.taskHistoryWatcher = watcher

			const syncTaskHistoryFromDisk = async () => {
				try {
					if (!isInitialized()) return
					if (!(await taskHistoryStateFileExists())) return
					const onDisk = await readTaskHistoryFromState()
					const visible = applyTaskHistoryMutations(onDisk, [
						...this.inFlightTaskHistoryMutations,
						...this.pendingTaskHistoryMutations,
					])
					const cached = this.accessors.getGlobalStateValue("taskHistory")
					if (JSON.stringify(visible) !== JSON.stringify(cached)) {
						this.accessors.setTaskHistoryInCache(visible)
						await onSyncExternalChange()
					}
				} catch (err) {
					Logger.error("[StatePersistenceManager] Failed to reload task history on change:", err)
				}
			}

			watcher
				.on("error", (error) => {
					if (this.taskHistoryWatcher !== watcher) return
					this.taskHistoryWatcher = null
					Logger.error("[StatePersistenceManager] Task history live reload is disabled after watcher failure:", error)
					void this.taskHistoryWatcherCloser
						.close(watcher)
						.catch((closeError) =>
							Logger.error("[StatePersistenceManager] Failed to close disabled task history watcher:", closeError),
						)
				})
				.on("add", () => {
					if (this.taskHistoryWatcher !== watcher) return
					void syncTaskHistoryFromDisk()
				})
				.on("change", () => {
					if (this.taskHistoryWatcher !== watcher) return
					void syncTaskHistoryFromDisk()
				})
				.on("unlink", () => {
					if (this.taskHistoryWatcher !== watcher) return
					Logger.warn("[StatePersistenceManager] Task history file was removed; retaining the last valid cache")
					setTimeout(() => void syncTaskHistoryFromDisk(), 250)
				})
		} catch (err) {
			const watcher = this.taskHistoryWatcher
			this.taskHistoryWatcher = null
			if (watcher) {
				await this.taskHistoryWatcherCloser
					.close(watcher)
					.catch((closeError) =>
						Logger.error("[StatePersistenceManager] Failed to close incomplete task history watcher:", closeError),
					)
			}
			Logger.error("[StatePersistenceManager] Task history live reload could not start and is disabled:", err)
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/StateManagerSetters.ts (lines 57-68)
```
export function mutateTaskHistory(
	ctx: StateManagerSettersContext,
	mutation: TaskHistoryMutation,
): RunHistoryItem[] {
	guardInitialized(ctx)
	const immutableMutation = structuredClone(mutation)
	const updated = applyTaskHistoryMutations(ctx.globalStateCache.taskHistory, [immutableMutation])
	ctx.globalStateCache.taskHistory = updated
	ctx.persistence.addPendingTaskHistoryMutation(immutableMutation)
	ctx.notifyStateChange()
	return updated
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/paths.ts (lines 42-44)
```
export function getDiracHomePath(): string {
	return path.join(os.homedir(), ".dirac")
}
```


## Source Files:

- `src/core/storage/StateManager.ts`
- `src/core/storage/StateManagerGetters.ts`
- `src/core/storage/StateManagerModelCache.ts`
- `src/core/storage/StateManagerSetters.ts`
- `src/core/storage/StateManagerSettings.ts`
- `src/core/storage/StatePersistenceManager.ts`
- `src/core/storage/environmentMetadata.ts`
- `src/core/storage/hooksStorage.ts`
- `src/core/storage/paths.ts`
- `src/core/storage/skillsStorage.ts`
- `src/core/storage/state-migrations.ts`
- `src/core/storage/utils/state-helpers.ts`

