export interface SerializedTaskError {
	name: string
	message: string
	stack?: string
}

export type TaskCancellationIntent = { kind: "cancelled"; reason?: string } | { kind: "interrupted"; reason?: string }

export type TaskRunOutcome =
	| { kind: "completed"; response: string; completedAt: number }
	| { kind: "failed"; error: SerializedTaskError; failedAt: number }
	| { kind: "cancelled"; reason?: string; cancelledAt: number }
	| { kind: "interrupted"; reason: string; interruptedAt: number }

export function serializeTaskError(error: unknown): SerializedTaskError {
	if (error instanceof Error)
		return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
	return { name: "Error", message: String(error) }
}
