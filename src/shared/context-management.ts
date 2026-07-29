export const DEFAULT_AUTO_CONDENSE_CONTEXT_LIMIT = 272_000
export const MAX_AUTO_CONDENSE_CONTEXT_LIMIT = 2_000_000_000

export type AutoCondenseContextLimits = Record<string, number>

export function isValidAutoCondenseContextLimit(value: number | undefined): value is number {
	return Number.isSafeInteger(value) && value! > 0 && value! <= MAX_AUTO_CONDENSE_CONTEXT_LIMIT
}

export function getAutoCondenseContextLimit(
	limits: AutoCondenseContextLimits | undefined,
	providerId: string | undefined,
): number {
	const configuredLimit = providerId ? limits?.[providerId] : undefined
	return isValidAutoCondenseContextLimit(configuredLimit) ? configuredLimit : DEFAULT_AUTO_CONDENSE_CONTEXT_LIMIT
}
