---
component_id: 3.5
component_name: Logging & Background Sync Services
---

# Logging & Background Sync Services

## Component Description

Provides session tracking, rotating file logging, and background worker queue processing for data synchronization and backfilling.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/services/file-logger.ts (lines 133-148)
```
	private enqueuePendingRecords(): void {
		if (this.pendingRecords.length === 0) return
		const records = this.pendingRecords
		this.pendingRecords = []

		this.flushChain = this.flushChain.then(() => {
			withLockSync(familyLockPath(this.logDir, this.fileName), () => {
				migrateFamilyLocked(this.logDir, this.fileName, false)
				appendRecordsLocked(this.logDir, this.fileName, records)
			})
		})
		this.flushChain = this.flushChain.catch((error: unknown) => {
			this.flushFailure = toError(error)
			process.stderr.write(`Failed to write ${this.filePath}: ${this.flushFailure.message}\n`)
		})
	}
```

### /Users/highlands/pools/Development/dirac/src/shared/services/worker/backfill.ts (lines 80-115)
```
export async function backfillTask(taskId: string): Promise<BackfillTaskResult> {
	const result: BackfillTaskResult = {
		taskId,
		success: false,
		filesQueued: [],
	}

	try {
		const queue = syncWorker().getSyncQueue()
		if (!queue) {
			result.error = "S3 storage not configured"
			return result
		}
		const existingItem = queue.getItem(taskId, GlobalFileNames.apiConversationHistory)
		if (existingItem?.status === "synced") {
			// Already synced, skip
			return result
		}
		try {
			const data = await getSavedApiConversationHistory(taskId)
			queue.enqueue(taskId, GlobalFileNames.apiConversationHistory, JSON.stringify(data))
			result.filesQueued.push(taskId)
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				Logger.error(`Failed to queue ${taskId}:`, err)
			}
			// Skip missing files silently
		}

		result.success = result.filesQueued.length > 0
	} catch (err) {
		result.error = getErrorMessage(err)
	}

	return result
}
```

### /Users/highlands/pools/Development/dirac/src/shared/services/worker/worker.ts (lines 191-252)
```
	private async processQueue(): Promise<{ successCount: number; failCount: number }> {
		if (this.isProcessing) {
			return { successCount: 0, failCount: 0 }
		}

		this.isProcessing = true
		let successCount = 0
		let failCount = 0

		try {
			// Run cleanup to prevent unbounded queue growth
			// This runs even if blob storage isn't ready, which is the main protection
			// against misconfigured storage causing the queue to grow forever
			this.queue.cleanupFailedItems(this.options.maxRetries, this.options.maxFailedAgeMs)
			this.queue.enforceMaxSize(this.options.maxQueueSize)

			if (!blobStorage.isReady()) {
				// S3/R2 not configured, nothing more to do
				return { successCount: 0, failCount: 0 }
			}

			// Get pending items
			const batch = this.queue.getPendingBatch(this.options.batchSize)

			if (batch.length === 0) {
				return { successCount: 0, failCount: 0 }
			}

			this.emit({ type: WorkerEvent.WorkerSyncStarted, itemCount: batch.length })

			for (const item of batch) {
				const data = item.data
				// Skip items that have exceeded max retries
				if (!data || item.retryCount >= this.options.maxRetries) {
					continue
				}

				try {
					// Upload to blob store (S3/R2) bucket
					// Example path: <bucketName>/tasks/<userDistinctId>/<taskId>/<key>
					await blobStorage.store(`tasks/${this.options.userDistinctId}/${item.taskId}/${item.key}`, data)

					// Mark as synced and remove from queue (data is in S3 now)
					this.queue.markSynced(item.taskId, item.key, true)
					successCount++
					this.emit({ type: WorkerEvent.WorkerItemSynced, item })
				} catch (err) {
					const errorMsg = getErrorMessage(err)
					this.queue.markFailed(item.taskId, item.key, errorMsg)
					failCount++
					this.emit({ type: WorkerEvent.WorkerItemFailed, item, error: errorMsg })
					Logger.error(`Failed to sync ${item.taskId}/${item.key}:`, err)
				}
			}

			this.emit({ type: WorkerEvent.WorkerSyncCompleted, successCount, failCount })
		} finally {
			this.isProcessing = false
		}

		return { successCount, failCount }
	}
```


## Source Files:

- `src/shared/services/Logger.ts`
- `src/shared/services/Session.ts`
- `src/shared/services/file-logger.ts`
- `src/shared/services/worker/backfill.ts`
- `src/shared/services/worker/queue.ts`
- `src/shared/services/worker/sync.ts`
- `src/shared/services/worker/worker.ts`

