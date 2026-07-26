import { useSyncExternalStore } from "react"

interface TerminalSizeSnapshot {
	columns: number
	rows: number
	resizeKey: number
}

const RESIZE_DEBOUNCE_MS = 300
const CLEAR_TERMINAL = "\x1b[2J\x1b[H"

const subscribers = new Set<() => void>()
let snapshot: TerminalSizeSnapshot = {
	columns: process.stdout.columns || 80,
	rows: process.stdout.rows || 24,
	resizeKey: 0,
}
let previousColumns = snapshot.columns
let resizeTimeout: ReturnType<typeof setTimeout> | null = null
let isListening = false

function readTerminalDimensions(): Pick<TerminalSizeSnapshot, "columns" | "rows"> {
	return {
		columns: process.stdout.columns || 80,
		rows: process.stdout.rows || 24,
	}
}

function publish(nextSnapshot: TerminalSizeSnapshot): void {
	snapshot = nextSnapshot
	for (const subscriber of subscribers) subscriber()
}

function remountAfterWidthResize(): void {
	process.stdout.write(CLEAR_TERMINAL, () => {
		publish({ ...snapshot, resizeKey: snapshot.resizeKey + 1 })
	})
}

function handleResize(): void {
	const dimensions = readTerminalDimensions()
	const widthChanged = dimensions.columns !== previousColumns
	previousColumns = dimensions.columns

	if (dimensions.columns !== snapshot.columns || dimensions.rows !== snapshot.rows) {
		publish({ ...snapshot, ...dimensions })
	}

	if (!widthChanged) return
	if (resizeTimeout) clearTimeout(resizeTimeout)
	resizeTimeout = setTimeout(() => {
		resizeTimeout = null
		remountAfterWidthResize()
	}, RESIZE_DEBOUNCE_MS)
}

function startListening(): void {
	if (isListening) return
	const dimensions = readTerminalDimensions()
	snapshot = { ...snapshot, ...dimensions }
	previousColumns = dimensions.columns
	process.stdout.on("resize", handleResize)
	isListening = true
}

function stopListening(): void {
	if (!isListening) return
	process.stdout.off("resize", handleResize)
	if (resizeTimeout) {
		clearTimeout(resizeTimeout)
		resizeTimeout = null
	}
	isListening = false
}

function subscribe(subscriber: () => void): () => void {
	subscribers.add(subscriber)
	startListening()

	return () => {
		subscribers.delete(subscriber)
		if (subscribers.size === 0) stopListening()
	}
}

function getSnapshot(): TerminalSizeSnapshot {
	return snapshot
}

/**
 * Return the shared terminal dimensions and a remount key that advances after
 * debounced width changes. All consumers share one stdout resize listener and
 * one terminal-clear/remount cycle.
 */
export function useTerminalSize(): TerminalSizeSnapshot {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
