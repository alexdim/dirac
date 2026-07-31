export const PRESENTATION_OPERATION_TIMEOUT_MS = 1_000

export type PresentationOperationOutcome<T> =
	| { timedOut: false; value: T }
	| { timedOut: true }

export async function waitForPresentationOperation<T>(operation: Promise<T>): Promise<PresentationOperationOutcome<T>> {
	let timeoutHandle: NodeJS.Timeout | undefined
	try {
		return await Promise.race([
			operation.then((value) => ({ timedOut: false as const, value })),
			new Promise<{ timedOut: true }>((resolve) => {
				timeoutHandle = setTimeout(() => resolve({ timedOut: true }), PRESENTATION_OPERATION_TIMEOUT_MS)
			}),
		])
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle)
	}
}
