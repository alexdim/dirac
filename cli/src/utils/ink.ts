/**
 * Run an Ink app with proper cleanup handling
 */
export async function runInkApp(element: any, cleanup: () => Promise<void>): Promise<void> {
	const { render } = await import("ink")
	const { restoreConsole } = await import("./console")

	// Clear terminal for clean UI - robot will render at row 1
	process.stdout.write("\x1b[2J\x1b[H")

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
		restoreConsole()
		await cleanup()
	}
}
