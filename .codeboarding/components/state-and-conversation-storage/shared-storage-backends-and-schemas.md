---
component_id: 9.2
component_name: Shared Storage Backends & Schemas
---

# Shared Storage Backends & Schemas

## Component Description

Provides low-level file and blob storage implementations, state and provider key definitions, environment configuration loaders, and legacy model ID migrations.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/storage/DiracFileStorage.ts (lines 19-102)
```
export class DiracFileStorage<T = any> extends DiracSyncStorage<T> {
	protected name: string
	private data: Record<string, T>
	private readonly fsPath: string
	private readonly fileMode?: number

	constructor(filePath: string, name = "DiracFileStorage", options?: DiracFileStorageOptions) {
		super()
		this.fsPath = filePath
		this.name = name
		this.fileMode = options?.fileMode
		this.data = this.readFromDisk()
	}

	/** Reload the backing JSON file so subsequent reads and writes use the latest cross-process state. */
	public reloadFromDisk(): void {
		this.data = this.readFromDisk()
	}

	protected _get(key: string): T | undefined {
		return this.data[key]
	}

	protected _set(key: string, value: T | undefined): void {
		// Use setBatch for consistency - all writes go through one path
		this.setBatch({ [key]: value })
	}

	protected _delete(key: string): void {
		this.setBatch({ [key]: undefined })
	}

	/**
	 * Set multiple keys in a single write operation.
	 * More efficient than calling set() for each key individually,
	 * since it only writes to disk once.
	 */
	public setBatch(entries: Record<string, T | undefined>): Thenable<void> {
		const changedKeys: string[] = []
		for (const [key, value] of Object.entries(entries)) {
			if (value === undefined) {
				if (key in this.data) {
					delete this.data[key]
					changedKeys.push(key)
				}
			} else {
				this.data[key] = value
				changedKeys.push(key)
			}
		}
		if (changedKeys.length > 0) {
			this.writeToDisk()
			for (const key of changedKeys) {
				this.fireChange(key)
			}
		}
		return Promise.resolve()
	}

	protected _keys(): readonly string[] {
		return Object.keys(this.data)
	}

	private readFromDisk(): Record<string, T> {
		try {
			if (fs.existsSync(this.fsPath)) {
				return JSON.parse(fs.readFileSync(this.fsPath, "utf-8"))
			}
		} catch (error) {
			Logger.error(`[${this.name}] failed to read from ${this.fsPath}:`, error)
		}
		return {}
	}

	private writeToDisk(): void {
		try {
			const dir = path.dirname(this.fsPath)
			fs.mkdirSync(dir, { recursive: true })
			atomicWriteFileSync(this.fsPath, JSON.stringify(this.data, null, 2), this.fileMode)
		} catch (error) {
			Logger.error(`[${this.name}] failed to write to ${this.fsPath}:`, error)
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/shared/storage/env-config.ts (lines 63-69)
```
export function getExplicitDiracSecretsFromEnv(): Partial<Secrets> {
	const provider = getExplicitDiracProviderFromEnv()
	const apiKeyField = provider ? ProviderToApiKeyMap[provider] : undefined
	if (!process.env.DIRAC_API_KEY || !apiKeyField) return {}
	const fields = Array.isArray(apiKeyField) ? apiKeyField : [apiKeyField]
	return { [fields[0]]: process.env.DIRAC_API_KEY }
}
```

### /Users/highlands/pools/Development/dirac/src/shared/storage/legacy-model-id-migration.ts (lines 61-71)
```
export function buildLegacyModelIdStateUpdates(
	state: Partial<GlobalStateAndSettings>,
): Partial<GlobalStateAndSettings> {
	const synthetic1mUpdates = buildLegacySynthetic1mStateUpdates(state)
	const normalizedState = { ...state, ...synthetic1mUpdates }
	return {
		...synthetic1mUpdates,
		...buildRetiredDeepSeekModelStateUpdates(normalizedState),
		...buildLegacyAnthropicFastModeStateUpdates(normalizedState),
	}
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
- `src/shared/storage/provider-keys.ts`
- `src/shared/storage/state-keys.ts`
- `src/shared/storage/storage-context.ts`
- `src/shared/storage/types.ts`

