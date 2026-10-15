---
component_id: 10.2.1
component_name: Checkpoint Storage & Diff Presentation
---

# Checkpoint Storage & Diff Presentation

## Component Description

Manages checkpoint tracker state, storage persistence, and multifile diff presentation for single-root task checkpoints.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/CheckpointStorageManager.ts (lines 29-226)
```
export class CheckpointStorageManager {
	private readonly config: CheckpointStorageConfig
	private readonly services: CheckpointStorageServices
	private readonly callbacks: CheckpointStorageCallbacks

	private checkpointTracker?: CheckpointTracker
	private checkpointManagerErrorMessage?: string
	private checkpointTrackerInitPromise?: Promise<CheckpointTracker | undefined>

	constructor(config: CheckpointStorageConfig, services: CheckpointStorageServices, callbacks: CheckpointStorageCallbacks) {
		this.config = config
		this.services = services
		this.callbacks = callbacks
	}

	setEnabled(enabled: boolean): void {
		this.config.enableCheckpoints = enabled
	}

	isEnabled(): boolean {
		return this.config.enableCheckpoints
	}

	getTracker(): CheckpointTracker | undefined {
		return this.checkpointTracker
	}

	setTracker(tracker: CheckpointTracker | undefined): void {
		this.checkpointTracker = tracker
	}

	getErrorMessage(): string | undefined {
		return this.checkpointManagerErrorMessage
	}

	getInitPromise(): Promise<CheckpointTracker | undefined> | undefined {
		return this.checkpointTrackerInitPromise
	}

	setInitPromise(promise: Promise<CheckpointTracker | undefined> | undefined): void {
		this.checkpointTrackerInitPromise = promise
	}

	/**
	 * Checks for an active checkpoint tracker instance, creates if needed.
	 * Uses promise-based synchronization to prevent race conditions when called concurrently.
	 */
	async checkpointTrackerCheckAndInit(): Promise<CheckpointTracker | undefined> {
		if (!this.config.enableCheckpoints) return undefined
		if (this.checkpointTracker) return this.checkpointTracker
		if (this.checkpointTrackerInitPromise) return await this.checkpointTrackerInitPromise

		// Start initialization and store the promise to prevent concurrent attempts
		this.checkpointTrackerInitPromise = this.initializeCheckpointTracker()
		try {
			return await this.checkpointTrackerInitPromise
		} finally {
			this.checkpointTrackerInitPromise = undefined
		}
	}

	/**
	 * Internal method to actually create the checkpoint tracker
	 */
	private async initializeCheckpointTracker(): Promise<CheckpointTracker | undefined> {
		let checkpointsWarningTimer: NodeJS.Timeout | null = null
		let checkpointsWarningShown = false

		try {
			checkpointsWarningTimer = setTimeout(async () => {
				if (!checkpointsWarningShown) {
					checkpointsWarningShown = true
					await this.setCheckpointManagerErrorMessage(
						"Checkpoints are taking longer than expected to initialize. Working in a large repository? Consider re-opening Dirac in a project that uses git, or disabling checkpoints.",
					)
				}
			}, 7_000)

			const workspacePath = await this.getWorkspacePath()
			const tracker = await pTimeout(
				CheckpointTracker.create(this.config.taskId, this.config.enableCheckpoints, workspacePath),
				{
					milliseconds: 15_000,
					message:
						"Checkpoints taking too long to initialize. Consider re-opening Dirac in a project that uses git, or disabling checkpoints.",
				},
			)

			this.checkpointTracker = tracker
			return tracker
		} catch (error) {
			const errorMessage = getErrorMessage(error, "Unknown error")
			Logger.error("Failed to initialize checkpoint tracker:", errorMessage)

			if (errorMessage.includes("Checkpoints taking too long to initialize")) {
				await this.setCheckpointManagerErrorMessage(
					"Checkpoints initialization timed out. Consider re-opening Dirac in a project that uses git, or disabling checkpoints.",
				)
			} else {
				await this.setCheckpointManagerErrorMessage(errorMessage)
			}
			return undefined
		} finally {
			if (checkpointsWarningTimer) {
				clearTimeout(checkpointsWarningTimer)
				checkpointsWarningTimer = null
			}
		}
	}

	/**
	 * Updates the checkpoint tracker error message and posts to webview
	 */
	async setCheckpointManagerErrorMessage(errorMessage: string | undefined): Promise<void> {
		this.checkpointManagerErrorMessage = errorMessage
		this.services.taskState.checkpointManagerErrorMessage = errorMessage
		try {
			await this.callbacks.postStateToWebview()
		} catch (error) {
			Logger.error("Failed to post state to webview after checkpoint error:", error)
		}
	}

	/**
	 * Creates a checkpoint commit in the underlying tracker
	 * @returns The created commit hash, or undefined if failed
	 */
	async commit(): Promise<string | undefined> {
		try {
			if (!this.config.enableCheckpoints) return undefined
			if (!this.checkpointTracker) await this.checkpointTrackerCheckAndInit()
			if (!this.checkpointTracker) {
				Logger.error(
					`[CheckpointStorageManager] Checkpoint tracker not available for commit in task ${this.config.taskId}`,
				)
				return undefined
			}
			return await this.checkpointTracker.commit()
		} catch (error) {
			const errorMessage = getErrorMessage(error, "Unknown error")
			Logger.error(
				`[CheckpointStorageManager] Failed to create checkpoint commit for task ${this.config.taskId}:`,
				errorMessage,
			)
			return undefined
		}
	}

	/**
	 * Gets the workspace path from WorkspaceRootManager when available, otherwise falls back to CheckpointUtils
	 */
	async getWorkspacePath(): Promise<string> {
		if (this.services.workspaceManager) {
			try {
				const primaryRoot = this.services.workspaceManager.getPrimaryRoot()
				if (primaryRoot) return primaryRoot.path
				Logger.warn(
					`[CheckpointStorageManager] WorkspaceRootManager returned no primary root for task ${this.config.taskId}`,
				)
			} catch (error) {
				Logger.warn(
					`[CheckpointStorageManager] Failed to get workspace path from WorkspaceRootManager for task ${this.config.taskId}:`,
					error,
				)
			}
		}
		// Fallback to the legacy CheckpointUtils implementation
		const { getWorkingDirectory: getWorkingDirectoryImpl } = await import("./CheckpointUtils")
		return getWorkingDirectoryImpl()
	}

	/**
	 * Ensures the tracker is initialized, creating it inline if needed (used by restore/diff paths)
	 */
	async ensureTrackerInitialized(): Promise<CheckpointTracker | undefined> {
		if (!this.config.enableCheckpoints) return undefined
		if (!this.checkpointTracker && !this.checkpointManagerErrorMessage) {
			try {
				const workspacePath = await this.getWorkspacePath()
				this.checkpointTracker = await CheckpointTracker.create(
					this.config.taskId,
					this.config.enableCheckpoints,
					workspacePath,
				)
				this.services.messageStateHandler.setCheckpointTracker(this.checkpointTracker)
			} catch (error) {
				const errorMessage = getErrorMessage(error, "Unknown error")
				Logger.error(
					`[CheckpointStorageManager] Failed to initialize checkpoint tracker for task ${this.config.taskId}:`,
					errorMessage,
				)
				this.checkpointManagerErrorMessage = errorMessage
				return undefined
			}
		}
		return this.checkpointTracker
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/CheckpointDiffPresenter.ts (lines 28-175)
```
export class CheckpointDiffPresenter {
	private readonly config: CheckpointDiffConfig
	private readonly services: CheckpointDiffServices
	private readonly storage: CheckpointStorageManager

	constructor(config: CheckpointDiffConfig, services: CheckpointDiffServices, storage: CheckpointStorageManager) {
		this.config = config
		this.services = services
		this.storage = storage
	}

	setEnabled(enabled: boolean): void {
		this.config.enableCheckpoints = enabled
	}

	/**
	 * Presents a multi-file diff view between checkpoints
	 * @param messageId - ID of the message to show diff for
	 * @param seeNewChangesSinceLastTaskCompletion - Whether to show changes since last completion
	 */
	async presentMultifileDiff(messageId: string, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void> {
		const relinquishButton = () => {
			sendRelinquishControlEvent()
		}

		try {
			if (!this.config.enableCheckpoints) {
				const errorMessage = "Checkpoints are disabled in settings. Cannot show diff."
				Logger.error(`[CheckpointDiffPresenter] ${errorMessage} for task ${this.config.taskId}`)
				HostProvider.window.showMessage({ type: ShowMessageType.INFORMATION, message: errorMessage })
				relinquishButton()
				return
			}

			Logger.log(`[CheckpointDiffPresenter] presentMultifileDiff for task ${this.config.taskId}, messageId: ${messageId}`)
			const diracMessages = this.services.messageStateHandler.getDiracMessages()
			const messageIndex = diracMessages.findIndex((m) => m.id === messageId)
			const message = diracMessages[messageIndex]
			if (!message) {
				Logger.error(`[CheckpointDiffPresenter] Message not found for id ${messageId} in task ${this.config.taskId}`)
				relinquishButton()
				return
			}
			const hash = message.lastCheckpointHash
			if (!hash) {
				Logger.error(
					`[CheckpointDiffPresenter] No checkpoint hash found for message ${messageId} in task ${this.config.taskId}`,
				)
				relinquishButton()
				return
			}

			// Initialize checkpoint tracker if needed
			if (!this.storage.getTracker() && this.config.enableCheckpoints && !this.storage.getErrorMessage()) {
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
						`[CheckpointDiffPresenter] Failed to initialize checkpoint tracker for task ${this.config.taskId}:`,
						errorMessage,
					)
					this.storage.setCheckpointManagerErrorMessage(errorMessage)
					HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: errorMessage })
					relinquishButton()
					return
				}
			}

			if (!this.storage.getTracker()) {
				Logger.error(`[CheckpointDiffPresenter] Checkpoint tracker not available for task ${this.config.taskId}`)
				HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: "Checkpoint tracker not available" })
				relinquishButton()
				return
			}

			let changedFiles: { relativePath: string; absolutePath: string; before: string; after: string }[] | undefined

			if (seeNewChangesSinceLastTaskCompletion) {
				// Get last task completed
				const lastTaskCompletedMessageCheckpointHash = findLast(
					this.services.messageStateHandler.getDiracMessages().slice(0, messageIndex),
					(m) => m.content.type === "card" && isTaskCompletionCard(m.content.card),
				)?.lastCheckpointHash

				// This value *should* always exist
				const firstCheckpointMessageCheckpointHash = this.services.messageStateHandler
					.getDiracMessages()
					.find((m) => m.content.type === "checkpoint")?.lastCheckpointHash

				const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash

				if (!previousCheckpointHash) {
					const errorMessage = "Unexpected error: No checkpoint hash found"
					Logger.error(`[CheckpointDiffPresenter] ${errorMessage} for task ${this.config.taskId}`)
					HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: errorMessage })
					relinquishButton()
					return
				}

				// Get changed files between current state and commit
				changedFiles = await this.storage.getTracker()?.getDiffSet(previousCheckpointHash, hash)
				if (!changedFiles?.length) {
					HostProvider.window.showMessage({ type: ShowMessageType.INFORMATION, message: "No changes found" })
					relinquishButton()
					return
				}
			} else {
				// Get changed files between current state and commit
				changedFiles = await this.storage.getTracker()?.getDiffSet(hash)
				if (!changedFiles?.length) {
					HostProvider.window.showMessage({ type: ShowMessageType.INFORMATION, message: "No changes found" })
					relinquishButton()
					return
				}
			}

			// Open multi-diff editor
			const title = seeNewChangesSinceLastTaskCompletion ? "New changes" : "Changes since snapshot"
			const diffs = changedFiles.map((file) => ({
				filePath: file.absolutePath,
				leftContent: file.before,
				rightContent: file.after,
			}))
			await HostProvider.diff.openMultiFileDiff({ title, diffs })

			relinquishButton()
		} catch (error) {
			const errorMessage = getErrorMessage(error, "Unknown error")
			Logger.error(
				`[CheckpointDiffPresenter] Failed to present multifile diff for task ${this.config.taskId}:`,
				errorMessage,
			)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to retrieve diff set: ${errorMessage}`,
			})
			relinquishButton()
		}
	}
}
```


## Source Files:

- `src/integrations/checkpoints/CheckpointDiffPresenter.ts`
- `src/integrations/checkpoints/CheckpointStorageManager.ts`
- `src/integrations/checkpoints/DiffContentProvider.ts`

