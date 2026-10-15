---
component_id: 1.2.5
component_name: gRPC Dispatch, Command & Goal Controllers
---

# gRPC Dispatch, Command & Goal Controllers

## Component Description

Dispatches gRPC requests, manages streaming request lifecycles and recording, and handles editor commands, goal controls, slash commands, and web metadata utilities.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/grpc-handler.ts (lines 185-187)
```
export function getRequestRegistry(): GrpcRequestRegistry {
	return requestRegistry
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/grpc-request-registry.ts (lines 33-123)
```
export class GrpcRequestRegistry {
	/**
	 * Map of request IDs to request information
	 */
	private activeRequests = new Map<string, RequestInfo>()

	/**
	 * Register a new request with its cleanup function
	 * @param requestId The unique ID of the request
	 * @param cleanup Function to clean up resources when the request is cancelled
	 * @param metadata Optional metadata about the request
	 * @param responseStream Optional streaming response handler
	 */
	public registerRequest(
		requestId: string,
		cleanup: () => void,
		metadata?: any,
		responseStream?: StreamingResponseHandler<any>,
	): void {
		this.activeRequests.set(requestId, {
			cleanup,
			metadata,
			timestamp: new Date(),
			responseStream,
		})
	}

	/**
	 * Cancel a request and clean up its resources
	 * @param requestId The ID of the request to cancel
	 * @returns True if the request was found and cancelled, false otherwise
	 */
	public cancelRequest(requestId: string): boolean {
		const requestInfo = this.activeRequests.get(requestId)
		if (!requestInfo) {
			return false
		}
		try {
			requestInfo.cleanup()
		} catch (error) {
			Logger.error(`Error cleaning up request ${requestId}:`, error)
		}
		this.activeRequests.delete(requestId)
		return true
	}

	/**
	 * Get information about a request
	 * @param requestId The ID of the request
	 * @returns The request information, or undefined if not found
	 */
	public getRequestInfo(requestId: string): RequestInfo | undefined {
		return this.activeRequests.get(requestId)
	}

	/**
	 * Check if a request exists in the registry
	 * @param requestId The ID of the request
	 * @returns True if the request exists, false otherwise
	 */
	public hasRequest(requestId: string): boolean {
		return this.activeRequests.has(requestId)
	}

	/**
	 * Get all active requests
	 * @returns An array of [requestId, requestInfo] pairs
	 */
	public getAllRequests(): [string, RequestInfo][] {
		return Array.from(this.activeRequests.entries())
	}

	/**
	 * Clean up stale requests that have been active for too long
	 * @param maxAgeMs Maximum age in milliseconds before a request is considered stale
	 * @returns The number of requests that were cleaned up
	 */
	public cleanupStaleRequests(maxAgeMs: number): number {
		const now = new Date()
		let cleanedCount = 0

		for (const [requestId, info] of this.activeRequests.entries()) {
			if (now.getTime() - info.timestamp.getTime() > maxAgeMs) {
				this.cancelRequest(requestId)
				cleanedCount++
			}
		}

		return cleanedCount
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/commands/addToDirac.ts (lines 13-51)
```
export async function addToDirac(controller: Controller, request: CommandContext, notebookContext?: string): Promise<Empty> {
	if (!request.selectedText?.trim() && !notebookContext) {
		Logger.log("❌ No text selected and no notebook context - returning early")
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)

	let input = `${fileMention}\n\`\`\`\n${request.selectedText}\n\`\`\``

	// Add notebook context if provided (includes cell JSON)
	if (notebookContext) {
		Logger.log("Adding notebook context for enhanced editing")
		input += `\n${notebookContext}`
	}

	if (request.diagnostics.length) {
		const problemsString = await singleFileDiagnosticsToProblemsString(filePath, request.diagnostics)
		input += `\nProblems:\n${problemsString}`
	}

	// Notebooks send immediately, regular adds just fill input
	if (notebookContext && controller.task) {
		const cardId = controller.task.stateView.lastWaitingCardId
		if (cardId) {
			await controller.task.submitCardResponse(cardId, DiracAskResponse.MESSAGE, input)
		}
	} else if (notebookContext) {
		await controller.initTask(input)
	} else {
		await sendAddToInputEvent(input)
	}

	Logger.log("addToDirac", request.selectedText, filePath, request.language)
	telemetryService.captureButtonClick("codeAction_addToChat", controller.task?.ulid)

	return {}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/grpc-recorder/test-hooks.ts (lines 9-38)
```
export function testHooks(controller: Controller): GrpcPostRecordHook[] {
	return [
		async (entry) => {
			GrpcRecorderBuilder.getRecorder(controller).cleanupSyntheticEntries()

			await new Promise((resolve) => setTimeout(resolve, TEST_HOOK_LATEST_STATE_DELAY))

			const requestId = entry.requestId

			// Record synthetic "getLatestState" request
			GrpcRecorderBuilder.getRecorder(controller).recordRequest(
				{
					service: "dirac.StateService",
					method: "getLatestState",
					message: {},
					request_id: requestId,
					is_streaming: false,
				},
				true,
			)

			const state = await getLatestState(controller, {})

			GrpcRecorderBuilder.getRecorder(controller).recordResponse(requestId, {
				request_id: requestId,
				message: state,
			})
		},
	]
}
```


## Source Files:

- `src/core/controller/commands/addToDirac.ts`
- `src/core/controller/commands/explainWithDirac.ts`
- `src/core/controller/commands/fixWithDirac.ts`
- `src/core/controller/commands/improveWithDirac.ts`
- `src/core/controller/goal/pauseGoal.ts`
- `src/core/controller/goal/resumeGoal.ts`
- `src/core/controller/goal/selectGoal.ts`
- `src/core/controller/goal/sendGoalMessage.ts`
- `src/core/controller/goal/steerGoal.ts`
- `src/core/controller/goal/stopGoal.ts`
- `src/core/controller/grpc-handler.ts`
- `src/core/controller/grpc-recorder/grpc-recorder.builder.ts`
- `src/core/controller/grpc-recorder/grpc-recorder.ts`
- `src/core/controller/grpc-recorder/log-file-handler.ts`
- `src/core/controller/grpc-recorder/test-hooks.ts`
- `src/core/controller/grpc-recorder/types.ts`
- `src/core/controller/grpc-request-registry.ts`
- `src/core/controller/grpc-service.ts`
- `src/core/controller/slash/condense.ts`
- `src/core/controller/slash/getAvailableSlashCommands.ts`
- `src/core/controller/web/checkIsImageUrl.ts`
- `src/core/controller/web/fetchOpenGraphData.ts`

