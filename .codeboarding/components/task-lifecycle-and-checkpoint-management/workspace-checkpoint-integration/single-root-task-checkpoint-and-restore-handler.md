---
component_id: 10.2.5
component_name: Single-Root Task Checkpoint & Restore Handler
---

# Single-Root Task Checkpoint & Restore Handler

## Component Description

Orchestrates single-root task checkpoint lifecycle operations and handles workspace and task state restoration.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/index.ts (lines 322-324)
```
	async checkpointTrackerCheckAndInit(): Promise<CheckpointTracker | undefined> {
		return await this.storage.checkpointTrackerCheckAndInit()
	}
```

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/CheckpointRestoreHandler.ts (lines 87-224)
```
	async restoreCheckpoint(
		messageId: string,
		restoreType: DiracCheckpointRestore,
		offset?: number,
	): Promise<CheckpointRestoreResult> {
		try {
			const diracMessages = this.services.messageStateHandler.getDiracMessages()
			const messageIndex = diracMessages.findIndex((m) => m.id === messageId) - (offset || 0)
			const lastHashIndex = findLastIndex(diracMessages.slice(0, messageIndex), (m) => m.lastCheckpointHash !== undefined)
			const message = diracMessages[messageIndex]
			const lastMessageWithHash = diracMessages[lastHashIndex]

			if (!message) {
				Logger.error(`[CheckpointRestoreHandler] Message not found for id ${messageId} in task ${this.config.taskId}`)
				return {}
			}

			let didWorkspaceRestoreFail = false

			switch (restoreType) {
				case "task":
					break
				case "taskAndWorkspace":
				case "workspace":
					if (!this.config.enableCheckpoints) {
						const errorMessage = "Checkpoints are disabled in settings."
						Logger.error(`[CheckpointRestoreHandler] ${errorMessage} for task ${this.config.taskId}`)
						HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: errorMessage })
						didWorkspaceRestoreFail = true
						break
					}

					if (!this.storage.getTracker() && !this.storage.getErrorMessage()) {
						try {
							const workspacePath = await this.storage.getWorkspacePath()
							const tracker = await this.services.createCheckpointTracker(
								this.config.taskId,
								this.config.enableCheckpoints,
								workspacePath,
							)
							this.storage.setTracker(tracker)
							this.services.messageStateHandler.setCheckpointTracker(tracker)
						} catch (error) {
							const errorMessage = getErrorMessage(error, "Unknown error")
							Logger.error(
								`[CheckpointRestoreHandler] Failed to initialize checkpoint tracker for task ${this.config.taskId}:`,
								errorMessage,
							)
							await this.storage.setCheckpointManagerErrorMessage(errorMessage)
							HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: errorMessage })
							didWorkspaceRestoreFail = true
						}
					}

					if (message.lastCheckpointHash && this.storage.getTracker()) {
						try {
							await this.storage.getTracker()?.resetHead(message.lastCheckpointHash)
						} catch (error) {
							const errorMessage = getErrorMessage(error, "Unknown error")
							Logger.error(
								`[CheckpointRestoreHandler] Failed to restore checkpoint for task ${this.config.taskId}:`,
								errorMessage,
							)
							HostProvider.window.showMessage({
								type: ShowMessageType.ERROR,
								message: `Failed to restore checkpoint: ${errorMessage}`,
							})
							didWorkspaceRestoreFail = true
						}
					} else if (offset && lastMessageWithHash?.lastCheckpointHash && this.storage.getTracker()) {
						try {
							await this.storage.getTracker()?.resetHead(lastMessageWithHash.lastCheckpointHash)
						} catch (error) {
							const errorMessage = getErrorMessage(error, "Unknown error")
							Logger.error(
								`[CheckpointRestoreHandler] Failed to restore offset checkpoint for task ${this.config.taskId}:`,
								errorMessage,
							)
							HostProvider.window.showMessage({
								type: ShowMessageType.ERROR,
								message: `Failed to restore offset checkpoint: ${errorMessage}`,
							})
							didWorkspaceRestoreFail = true
						}
					} else if (!offset && lastMessageWithHash?.lastCheckpointHash && this.storage.getTracker()) {
						// Fallback: restore to most recent checkpoint when target message has no checkpoint hash
						Logger.warn(
							`[CheckpointRestoreHandler] Message ${messageId} has no checkpoint hash, falling back to previous checkpoint for task ${this.config.taskId}`,
						)
						try {
							await this.storage.getTracker()?.resetHead(lastMessageWithHash.lastCheckpointHash)
						} catch (error) {
							const errorMessage = getErrorMessage(error, "Unknown error")
							Logger.error(
								`[CheckpointRestoreHandler] Failed to restore fallback checkpoint for task ${this.config.taskId}:`,
								errorMessage,
							)
							HostProvider.window.showMessage({
								type: ShowMessageType.ERROR,
								message: `Failed to restore checkpoint: ${errorMessage}`,
							})
							didWorkspaceRestoreFail = true
						}
					} else {
						// Distinguish missing hash from missing tracker so users chase the right cause
						const hasHash = !!(message.lastCheckpointHash || lastMessageWithHash?.lastCheckpointHash)
						const errorMessage = hasHash
							? "Failed to restore checkpoint: checkpoint tracker not available"
							: "Failed to restore checkpoint: No valid checkpoint hash found"
						Logger.error(`[CheckpointRestoreHandler] ${errorMessage} for task ${this.config.taskId}`)
						HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: errorMessage })
						didWorkspaceRestoreFail = true
					}
					break
			}

			const checkpointManagerStateUpdate: CheckpointRestoreResult = {}

			if (!didWorkspaceRestoreFail) {
				await this.handleSuccessfulRestore(restoreType, message, messageIndex, messageId)
				if (this.conversationHistoryDeletedRange !== undefined) {
					checkpointManagerStateUpdate.conversationHistoryDeletedRange = this.conversationHistoryDeletedRange
				}
			} else {
				sendRelinquishControlEvent()
				if (this.storage.getErrorMessage() !== undefined) {
					checkpointManagerStateUpdate.checkpointManagerErrorMessage = this.storage.getErrorMessage()
				}
			}

			return checkpointManagerStateUpdate
		} catch (error) {
			const errorMessage = getErrorMessage(error, "Unknown error")
			Logger.error(`[CheckpointRestoreHandler] Failed to restore checkpoint for task ${this.config.taskId}:`, errorMessage)
			sendRelinquishControlEvent()
			return { checkpointManagerErrorMessage: errorMessage }
		}
	}
```


## Source Files:

- `src/integrations/checkpoints/CheckpointRestoreHandler.ts`
- `src/integrations/checkpoints/index.ts`

