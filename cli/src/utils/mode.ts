import type { TaskOptions } from "../types"

/**
 * Get mode selection result using the extracted, testable selectOutputMode function.
 * This wrapper provides the current process TTY state.
 */
export async function getModeSelection(options: TaskOptions) {
	const { selectOutputMode } = await import("./mode-selection")
	return selectOutputMode({
		stdoutIsTTY: process.stdout.isTTY === true,
		stdinIsTTY: process.stdin.isTTY === true,
		stdinWasPiped: options.stdinWasPiped ?? false,
		json: options.json,
		yolo: options.yolo,
	})
}

/**
 * Determine if plain text mode should be used based on options and environment.
 */
export async function shouldUsePlainTextMode(options: TaskOptions): Promise<boolean> {
	return (await getModeSelection(options)).usePlainTextMode
}

/**
 * Get the reason for using plain text mode (for telemetry).
 */
export async function getPlainTextModeReason(options: TaskOptions): Promise<string> {
	return (await getModeSelection(options)).reason
}
