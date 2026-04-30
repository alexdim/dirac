/**
 * Utility functions for configuration manipulation
 */

/**
 * Get a nested object at a given path
 */
export const getObjectAtPath = (root: Record<string, unknown>, path: string[]): Record<string, unknown> => {
	let current: unknown = root
	for (const segment of path) {
		if (!current || typeof current !== "object") {
			return {}
		}
		current = (current as Record<string, unknown>)[segment]
	}
	return current && typeof current === "object" ? (current as Record<string, unknown>) : {}
}

/**
 * Set a value in a nested object at a given path
 */
export const setObjectValueAtPath = (
	root: Record<string, unknown>,
	path: string[],
	key: string,
	value: unknown,
): Record<string, unknown> => {
	if (path.length === 0) {
		return { ...root, [key]: value }
	}
	const [head, ...rest] = path
	const child = root[head]
	const childObj = child && typeof child === "object" ? (child as Record<string, unknown>) : {}
	return {
		...root,
		[head]: setObjectValueAtPath(childObj, rest, key, value),
	}
}
