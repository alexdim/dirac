---
component_id: 9.1
component_name: Core State & Task History Management
---

# Core State & Task History Management

## Component Description

Manages runtime application state, settings cache, conversation history, and task directory persistence on disk.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/storage/StateManager.ts (lines 168-233)
```
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
```

### /Users/highlands/pools/Development/dirac/src/core/storage/StateManagerSettings.ts (lines 125-141)
```
export function buildEffectiveApiConfigurationFromCache(
	caches: StateManagerSettingsCaches,
	explicitOverrides?: Partial<Settings>,
): ApiConfiguration {
	const effectiveSettings = buildEffectiveSettingsFromCache(caches, explicitOverrides)
	const secrets = Object.fromEntries(
		SecretKeys.map((key) => [key, getSecret(key as keyof Secrets, caches.secretsCache)]),
	) as Secrets
	const envSecrets = getSecretsFromEnv()
	for (const [key, value] of Object.entries(envSecrets)) {
		if (value && !secrets[key as keyof Secrets]) secrets[key as keyof Secrets] = value
	}
	Object.assign(secrets, getExplicitDiracSecretsFromEnv())

	const settings = Object.fromEntries(ApiHandlerSettingsKeys.map((key) => [key, effectiveSettings[key]])) as Partial<Settings>
	return { ...secrets, ...settings } satisfies ApiConfiguration
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/TaskHistoryController.ts (lines 47-59)
```
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

