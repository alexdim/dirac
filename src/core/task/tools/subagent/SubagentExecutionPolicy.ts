export const DEFAULT_SUBAGENT_TIMEOUT_SECONDS = 600

export function resolveSubagentTimeoutSeconds(timeout?: number): number {
	const resolvedTimeout = timeout ?? DEFAULT_SUBAGENT_TIMEOUT_SECONDS
	if (!Number.isFinite(resolvedTimeout) || resolvedTimeout <= 0) {
		throw new Error("Subagent timeout must be a positive number of seconds.")
	}
	return resolvedTimeout
}
