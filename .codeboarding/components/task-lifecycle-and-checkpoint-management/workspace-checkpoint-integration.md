---
component_id: 10.2
component_name: Workspace Checkpoint Integration
---

# Workspace Checkpoint Integration

## Component Description

Manages Git-backed workspace checkpoints, multi-root tracking, storage lifecycle, diff presentation, and state restoration.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/index.ts (lines 62-350)
```
export class TaskCheckpointManager implements ICheckpointManager {
	private readonly task: CheckpointManagerTask
	private readonly config: CheckpointManagerConfig
	private readonly services: CheckpointManagerServices
	private readonly callbacks: CheckpointManagerCallbacks
	private readonly taskState: TaskState
	private readonly storage: CheckpointStorageManager
	private readonly restoreHandler: CheckpointRestoreHandler
	private readonly diffPresenter: CheckpointDiffPresenter
	private conversationHistoryDeletedRange?: [number, number]

	constructor(
		task: CheckpointManagerTask,
		config: CheckpointManagerConfig,
		services: CheckpointManagerServices,
		callbacks: CheckpointManagerCallbacks,
		initialState: CheckpointManagerInternalState,
	) {
		this.task = Object.freeze(task)
		this.config = config
		this.services = services
		this.callbacks = Object.freeze(callbacks)
		this.taskState = services.taskState
		this.conversationHistoryDeletedRange = initialState.conversationHistoryDeletedRange

		this.storage = new CheckpointStorageManager(
			{ taskId: task.taskId, enableCheckpoints: config.enableCheckpoints },
			{
				messageStateHandler: services.messageStateHandler,
				taskState: services.taskState,
				workspaceManager: services.workspaceManager,
			},
			{ postStateToWebview: callbacks.postStateToWebview },
		)
		if (initialState.checkpointTracker) this.storage.setTracker(initialState.checkpointTracker)
		if (initialState.checkpointManagerErrorMessage)
			this.storage.setCheckpointManagerErrorMessage(initialState.checkpointManagerErrorMessage)

		this.restoreHandler = new CheckpointRestoreHandler(
			{ taskId: task.taskId, enableCheckpoints: config.enableCheckpoints },
			{
				messageStateHandler: services.messageStateHandler,
				fileContextTracker: services.fileContextTracker,
				taskState: services.taskState,
				createCheckpointTracker,
			},
			{
				cancelTask: callbacks.cancelTask,
				resetTransientState: callbacks.resetTransientState,
				taskMessenger: callbacks.taskMessenger,
			},
			this.storage,
			initialState.conversationHistoryDeletedRange,
		)

		this.diffPresenter = new CheckpointDiffPresenter(
			{ taskId: task.taskId, enableCheckpoints: config.enableCheckpoints },
			{
				messageStateHandler: services.messageStateHandler,
				createCheckpointTracker,
			},
			this.storage,
		)
	}

	setEnabled(enabled: boolean): void {
		this.config.enableCheckpoints = enabled
		this.storage.setEnabled(enabled)
		this.restoreHandler.setEnabled(enabled)
		this.diffPresenter.setEnabled(enabled)
	}

	isEnabled(): boolean {
		return this.config.enableCheckpoints
	}

	/** Creates a checkpoint of the current workspace state */
	async saveCheckpoint(isAttemptCompletionMessage = false, completionMessageId?: string): Promise<void> {
		try {
			if (
				!this.config.enableCheckpoints ||
				this.storage.getErrorMessage()?.includes("Checkpoints initialization timed out.")
			)
				return

			// Checkpoint creation is an explicit boundary, so clearing prior selections may scan checkpoint rows.
			const diracMessages = this.services.messageStateHandler.getDiracMessages()
			for (const message of diracMessages) {
				if (message.lastCheckpointHash && message.isCheckpointCheckedOut) {
					await this.services.messageStateHandler.patchMessageById(message.id, { isCheckpointCheckedOut: false })
				}
			}

			// Initialize tracker if needed (non-attempt: only first time; attempt: one last chance)
			if (
				!this.storage.getTracker() &&
				!this.storage.getErrorMessage()?.includes("Checkpoints initialization timed out.")
			) {
				if (!isAttemptCompletionMessage && !this.storage.getErrorMessage()) {
					await this.checkpointTrackerCheckAndInit()
				} else if (isAttemptCompletionMessage) {
					await this.checkpointTrackerCheckAndInit()
				}
			}

			if (!this.storage.getTracker()) {
				Logger.error(
					`[TaskCheckpointManager] Failed to save checkpoint for task ${this.task.taskId}: Checkpoint tracker not available`,
				)
				return
			}

			if (!isAttemptCompletionMessage) {
				// Ensure we aren't creating back-to-back checkpoint_created messages
				if (diracMessages.at(-1)?.content.type === "checkpoint") return

				// Create a new checkpoint message and asynchronously add the commitHash
				const cardHandle = await this.callbacks.taskMessenger.createCheckpoint()
				if (this.services.messageStateHandler.getMessageById(cardHandle.id)) {
					// Optimization: Background commit
					this.storage
						.getTracker()
						?.commit()
						.then(async (commitHash) => {
							if (commitHash) {
								await this.services.messageStateHandler.patchMessageById(cardHandle.id, { lastCheckpointHash: commitHash })
								await this.services.messageStateHandler.saveDiracMessagesAndUpdateHistory()
							}
						})
						.catch((error) => {
							Logger.error(
								`[TaskCheckpointManager] Failed to create checkpoint commit for task ${this.task.taskId}:`,
								error,
							)
						})
				}
			} else {
				// Avoid duplicate completion checkpoints near the terminal response card.
				const lastFivediracMessages = this.services.messageStateHandler.getDiracMessages().slice(-3)
				const lastCompletionResultMessage = findLast(
					lastFivediracMessages,
					(m) => m.content.type === "card" && isTaskCompletionCard(m.content.card),
				)
				if (lastCompletionResultMessage?.lastCheckpointHash) {
					Logger.log("Completion checkpoint already exists, skipping duplicate checkpoint creation")
					return
				}

				// Commit then update the completion_result message with the checkpoint hash
				const commitHash = await this.storage.getTracker()?.commit()
				if (completionMessageId) {
					if (this.services.messageStateHandler.getMessageById(completionMessageId)) {
						await this.services.messageStateHandler.patchMessageById(completionMessageId, { lastCheckpointHash: commitHash })
						await this.services.messageStateHandler.saveDiracMessagesAndUpdateHistory()
					}
				} else if (lastCompletionResultMessage) {
					await this.services.messageStateHandler.patchMessageById(lastCompletionResultMessage.id, { lastCheckpointHash: commitHash })
					await this.services.messageStateHandler.saveDiracMessagesAndUpdateHistory()
				}
			}
		} catch (error) {
			const errorMessage = getErrorMessage(error, "Unknown error")
			Logger.error(`[TaskCheckpointManager] Failed to save checkpoint for task ${this.task.taskId}:`, errorMessage)
		}
	}

	/** Restores a checkpoint by message ID */
	async restoreCheckpoint(
		messageId: string,
		restoreType: DiracCheckpointRestore,
		offset?: number,
	): Promise<CheckpointRestoreStateUpdate> {
		const result = await this.restoreHandler.restoreCheckpoint(messageId, restoreType, offset)
		this.conversationHistoryDeletedRange = this.restoreHandler.getConversationHistoryDeletedRange()
		return result
	}

	/** Presents a multi-file diff view between checkpoints */
	async presentMultifileDiff(messageId: string, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void> {
		await this.diffPresenter.presentMultifileDiff(messageId, seeNewChangesSinceLastTaskCompletion)
	}

	/** Creates a checkpoint commit in the underlying tracker */
	async commit(): Promise<string | undefined> {
		return await this.storage.commit()
	}

	/** Checks if the latest task completion has new changes */
	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		try {
			if (!this.config.enableCheckpoints) return false

			const diracMessages = this.services.messageStateHandler.getDiracMessages()
			const messageIndex = findLastIndex(
				diracMessages,
				(m) => m.content.type === "card" && isTaskCompletionCard(m.content.card),
			)
			const message = diracMessages[messageIndex]
			if (!message) {
				Logger.error(`[TaskCheckpointManager] Completion message not found for task ${this.task.taskId}`)
				return false
			}
			const hash = message.lastCheckpointHash
			if (!hash) {
				Logger.error(
					`[TaskCheckpointManager] No checkpoint hash found for completion message in task ${this.task.taskId}`,
				)
				return false
			}

			// Initialize tracker if needed
			if (!this.storage.getTracker() && !this.storage.getErrorMessage()) {
				try {
					const workspacePath = await this.storage.getWorkspacePath()
					const tracker = await CheckpointTracker.create(this.task.taskId, this.config.enableCheckpoints, workspacePath)
					this.storage.setTracker(tracker)
					this.services.messageStateHandler.setCheckpointTracker(tracker)
				} catch (error) {
					const errorMessage = getErrorMessage(error, "Unknown error")
					Logger.error(
						`[TaskCheckpointManager] Failed to initialize checkpoint tracker for task ${this.task.taskId}:`,
						errorMessage,
					)
					await this.storage.setCheckpointManagerErrorMessage(errorMessage)
					return false
				}
			}

			if (!this.storage.getTracker()) {
				Logger.error(`[TaskCheckpointManager] Checkpoint tracker not available for task ${this.task.taskId}`)
				return false
			}

			// Find previous checkpoint hash (last completion or first checkpoint)
			const lastTaskCompletedMessageCheckpointHash = findLast(
				this.services.messageStateHandler.getDiracMessages().slice(0, messageIndex),
				(m) => m.content.type === "card" && isTaskCompletionCard(m.content.card),
			)?.lastCheckpointHash
			const firstCheckpointMessageCheckpointHash = this.services.messageStateHandler
				.getDiracMessages()
				.find((m) => m.content.type === "checkpoint")?.lastCheckpointHash
			const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash

			if (!previousCheckpointHash) {
				Logger.error(`[TaskCheckpointManager] No previous checkpoint hash found for task ${this.task.taskId}`)
				return false
			}

			const changedFilesCount = (await this.storage.getTracker()?.getDiffCount(previousCheckpointHash, hash)) || 0
			return changedFilesCount > 0
		} catch (error) {
			const errorMessage = getErrorMessage(error, "Unknown error")
			Logger.error(`[TaskCheckpointManager] Failed to check for new changes in task ${this.task.taskId}:`, errorMessage)
			return false
		}
	}

	// --- State management delegation ---

	/** Checks for an active checkpoint tracker instance, creates if needed */
	async checkpointTrackerCheckAndInit(): Promise<CheckpointTracker | undefined> {
		return await this.storage.checkpointTrackerCheckAndInit()
	}

	/** Updates the checkpoint tracker instance */
	setCheckpointTracker(checkpointTracker: CheckpointTracker | undefined): void {
		this.storage.setTracker(checkpointTracker)
	}

	/** Updates the checkpoint tracker error message and posts to webview */
	async setcheckpointManagerErrorMessage(errorMessage: string | undefined): Promise<void> {
		await this.storage.setCheckpointManagerErrorMessage(errorMessage)
	}

	/** Updates the conversation history deleted range */
	updateConversationHistoryDeletedRange(range: [number, number] | undefined): void {
		this.conversationHistoryDeletedRange = range
	}

	/** Provides public read-only access to current state */
	public getCurrentState(): Readonly<CheckpointManagerInternalState> {
		return Object.freeze({
			conversationHistoryDeletedRange: this.conversationHistoryDeletedRange,
			checkpointTracker: this.storage.getTracker(),
			checkpointManagerErrorMessage: this.storage.getErrorMessage(),
			checkpointTrackerInitPromise: this.storage.getInitPromise(),
		})
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/MultiRootCheckpointManager.ts (lines 44-319)
```
export class MultiRootCheckpointManager implements ICheckpointManager {
	private trackers: Map<string, CheckpointTracker> = new Map()
	private initialized = false
	private initPromise?: Promise<void>

	constructor(
		private workspaceManager: WorkspaceRootManager,
		private taskId: string,
		private enableCheckpoints: boolean,
		private messageStateHandler: MessageStateHandler,
	) { }

	setEnabled(enabled: boolean): void {
		this.enableCheckpoints = enabled
	}

	isEnabled(): boolean {
		return this.enableCheckpoints
	}

	/**
	 * Initialize checkpoint trackers for all workspace roots
	 * This is called separately to avoid blocking the Task constructor
	 */
	async initialize(): Promise<void> {
		// Prevent multiple initialization attempts
		if (this.initialized) {
			return
		}

		if (this.initPromise) {
			return this.initPromise
		}

		this.initPromise = this.doInitialize()
		await this.initPromise
		this.initPromise = undefined
	}

	private async doInitialize(): Promise<void> {
		if (!this.enableCheckpoints) {
			Logger.log("[MultiRootCheckpointManager] Checkpoints disabled, skipping initialization")
			return
		}

		const startTime = performance.now()
		const roots = this.workspaceManager.getRoots()
		Logger.log(`[MultiRootCheckpointManager] Initializing for ${roots.length} workspace roots`)

		// Initialize all workspace roots in parallel
		const initPromises = roots.map(async (root) => {
			try {
				Logger.log(`[MultiRootCheckpointManager] Creating tracker for ${root.name} at ${root.path}`)
				const tracker = await CheckpointTracker.create(this.taskId, this.enableCheckpoints, root.path)
				if (tracker) {
					this.trackers.set(root.path, tracker)
					Logger.log(`[MultiRootCheckpointManager] Successfully initialized tracker for ${root.name}`)
					return true
				}
				return false
			} catch (error) {
				Logger.error(`[MultiRootCheckpointManager] Failed to initialize checkpoint for ${root.name}:`, error)
				// Continue with other roots even if one fails
				return false
			}
		})

		const results = await Promise.all(initPromises)
		const successCount = results.filter((r) => r).length
		const failureCount = results.length - successCount

		this.initialized = true
		Logger.log(`[MultiRootCheckpointManager] Initialization complete. Active trackers: ${this.trackers.size}`)

		// TELEMETRY: Track multi-root checkpoint initialization
		telemetryService.captureMultiRootCheckpoint(
			this.taskId,
			"initialized",
			roots.length,
			successCount,
			failureCount,
			performance.now() - startTime,
		)
	}

	/**
	 * Save checkpoint across all workspace roots
	 * Commits happen in parallel in the background (non-blocking)
	 */
	async saveCheckpoint(): Promise<void> {
		if (!this.enableCheckpoints || !this.initialized) {
			return
		}

		if (this.trackers.size === 0) {
			Logger.log("[MultiRootCheckpointManager] No trackers available for checkpoint")
			return
		}

		Logger.log(`[MultiRootCheckpointManager] Creating checkpoint across ${this.trackers.size} workspace(s)`)

		// Commit all roots in parallel (fire and forget for performance)
		const commitPromises = Array.from(this.trackers.entries()).map(async ([path, tracker]) => {
			try {
				const hash = await tracker.commit()
				if (hash) {
					const rootName = this.workspaceManager.getRoots().find((r) => r.path === path)?.name || path
					Logger.log(`[MultiRootCheckpointManager] Checkpoint saved for ${rootName}: ${hash}`)
				}
				return { path, hash, success: true }
			} catch (error) {
				const rootName = this.workspaceManager.getRoots().find((r) => r.path === path)?.name || path
				Logger.error(`[MultiRootCheckpointManager] Failed to checkpoint ${rootName}:`, error)
				return { path, hash: undefined, success: false }
			}
		})

		// Don't await - let commits happen in background for better performance
		// But do catch any errors to prevent unhandled promise rejections
		const startTime = performance.now()
		Promise.all(commitPromises)
			.then((results) => {
				const successful = results.filter((r) => r.success).length
				const failed = results.length - successful
				Logger.log(`[MultiRootCheckpointManager] Checkpoint complete: ${successful}/${results.length} successful`)

				// TELEMETRY: Track checkpoint commits
				telemetryService.captureMultiRootCheckpoint(
					this.taskId,
					"committed",
					results.length,
					successful,
					failed,
					performance.now() - startTime,
				)
			})
			.catch((error) => {
				Logger.error("[MultiRootCheckpointManager] Unexpected error during checkpoint:", error)
			})
	}

	/**
	 * Restore checkpoint for workspace roots
	 * For now, this restores the primary root only for simplicity
	 * Future enhancement: restore all roots to their respective checkpoints
	 */
	async restoreCheckpoint(): Promise<any> {
		if (!this.enableCheckpoints) return { error: "Checkpoints are disabled in settings" }
		const primaryRoot = this.workspaceManager.getPrimaryRoot()
		if (!primaryRoot) {
			Logger.error("[MultiRootCheckpointManager] No primary root found")
			return { error: "No primary workspace found" }
		}

		const tracker = this.trackers.get(primaryRoot.path)

		if (!tracker) {
			Logger.error(`[MultiRootCheckpointManager] No tracker found for primary root: ${primaryRoot.path}`)
			return { error: "No checkpoint tracker for primary workspace" }
		}

		Logger.log(`[MultiRootCheckpointManager] Restoring checkpoint for primary root: ${primaryRoot.name}`)

		// TODO: Implement full restore logic similar to TaskCheckpointManager
		// For now, this is a placeholder that would delegate to the existing restore logic
		// In a full implementation, we'd restore all roots or provide options to the user

		return {}
	}

	/**
	 * Check if the latest task completion has new changes
	 * Returns true if ANY workspace has changes
	 */
	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		if (!this.enableCheckpoints || !this.initialized || this.trackers.size === 0) {
			return false
		}

		// Check if any root has changes
		for (const [path] of this.trackers.entries()) {
			try {
				// TODO: Implement proper diff checking logic
				// This would need to track checkpoint hashes per root
				// For now, return false as a safe default
				const rootName = this.workspaceManager.getRoots().find((r) => r.path === path)?.name || path
				Logger.log(`[MultiRootCheckpointManager] Checking for changes in ${rootName}`)
			} catch (error) {
				Logger.error(`[MultiRootCheckpointManager] Error checking changes for ${path}:`, error)
			}
		}

		return false
	}

	/**
	 * Commit changes across all workspaces
	 * Returns the primary root's commit hash for backward compatibility
	 */
	async commit(): Promise<string | undefined> {
		if (!this.enableCheckpoints || !this.initialized || this.trackers.size === 0) {
			return undefined
		}

		const primaryRoot = this.workspaceManager.getPrimaryRoot()
		if (!primaryRoot) {
			Logger.warn("[MultiRootCheckpointManager] No primary root found, committing all roots")
			// Just commit all roots and return undefined
			const commitPromises = Array.from(this.trackers.values()).map((tracker) =>
				tracker.commit().catch((error) => {
					Logger.error("[MultiRootCheckpointManager] Commit error:", error)
					return undefined
				}),
			)
			await Promise.all(commitPromises)
			return undefined
		}

		// Commit all roots in parallel
		const commitPromises = Array.from(this.trackers.values()).map((tracker) =>
			tracker.commit().catch((error) => {
				Logger.error("[MultiRootCheckpointManager] Commit error:", error)
				return undefined
			}),
		)

		const results = await Promise.all(commitPromises)

		// Return primary root's hash for compatibility with existing code
		const primaryIndex = Array.from(this.trackers.keys()).indexOf(primaryRoot.path)
		return results[primaryIndex]
	}

	/**
	 * Presents a multi-file diff view for the primary workspace root.
	 * For multi-root v1, this shows diffs for the primary root only.
	 */
	async presentMultifileDiff(messageId: string, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void> {
		try {
			if (!this.enableCheckpoints || !this.initialized) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Checkpoint manager is not initialized.",
				})
				return
			}

			const primaryRoot = this.workspaceManager.getPrimaryRoot()
			if (!primaryRoot) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "No primary workspace root configured.",
				})
				return
			}

			const tracker = this.trackers.get(primaryRoot.path)
			if (!tracker) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "No checkpoint tracker available for the primary workspace.",
				})
				return
			}

			await showChangedFilesDiff(this.messageStateHandler, tracker, messageId, seeNewChangesSinceLastTaskCompletion)
		} catch (error) {
			const errorMessage = getErrorMessage(error, "Unknown error")
			Logger.error("[MultiRootCheckpointManager] Failed to present multifile diff:", errorMessage)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to present diff: " + errorMessage,
			})
		}
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

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/CheckpointRestoreHandler.ts (lines 54-328)
```
export class CheckpointRestoreHandler {
	private readonly config: CheckpointRestoreConfig
	private readonly services: CheckpointRestoreServices
	private readonly callbacks: CheckpointRestoreCallbacks
	private readonly storage: CheckpointStorageManager

	private conversationHistoryDeletedRange?: [number, number]

	constructor(
		config: CheckpointRestoreConfig,
		services: CheckpointRestoreServices,
		callbacks: CheckpointRestoreCallbacks,
		storage: CheckpointStorageManager,
		initialConversationHistoryDeletedRange?: [number, number],
	) {
		this.config = config
		this.services = services
		this.callbacks = callbacks
		this.storage = storage
		this.conversationHistoryDeletedRange = initialConversationHistoryDeletedRange
	}

	setEnabled(enabled: boolean): void {
		this.config.enableCheckpoints = enabled
	}

	getConversationHistoryDeletedRange(): [number, number] | undefined {
		return this.conversationHistoryDeletedRange
	}

	/**
	 * Restores a checkpoint by message ID
	 */
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

	/**
	 * Handles the successful restoration logic for different restore types
	 */
	private async handleSuccessfulRestore(
		restoreType: DiracCheckpointRestore,
		message: DiracMessage,
		messageIndex: number,
		messageId: string,
	): Promise<void> {
		switch (restoreType) {
			case "task":
			case "taskAndWorkspace":
				// Update conversation history deleted range in our state
				this.conversationHistoryDeletedRange = message.conversationHistoryDeletedRange
				this.services.taskState.conversationHistoryDeletedRange = message.conversationHistoryDeletedRange

				const apiConversationHistory = this.services.messageStateHandler.getApiConversationHistory()
				const newConversationHistory = apiConversationHistory.slice(0, (message.conversationHistoryIndex || 0) + 2)
				await this.services.messageStateHandler.overwriteApiConversationHistory(newConversationHistory)

				// aggregate deleted api reqs info so we don't lose costs/tokens
				const diracMessages = this.services.messageStateHandler.getDiracMessages()
				const deletedMessages = diracMessages.slice(messageIndex + 1)
				const deletedApiReqsMetrics = getApiMetrics(combineCardSequences(deletedMessages))

				// Detect files edited after this message timestamp for file context warning
				if (restoreType === "task") {
					const filesEditedAfterMessage = await this.services.fileContextTracker.detectFilesEditedAfterMessage(
						message.ts,
						deletedMessages,
					)
					if (filesEditedAfterMessage.length > 0) {
						await this.services.fileContextTracker.storePendingFileContextWarning(filesEditedAfterMessage)
					}
				}

				const newDiracMessages = await getPresentationHistoryAtMessage(this.config.taskId, message.id)
				const restoredCheckpointMessage = newDiracMessages.at(-1)
				if (restoredCheckpointMessage?.id === message.id) {
					restoredCheckpointMessage.lastCheckpointHash = message.lastCheckpointHash
					restoredCheckpointMessage.isCheckpointCheckedOut = message.isCheckpointCheckedOut
				}
				await this.services.messageStateHandler.overwriteDiracMessages(newDiracMessages)

				await this.callbacks.taskMessenger.upsertApiStatus({
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					cost: deletedApiReqsMetrics.totalCost,
					deletedMetrics: {
						tokensIn: deletedApiReqsMetrics.totalTokensIn,
						tokensOut: deletedApiReqsMetrics.totalTokensOut,
						cacheWrites: deletedApiReqsMetrics.totalCacheWrites,
						cacheReads: deletedApiReqsMetrics.totalCacheReads,
					},
				})
				break
			case "workspace":
				break
		}

		switch (restoreType) {
			case "task":
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "Task messages have been restored to the checkpoint",
				})
				break
			case "workspace":
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "Workspace files have been restored to the checkpoint",
				})
				break
			case "taskAndWorkspace":
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "Task and workspace have been restored to the checkpoint",
				})
				break
		}

		if (restoreType !== "task") {
			// Set isCheckpointCheckedOut flag on the message
			const checkpointMessages = this.services.messageStateHandler.getDiracMessages().filter((m) => m.lastCheckpointHash)
			const currentMessageIndex = checkpointMessages.findIndex((m) => m.id === messageId)
			for (let index = 0; index < checkpointMessages.length; index++) {
				const checkpointMessage = checkpointMessages[index]
				const isCheckpointCheckedOut = index === currentMessageIndex
				if (checkpointMessage.isCheckpointCheckedOut !== isCheckpointCheckedOut) {
					await this.services.messageStateHandler.patchMessageById(checkpointMessage.id, { isCheckpointCheckedOut })
				}
			}
		}

		await this.services.messageStateHandler.saveDiracMessagesAndUpdateHistory()
		// Cancel and reinitialize the task to get updated messages
		await this.callbacks.cancelTask()
		// Reset transient state after successful restore
		await this.callbacks.resetTransientState()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/checkpoints/types.ts (lines 5-25)
```
export interface ICheckpointManager {
	/** Non-throwing commit-tail update that aligns capability with the committed task configuration. */
	setEnabled(enabled: boolean): void
	isEnabled(): boolean

	saveCheckpoint(isAttemptCompletionMessage?: boolean, completionMessageId?: string): Promise<void>

	restoreCheckpoint(messageId: string, restoreType: any, offset?: number): Promise<any>

	doesLatestTaskCompletionHaveNewChanges(): Promise<boolean>

	commit(): Promise<string | undefined>

	presentMultifileDiff?(messageId: string, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void>

	// Optional method for multi-root specific initialization
	initialize?(): Promise<void>

	// Optional method for checking and initializing checkpoint tracker
	checkpointTrackerCheckAndInit?(): Promise<any>
}
```


## Source Files:

- `src/integrations/checkpoints/CheckpointDiffPresenter.ts`
- `src/integrations/checkpoints/CheckpointExclusions.ts`
- `src/integrations/checkpoints/CheckpointGitOperations.ts`
- `src/integrations/checkpoints/CheckpointLockUtils.ts`
- `src/integrations/checkpoints/CheckpointMigration.ts`
- `src/integrations/checkpoints/CheckpointRestoreHandler.ts`
- `src/integrations/checkpoints/CheckpointStorageManager.ts`
- `src/integrations/checkpoints/CheckpointTracker.ts`
- `src/integrations/checkpoints/CheckpointUtils.ts`
- `src/integrations/checkpoints/DiffContentProvider.ts`
- `src/integrations/checkpoints/MultiRootCheckpointManager.ts`
- `src/integrations/checkpoints/factory.ts`
- `src/integrations/checkpoints/index.ts`
- `src/integrations/checkpoints/initializer.ts`
- `src/integrations/checkpoints/types.ts`

