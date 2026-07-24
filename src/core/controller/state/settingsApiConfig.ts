import { UpdateSettingsRequest } from "@shared/proto/dirac/state"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Controller } from ".."
import { applyApiConfigurationTransaction } from "../models/apiConfigurationTransaction"
import { convertMode } from "./settingsMode"

/** Apply API configuration from webview request after validating the active task runtime. */
export function applyApiConfiguration(controller: Controller, request: UpdateSettingsRequest): void {
	if (!request.apiConfiguration) return
	applyApiConfigurationTransaction(
		controller,
		convertProtoToApiConfiguration(request.apiConfiguration),
		undefined,
		convertMode(request.mode),
	)
}

/** Rebuild API handler from current state if a task is active. */
export function rebuildApiHandlerIfTask(controller: Controller): void {
	if (!controller.task) return
	const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
	controller.task.rebuildApiHandler(controller.stateManager.getApiConfiguration(), currentMode)
}
