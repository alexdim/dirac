---
component_id: 9.2.1
component_name: Storage Backends & Environment Adapters
---

# Storage Backends & Environment Adapters

## Component Description

Provides file, blob, and in-memory storage implementations, storage context initialization, environment variable configuration resolvers, and message content format adapters.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/storage/DiracStorage.ts (lines 34-113)
```
export abstract class DiracStorage {
	/**
	 * The name of the storage, used for logging purposes.
	 */
	protected name = "DiracStorage"
	/**
	 * List of subscribers to storage change events.
	 */
	private readonly subscribers: Array<StorageEventListener> = []

	/**
	 * Subscribe to storage change events.
	 */
	public onDidChange(callback: StorageEventListener): () => void {
		this.subscribers.push(callback)
		return () => {
			const callbackIndex = this.subscribers.indexOf(callback)
			if (callbackIndex >= 0) {
				this.subscribers.splice(callbackIndex, 1)
			}
		}
	}

	/**
	 * Get a value from storage. This method is final and cannot be overridden.
	 * Subclasses should implement _get() to define their storage retrieval logic.
	 */
	public async get(key: string): Promise<string | undefined> {
		try {
			return await this._get(key)
		} catch {
			return undefined
		}
	}

	async _dangerousStore(key: string, value: string): Promise<void> {
		await this._store(key, value)
	}

	/**
	 * Store a value in storage. This method is final and cannot be overridden.
	 * Subclasses should implement _store() to define their storage logic.
	 * This method automatically fires change events after storing.
	 */
	public async store(key: string, value: string): Promise<void> {
		try {
			await this._dangerousStore(key, value)
		} catch (error) {
			Logger.error(`[${this.name}] failed to store '${key}':`, error)
		}
	}

	/**
	 * Delete a value from storage. This method is final and cannot be overridden.
	 * Subclasses should implement _delete() to define their deletion logic.
	 * This method automatically fires change events after deletion.
	 */
	public async delete(key: string): Promise<void> {
		try {
			await this._delete(key)
		} catch {
			// Silently fail on delete errors
		}
	}

	/**
	 * Abstract method that subclasses must implement to retrieve values from their storage.
	 */
	protected abstract _get(key: string): Promise<string | undefined>

	/**
	 * Abstract method that subclasses must implement to store values in their storage.
	 */
	protected abstract _store(key: string, value: string): Promise<void>

	/**
	 * Abstract method that subclasses must implement to delete values from their storage.
	 */
	protected abstract _delete(key: string): Promise<void>
}
```

### /Users/highlands/pools/Development/dirac/src/shared/storage/DiracStorage.ts (lines 127-212)
```
export abstract class DiracSyncStorage<T = any> {
	protected abstract name: string

	/**
	 * List of subscribers to storage change events.
	 */
	private readonly changeSubscribers: Array<SyncStorageEventListener> = []

	/**
	 * Subscribe to storage change events. Returns an unsubscribe function.
	 */
	public onDidChange(callback: SyncStorageEventListener): () => void {
		this.changeSubscribers.push(callback)
		return () => {
			const idx = this.changeSubscribers.indexOf(callback)
			if (idx >= 0) {
				this.changeSubscribers.splice(idx, 1)
			}
		}
	}

	/**
	 * Notify all subscribers of a key change.
	 */
	protected fireChange(key: string): void {
		for (const subscriber of this.changeSubscribers) {
			try {
				subscriber({ key })
			} catch (error) {
				Logger.error(`[${this.name}] change subscriber error for '${key}':`, error)
			}
		}
	}

	public get<V = T>(key: string): V | undefined
	public get<V = T>(key: string, defaultValue: V): V
	public get<V = T>(key: string, defaultValue?: V): V | undefined {
		try {
			const value = this._get(key) as V | undefined
			return value !== undefined ? value : defaultValue
		} catch (error) {
			Logger.error(`[${this.name}] failed to get '${key}':`, error)
			return defaultValue
		}
	}

	/**
	 * Memento-compatible update method. Calls set() internally.
	 */
	public update(key: string, value: any): Thenable<void> {
		this.set(key, value)
		return Promise.resolve()
	}

	public set(key: string, value: T | undefined): void {
		try {
			this._set(key, value)
			this.fireChange(key)
		} catch (error) {
			Logger.error(`[${this.name}] failed to set '${key}':`, error)
		}
	}

	public delete(key: string): void {
		try {
			this._delete(key)
			this.fireChange(key)
		} catch (error) {
			Logger.error(`[${this.name}] failed to delete '${key}':`, error)
		}
	}

	public keys(): readonly string[] {
		try {
			return this._keys()
		} catch (error) {
			Logger.error(`[${this.name}] failed to get keys:`, error)
			return []
		}
	}

	protected abstract _get(key: string): T | undefined
	protected abstract _set(key: string, value: T | undefined): void
	protected abstract _delete(key: string): void
	protected abstract _keys(): readonly string[]
}
```

### /Users/highlands/pools/Development/dirac/src/shared/storage/storage-context.ts (lines 94-126)
```
export function createStorageContext(opts: StorageContextOptions = {}): StorageContext {
	const diracDir = opts.diracDir || process.env.DIRAC_DIR || path.join(os.homedir(), ".dirac")
	const dataDir = path.join(diracDir, SETTINGS_SUBFOLDER)

	// Resolve workspace storage directory
	let workspaceDir: string
	if (opts.workspaceStorageDir) {
		// Explicit override (JetBrains via env var, or test overrides)
		workspaceDir = opts.workspaceStorageDir
	} else {
		// Hash-based workspace isolation (CLI, VSCode)
		const workspacePath = opts.workspacePath || process.cwd()
		const workspaceHash = hashString(workspacePath)
		workspaceDir = path.join(dataDir, "workspaces", workspaceHash)
	}

	// Ensure directories exist
	fsSync.mkdirSync(dataDir, { recursive: true })
	fsSync.mkdirSync(workspaceDir, { recursive: true })

	const globalState = new DiracFileStorage(path.join(dataDir, "globalState.json"), "GlobalState")

	return {
		globalState,
		globalStateBackingStore: globalState,
		secrets: new DiracFileStorage<string>(path.join(dataDir, "secrets.json"), "Secrets", {
			fileMode: 0o600, // Owner read/write only — protects API keys
		}),
		workspaceState: new DiracFileStorage(path.join(workspaceDir, "workspaceState.json"), "WorkspaceState"),
		dataDir,
		workspaceStoragePath: workspaceDir,
	}
}
```

### /Users/highlands/pools/Development/dirac/src/shared/storage/env-config.ts (lines 71-88)
```
export function getExplicitDiracSettingsFromEnv(): Partial<Settings> {
	const provider = getExplicitDiracProviderFromEnv()
	if (!provider) return {}

	const settings: Partial<Settings> = {
		actModeApiProvider: provider,
		planModeApiProvider: provider,
	}
	if (process.env.DIRAC_MODEL) {
		settings[getProviderModelIdKey(provider, "act")] = process.env.DIRAC_MODEL as never
		settings[getProviderModelIdKey(provider, "plan")] = process.env.DIRAC_MODEL as never
	}
	const baseUrlKey = ProviderToBaseUrlKeyMap[provider]
	if (baseUrlKey && process.env.DIRAC_BASE_URL) {
		settings[baseUrlKey] = process.env.DIRAC_BASE_URL as never
	}
	return settings
}
```


## Source Files:

- `src/shared/messages/content.ts`
- `src/shared/storage/DiracBlobStorage.ts`
- `src/shared/storage/DiracFileStorage.ts`
- `src/shared/storage/DiracStorage.ts`
- `src/shared/storage/adapters.ts`
- `src/shared/storage/env-config.ts`
- `src/shared/storage/legacy-model-id-migration.ts`
- `src/shared/storage/storage-context.ts`
- `src/shared/storage/types.ts`

