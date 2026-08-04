import { exit } from "node:process"
import type { CliContext } from "../types"
import { setActiveContext } from "./state"
import { telemetryDisposed, setTelemetryDisposed, shutdownExitCode } from "./state"

const contextDisposals = new WeakMap<CliContext, Promise<void>>()

export async function disposeTelemetryServices(): Promise<void> {
	if (telemetryDisposed) {
		return
	}

	setTelemetryDisposed(true)
	const { telemetryService } = await import("@/services/telemetry")
	await telemetryService.dispose()
}

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

async function disposeInitializedContext(ctx: CliContext): Promise<void> {
	try {
		const { ErrorService } = await import("@/services/error/ErrorService")
		await ctx.controller.stateManager.flushPendingState()
		await ctx.controller.dispose()
		await ErrorService.get().dispose()
		try {
			const { SymbolIndexService } = await import("@/services/symbol-index/SymbolIndexService")
			SymbolIndexService.getInstance().dispose()
		} catch {
			// The index is optional and may not have been initialized.
		}
		const { disposeClipboardImages } = await import("./clipboard-image")
		disposeClipboardImages()
		await disposeTelemetryServices()
	} finally {
		try {
			const { disposeCliLogging } = await import("../init")
			await disposeCliLogging()
		} finally {
			setActiveContext(null)
		}
	}
}

/**
 * Create the standard cleanup function for Ink apps.
 */
export function createInkCleanup(ctx: CliContext, onTaskError?: () => boolean): () => Promise<void> {
	return async () => {
		await disposeCliContext(ctx)
		if (onTaskError?.()) {
			const { printWarning } = await import("./display")
			printWarning("Task ended with errors.")
			exit(1)
		}
		exit(shutdownExitCode ?? 0)
	}
}

/**
 * Wait for stdout to fully drain before exiting.
 * Critical for piping - ensures data is flushed to the next command in the pipe.
 */
export async function drainStdout(): Promise<void> {
	await drainWritableStream(process.stdout)
}

export async function drainOutput(): Promise<void> {
	await Promise.all([drainWritableStream(process.stdout), drainWritableStream(process.stderr)])
}

function drainWritableStream(stream: NodeJS.WriteStream): Promise<void> {
	return new Promise<void>((resolve) => {
		if (stream.writableNeedDrain) stream.once("drain", resolve)
		else setImmediate(resolve)
	})
}
