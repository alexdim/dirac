---
component_id: 2.2.1
component_name: Ink Rendering, Search & System Helpers
---

# Ink Rendering, Search & System Helpers

## Component Description

Provides Ink app launching, timeline row estimation, fuzzy and file search, tool selection helpers, diffing, and system environment utilities.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/utils/ink.ts (lines 4-57)
```
export async function runInkApp(element: any, cleanup: () => Promise<void>): Promise<void> {
	const { render } = await import("ink")
	const { restoreConsole } = await import("./console")

	// Clear terminal for clean UI - robot will render at row 1
	process.stdout.write("\x1b[2J\x1b[H")
	const shouldPrimeRawMode =
		process.platform === "win32" && process.stdin.isTTY && typeof process.stdin.setRawMode === "function"
	const wasRaw = process.stdin.isRaw === true
	const wasPaused = process.stdin.isPaused()

	if (shouldPrimeRawMode) {
		try {
			process.stdin.setRawMode(true)
			process.stdin.resume()
		} catch {
			// Ink will still attempt to initialize raw mode.
		}
	}

	// Note: incrementalRendering is enabled to reduce terminal bandwidth and improve responsiveness.
	// We previously disabled this due to resize glitches, but our useTerminalSize hook now
	// handles this by clearing the screen and forcing a full React remount on resize,
	// which resets Ink's internal line tracking.
	const { waitUntilExit, unmount } = render(element, {
		exitOnCtrlC: true,
		patchConsole: false,
		// @ts-expect-error: synchronizedUpdateMode is supported by @jrichman/ink but not in the type definitions
		synchronizedUpdateMode: true,
		incrementalRendering: true,
	})

	try {
		await waitUntilExit()
	} finally {
		try {
			unmount()
		} catch {
			// Already unmounted
		}
		if (shouldPrimeRawMode) {
			try {
				process.stdin.setRawMode(wasRaw)
				if (wasPaused) {
					process.stdin.pause()
				}
			} catch {
				// Ignore cleanup failures on nonstandard terminals.
			}
		}
		restoreConsole()
		await cleanup()
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/timeline-rows.ts (lines 31-44)
```

export function estimateTimelineMessageBodyRows(
	message: DiracMessage,
	terminalColumns: number,
	suppressCardBody = false,
): number {
	if (message.content.type === DiracMessageType.MARKDOWN) {
		return renderMarkdownLines(message.content.content, Math.max(1, terminalColumns - MESSAGE_CONTENT_COLUMNS)).length
	}

	if (message.content.type !== DiracMessageType.CARD || suppressCardBody) return 0
	const body = cardBodyForDisplay(message.content.card.body, message.content.card.renderType)
	if (!body) return 0
	const width = Math.max(1, terminalColumns - CARD_BODY_COLUMNS)
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/acp-file-logger.ts (lines 19-28)
```
export async function disposeAcpFileLogger(): Promise<void> {
	unsubscribeAcpLogger?.()
	unsubscribeAcpLogger = undefined
	acpFileLogger = undefined

	if (acpRotatingFileLogger) {
		await acpRotatingFileLogger.dispose()
		acpRotatingFileLogger = undefined
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/tool-options.ts (lines 65-76)
```
export async function applyToolSelectionOptions(
	options: ToolSelectionOptions,
	workspaceRoot: string,
): Promise<ToolSelectionPolicy | undefined> {
	if (!hasToolSelectionOptions(options)) return undefined

	const configuredToggles = StateManager.get().getGlobalSettingsKey("toolToggles") ?? {}
	return refreshToolRegistryForWorkspace(
		{ workspaceRoot, includeUserTools: true, toggles: configuredToggles },
		(registry) => resolveToolSelectionPolicy(options, registry.getAllTools(undefined, workspaceRoot)),
	)
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/fuzzy-search.ts (lines 14-18)
```
export function fuzzyFilter<T>(items: readonly T[], query: string, selector: (item: T) => string): T[] {
	if (!query) return [...items]
	const fzf = new Fzf(items as any, { selector } as any)
	return fzf.find(query).map((result) => result.item) as T[]
}
```


## Source Files:

- `cli/src/utils/DiffComputer.ts`
- `cli/src/utils/acp-file-logger.ts`
- `cli/src/utils/action-buttons.ts`
- `cli/src/utils/browser.ts`
- `cli/src/utils/color.ts`
- `cli/src/utils/cursor.ts`
- `cli/src/utils/file-search.ts`
- `cli/src/utils/fuzzy-search.ts`
- `cli/src/utils/git.ts`
- `cli/src/utils/goals.ts`
- `cli/src/utils/ink.ts`
- `cli/src/utils/model-selection.ts`
- `cli/src/utils/output-channel.ts`
- `cli/src/utils/path.ts`
- `cli/src/utils/spinner-activity.ts`
- `cli/src/utils/terminal-link.ts`
- `cli/src/utils/text-clipping.ts`
- `cli/src/utils/timeline-rows.ts`
- `cli/src/utils/tool-options.ts`

