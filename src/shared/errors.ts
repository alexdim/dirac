/**
 * Return a human-readable message for a thrown value. When the value is an
 * `Error` its `message` is used; otherwise the value is stringified, or a
 * caller-provided `fallback` is used when the value is not an `Error`.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
	return error instanceof Error ? error.message : fallback ?? String(error)
}

/**
 * Normalize an unknown thrown value into an `Error`, preserving existing
 * `Error` instances and wrapping any other value in a new `Error`.
 */
export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}
