/**
 * Color constants for the CLI
 * Re-exports from theme.ts for backward compatibility.
 */

import { theme } from "./theme"

export const COLORS = {
	get primaryBlue() { return theme.primary },
	get planYellow() { return theme.plan },
	get text() { return theme.text },
	get strongText() { return theme.strongText },
	get muted() { return theme.muted },
	get subtle() { return theme.subtle },
	get success() { return theme.success },
	get error() { return theme.error },
	get warning() { return theme.warning },
	get info() { return theme.info },
	get link() { return theme.link },
	get magenta() { return theme.magenta },
	get highlightBg() { return theme.highlightBg },
	get highlightText() { return theme.highlightText },
	get buttonText() { return theme.buttonText },
} as const

/**
 * Get the appropriate color for the current mode
 */
export function getModeColor(mode: "act" | "plan"): string {
	return mode === "plan" ? COLORS.planYellow : COLORS.primaryBlue
}
