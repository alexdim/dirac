---
component_id: 2.2
component_name: CLI Runtime & Display Utilities
---

# CLI Runtime & Display Utilities

## Component Description

Provides shared terminal utilities for formatted output, Ink app lifecycle, provider configuration, diff computation, file search, and resource cleanup.

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

### /Users/highlands/pools/Development/dirac/cli/src/utils/display.ts (lines 360-362)
```
export function printInfo(message: string) {
	originalConsoleLog(style.info(message))
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/provider-config.ts (lines 210-239)
```
export async function configureApiKeyProvider(options: ConfigureApiKeyProviderOptions): Promise<void> {
	const { getValidCliProviders } = await import("./providers.js")
	const providers = getValidCliProviders()
	const requestedProvider = options.provider.trim()
	const provider = providers.find((candidate) => candidate.toLowerCase() === requestedProvider.toLowerCase())
	if (!provider) throw new Error(`Invalid provider '${options.provider}'. Supported providers: ${providers.join(", ")}`)
	if (provider === "bedrock") {
		throw new Error(
			"Bedrock provider is not supported for quick setup due to complex authentication requirements. Please use interactive setup.",
		)
	}
	if (!ProviderToApiKeyMap[provider as ApiProvider]) throw new Error(`Provider ${provider} does not support API-key setup`)
	if (!options.apiKey.trim()) throw new Error("API key is required")
	if (options.baseUrl && !ProviderToBaseUrlKeyMap[provider as ApiProvider]) {
		throw new Error("Base URL is not supported for this provider")
	}

	const modelId = options.modelId?.trim() || getDefaultModelId(provider)
	if (!modelId) throw new Error("Model ID is required for this provider")
	await applyProviderConfig({
		providerId: provider,
		apiKey: options.apiKey.trim(),
		modelId,
		baseUrl: options.baseUrl,
		azureApiVersion: options.azureApiVersion,
		controller: options.controller,
	})
	StateManager.get().setGlobalState("welcomeViewCompleted", true)
	await StateManager.get().flushPendingState()
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/cleanup.ts (lines 18-40)
```
export async function disposeCliContext(ctx: CliContext | null): Promise<void> {
	if (!ctx) {
		try {
			const { SymbolIndexService } = await import("@/services/symbol-index/SymbolIndexService")
			SymbolIndexService.getInstance().dispose()
		} catch {
			// Best effort
		}
		const { disposeClipboardImages } = await import("./clipboard-image")
		disposeClipboardImages()
		await disposeTelemetryServices()
		const { disposeCliLogging } = await import("../init")
		await disposeCliLogging()
		return
	}

	const existingDisposal = contextDisposals.get(ctx)
	if (existingDisposal) return existingDisposal

	const disposal = disposeInitializedContext(ctx)
	contextDisposals.set(ctx, disposal)
	return disposal
}
```

### /Users/highlands/pools/Development/dirac/cli/src/utils/DiffComputer.ts (lines 261-307)
```
export function computeDiff(content: string): ComputedDiff {
	// Detect format and parse pairs
	let pairs: Array<{ search: string; replace: string; startLine?: number }>

	if (content.includes(MARKERS.SEARCH_BLOCK) || content.includes("------- SEARCH") || content.match(/<{7,} SEARCH:\d+/)) {
		pairs = parseSearchReplacePairs(content)
	} else if (content.includes(MARKERS.NEW_BEGIN)) {
		pairs = parseApplyPatchPairs(content)
	} else if (content.match(MARKERS.FILE_PATTERN)) {
		pairs = parseNewFormat(content)
	} else if (/^@@\s+-\d+/m.test(content)) {
		// Unified diff format (from diff.createPatch) — parse directly
		return parseUnifiedDiff(content)
	} else {
		// Fallback: treat as new file (all additions)
		const lines = content.split("\n")
		return {
			blocks: [
				{
					lines: lines.map((line, idx) => ({
						type: "add" as const,
						content: line,
						newLineNumber: idx + 1,
					})),
					additions: lines.length,
					deletions: 0,
				},
			],
			totalAdditions: lines.length,
			totalDeletions: 0,
		}
	}

	// Compute diff for each pair
	const blocks: DiffBlock[] = []
	let totalAdditions = 0
	let totalDeletions = 0

	for (const pair of pairs) {
		const block = computeLineDiff(pair.search, pair.replace, pair.startLine)
		blocks.push(block)
		totalAdditions += block.additions
		totalDeletions += block.deletions
	}

	return { blocks, totalAdditions, totalDeletions }
}
```


## Source Files:

- `cli/src/utils/DiffComputer.ts`
- `cli/src/utils/acp-file-logger.ts`
- `cli/src/utils/action-buttons.ts`
- `cli/src/utils/auth.ts`
- `cli/src/utils/browser.ts`
- `cli/src/utils/card-body.ts`
- `cli/src/utils/chat-layout.ts`
- `cli/src/utils/chat.ts`
- `cli/src/utils/cleanup.ts`
- `cli/src/utils/clipboard-image.ts`
- `cli/src/utils/color.ts`
- `cli/src/utils/command-parsers.ts`
- `cli/src/utils/console.ts`
- `cli/src/utils/cursor.ts`
- `cli/src/utils/diff-layout.ts`
- `cli/src/utils/display.ts`
- `cli/src/utils/errors.ts`
- `cli/src/utils/file-search.ts`
- `cli/src/utils/fuzzy-search.ts`
- `cli/src/utils/git.ts`
- `cli/src/utils/goals.ts`
- `cli/src/utils/icon-mapping.ts`
- `cli/src/utils/import-configs.ts`
- `cli/src/utils/ink.ts`
- `cli/src/utils/input-layout.ts`
- `cli/src/utils/input-viewport.ts`
- `cli/src/utils/input.ts`
- `cli/src/utils/markdown.ts`
- `cli/src/utils/mode-selection.ts`
- `cli/src/utils/mode.ts`
- `cli/src/utils/model-metadata.ts`
- `cli/src/utils/model-selection.ts`
- `cli/src/utils/openrouter-models.ts`
- `cli/src/utils/options.ts`
- `cli/src/utils/output-channel.ts`
- `cli/src/utils/parser.ts`
- `cli/src/utils/path.ts`
- `cli/src/utils/piped.ts`
- `cli/src/utils/plain-text-task.ts`
- `cli/src/utils/provider-config.ts`
- `cli/src/utils/providers.ts`
- `cli/src/utils/quiet-mode.ts`
- `cli/src/utils/shutdown.ts`
- `cli/src/utils/slash-commands.ts`
- `cli/src/utils/spinner-activity.ts`
- `cli/src/utils/standalone-card-policy.ts`
- `cli/src/utils/state.ts`
- `cli/src/utils/task-history.ts`
- `cli/src/utils/task-start-output.ts`
- `cli/src/utils/task-timeout.ts`
- `cli/src/utils/terminal-link.ts`
- `cli/src/utils/text-clipping.ts`
- `cli/src/utils/timeline-rows.ts`
- `cli/src/utils/tool-options.ts`
- `cli/src/utils/update.ts`
- `cli/src/utils/vim-editor.ts`

