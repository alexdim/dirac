import { buildApiHandler, type ApiHandler, validateApiConfiguration } from "@core/api"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@core/storage/StateManager"

export type ApiConfigurationTransactionContext = {
	stateManager: StateManager
	task?: {
		ulid: string
		setApiHandler(api: ApiHandler): void
	}
}

export type ApiConfigurationPersistence = () => void

/**
 * Validates an API configuration against the active task before any state is persisted.
 * The returned handler is the exact runtime installed after persistence succeeds.
 */
export function buildCandidateApiHandler(
	controller: ApiConfigurationTransactionContext,
	configuration: ApiConfiguration,
	mode: Mode = controller.stateManager.getGlobalSettingsKey("mode"),
): ApiHandler | undefined {
	validateApiConfiguration(configuration, mode)
	if (!controller.task) return undefined
	return buildApiHandler({ ...configuration, ulid: controller.task.ulid }, mode)
}

/** Persist a previously validated candidate and atomically replace the active task runtime. */
export function commitApiConfiguration(
	controller: ApiConfigurationTransactionContext,
	persist: ApiConfigurationPersistence,
	candidateHandler?: ApiHandler,
): void {
	persist()
	if (controller.task && candidateHandler) controller.task.setApiHandler(candidateHandler)
}

/** Validate, persist, and install a complete API configuration in release-safe order. */
export function applyApiConfigurationTransaction(
	controller: ApiConfigurationTransactionContext,
	configuration: ApiConfiguration,
	persist: ApiConfigurationPersistence = () => controller.stateManager.setApiConfiguration(configuration),
	mode?: Mode,
): void {
	const candidateHandler = buildCandidateApiHandler(controller, configuration, mode)
	commitApiConfiguration(controller, persist, candidateHandler)
}
