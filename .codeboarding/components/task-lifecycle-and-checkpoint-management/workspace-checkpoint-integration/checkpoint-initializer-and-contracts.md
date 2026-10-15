---
component_id: 10.2.6
component_name: Checkpoint Initializer & Contracts
---

# Checkpoint Initializer & Contracts

## Component Description

Defines shared checkpoint manager interfaces and initializes single-root or multi-root checkpoint trackers on demand.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/initializer.ts (lines 9-39)
```
export async function ensureCheckpointInitialized({
	checkpointManager,
	timeoutMs = 15_000,
	timeoutMessage = "Checkpoints taking too long to initialize. Consider re-opening Dirac in a project that uses git, or disabling checkpoints.",
}: {
	checkpointManager: ICheckpointManager | undefined
	timeoutMs?: number
	timeoutMessage?: string
}): Promise<void> {
	if (!checkpointManager) {
		return
	}
	// TaskCheckpointManager path
	const maybeInit = checkpointManager.checkpointTrackerCheckAndInit
	if (typeof maybeInit === "function") {
		await pTimeout(maybeInit.call(checkpointManager), {
			milliseconds: timeoutMs,
			message: timeoutMessage,
		})
		return
	}

	// MultiRootCheckpointManager path
	const maybeInitialize = checkpointManager.initialize
	if (typeof maybeInitialize === "function") {
		await pTimeout(maybeInitialize.call(checkpointManager), {
			milliseconds: timeoutMs,
			message: timeoutMessage,
		})
	}
}
```


## Source Files:

- `src/integrations/checkpoints/initializer.ts`
- `src/integrations/checkpoints/types.ts`

