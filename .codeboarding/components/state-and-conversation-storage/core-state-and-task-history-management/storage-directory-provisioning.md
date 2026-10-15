---
component_id: 9.1.4
component_name: Storage Directory Provisioning
---

# Storage Directory Provisioning

## Component Description

Ensures global, state, cache, and task-specific storage directories exist and handles legacy directory migration.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/storage/directoryEnsurers.ts (lines 9-11)
```
export async function ensureTaskDirectoryExists(taskId: string): Promise<string> {
	return getGlobalStorageDir("tasks", taskId)
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/directoryEnsurers.ts (lines 84-86)
```
export async function ensureStateDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("state")
}
```

### /Users/highlands/pools/Development/dirac/src/core/storage/directoryEnsurers.ts (lines 89-91)
```
export async function ensureCacheDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("cache")
}
```


## Source Files:

- `src/core/storage/directoryEnsurers.ts`
- `src/core/storage/globalStorageDir.ts`

