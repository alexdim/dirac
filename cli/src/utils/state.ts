import type { CliContext } from "../types"

// Track active context for graceful shutdown
export let activeContext: CliContext | null = null
export let isShuttingDown = false
// Track if we're in plain text mode (no Ink UI) - set by runTask when piped stdin detected
export let isPlainTextMode = false
export let telemetryDisposed = false

export function setActiveContext(ctx: CliContext | null) {
	activeContext = ctx
}

export function setIsShuttingDown(value: boolean) {
	isShuttingDown = value
}

export function setIsPlainTextMode(value: boolean) {
	isPlainTextMode = value
}

export function setTelemetryDisposed(value: boolean) {
	telemetryDisposed = value
}
