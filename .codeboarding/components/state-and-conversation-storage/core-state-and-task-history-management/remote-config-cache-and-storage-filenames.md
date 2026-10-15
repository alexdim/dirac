---
component_id: 9.1.5
component_name: Remote Config Cache & Storage Filenames
---

# Remote Config Cache & Storage Filenames

## Component Description

Caches remote configuration payloads on disk and defines canonical storage file names.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/storage/remoteConfigCache.ts (lines 10-23)
```
export async function readRemoteConfigFromCache(organizationId: string): Promise<RemoteConfig | undefined> {
	try {
		const remoteConfigFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(organizationId))
		const fileExists = await fileExistsAtPath(remoteConfigFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(remoteConfigFilePath, "utf8")
			return JSON.parse(fileContents)
		}
		return undefined
	} catch (error) {
		Logger.error("Failed to read remote config from cache:", error)
		return undefined
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/remoteConfigCache.ts (lines 26-33)
```
export async function writeRemoteConfigToCache(organizationId: string, config: RemoteConfig): Promise<void> {
	try {
		const remoteConfigFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(organizationId))
		await fs.writeFile(remoteConfigFilePath, JSON.stringify(config))
	} catch (error) {
		Logger.error("Failed to write remote config to cache:", error)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/remoteConfigCache.ts (lines 36-46)
```
export async function deleteRemoteConfigFromCache(organizationId: string): Promise<void> {
	try {
		const remoteConfigFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(organizationId))
		const fileExists = await fileExistsAtPath(remoteConfigFilePath)
		if (fileExists) {
			await fs.unlink(remoteConfigFilePath)
		}
	} catch (error) {
		Logger.error("Failed to delete remote config from cache:", error)
	}
}
```


## Source Files:

- `src/core/storage/fileNames.ts`
- `src/core/storage/remoteConfigCache.ts`

