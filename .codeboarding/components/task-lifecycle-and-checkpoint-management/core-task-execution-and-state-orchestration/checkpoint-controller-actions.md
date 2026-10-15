---
component_id: 10.1.2
component_name: Checkpoint Controller Actions
---

# Checkpoint Controller Actions

## Component Description

Handles controller-level checkpoint operations including computing checkpoint diffs, restoring task state to checkpoints, hashing working directories, and streaming checkpoint subscriptions.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/checkpoints/checkpointDiff.ts (lines 4-12)
```
export async function checkpointDiff(controller: Controller, request: Int64Request): Promise<Empty> {
	if (request.value && controller.task) {
		const message = controller.task.messageStateHandler.getDiracMessages().find((m) => m.ts === request.value)
		if (message) {
			await controller.task.checkpointManager?.presentMultifileDiff?.(message.id, false)
		}
	}
	return Empty.create()
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/checkpoints/checkpointRestore.ts (lines 10-37)
```
export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	await controller.cancelTask() // we cannot alter message history say if the task is active, as it could be in the middle of editing a file or running a command, which expect the ask to be responded to rather than being superseded by a new message eg add deleted_api_reqs

	if (request.number) {
		// wait for messages to be loaded
		await pWaitFor(() => controller.task?.stateView.isInitialized === true, {
			timeout: 3_000,
		}).catch((error) => {
			Logger.log("Failed to init new Dirac instance to restore checkpoint", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to restore checkpoint",
			})
			throw error
		})

		// NOTE: cancelTask awaits abortTask, which awaits diffViewProvider.revertChanges, which reverts any edited files, allowing us to reset to a checkpoint rather than running into a state where the revertChanges function is called alongside or after the checkpoint reset
		const message = controller.task?.messageStateHandler.getDiracMessages().find((m) => m.ts === request.number)
		if (message) {
			await controller.task?.checkpointManager?.restoreCheckpoint(
				message.id,
				request.restoreType as DiracCheckpointRestore,
				request.offset,
			)
		}
	}
	return Empty.create({})
}
```


## Source Files:

- `src/core/controller/checkpoints/checkpointDiff.ts`
- `src/core/controller/checkpoints/checkpointRestore.ts`
- `src/core/controller/checkpoints/getCwdHash.ts`
- `src/core/controller/checkpoints/subscribeToCheckpoints.ts`

