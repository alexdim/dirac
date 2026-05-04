import { exit } from "node:process"
import { initializeCli } from "../init"
import { disposeCliContext } from "../utils/cleanup"
import { runInkApp } from "../utils/ink"

/**
 * Show current configuration
 */
export async function showConfig(options: { config?: string }) {
	const { StateManager } = await import("@/core/storage/StateManager")
	const { telemetryService } = await import("@/services/telemetry")
	const { getHooksEnabledSafe } = await import("@/core/hooks/hooks-utils")
	const { checkRawModeSupport } = await import("../context/StdinContext")
	const React = (await import("react")).default

	const ctx = await initializeCli(options)
	const stateManager = StateManager.get()

	// Dynamically import the wrapper to avoid circular dependencies
	const { ConfigViewWrapper } = await import("../components/ConfigViewWrapper")

	telemetryService.captureHostEvent("config_command", "executed")

	await runInkApp(
		React.createElement(ConfigViewWrapper, {
			controller: ctx.controller,
			dataDir: ctx.dataDir,
			globalState: stateManager.getAllGlobalStateEntries(),
			workspaceState: stateManager.getAllWorkspaceStateEntries(),
			hooksEnabled: getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled")),
			skillsEnabled: true,
			isRawModeSupported: checkRawModeSupport(),
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(0)
		},
	)
}
