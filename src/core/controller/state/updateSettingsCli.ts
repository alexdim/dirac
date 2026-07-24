import { Empty } from "@shared/proto/dirac/common"
import { Settings as ProtoSettings, UpdateSettingsRequestCli } from "@shared/proto/dirac/state"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { DiracEnv } from "@/config"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."
import { buildCandidateApiHandler, commitApiConfiguration } from "../models/apiConfigurationTransaction"
import { normalizeOpenaiReasoningEffort } from "./reasoningEffort"
import { mergeBrowserSettingsCli } from "./settingsBrowser"
import { applyReasoningEffort, filterSimpleSettingsBatch, mergeAutoApprovalSettings } from "./settingsCli"
import { applyModeCli, convertPlanActMode } from "./settingsMode"
import { applyTelemetrySettingsCli } from "./settingsTelemetry"
import { setDefaultTerminalProfile } from "./settingsTerminalProfile"

/** Apply all settings from a CLI ProtoSettings object to global state */
async function applyCliSettings(
	controller: Controller,
	settings: ProtoSettings,
	planModeApiProvider: ReturnType<typeof convertProtoToApiProvider> | undefined,
	actModeApiProvider: ReturnType<typeof convertProtoToApiProvider> | undefined,
): Promise<void> {
	const {
		autoApprovalSettings,
		planModeReasoningEffort,
		actModeReasoningEffort,
		mode,
		customPrompt,
		planModeApiProvider: _planModeApiProvider,
		actModeApiProvider: _actModeApiProvider,
		telemetrySetting,
		yoloModeToggled,
		useAutoCondense,
		diracWebToolsEnabled,
		worktreesEnabled,
		subagentsEnabled,
		browserSettings,
		defaultTerminalProfile,
		...simpleSettings
	} = settings
	// Batch update for simple pass-through fields
	controller.stateManager.setGlobalStateBatch(filterSimpleSettingsBatch(simpleSettings))
	Logger.log("autoApprovalSettings", controller.stateManager.getGlobalSettingsKey("autoApprovalSettings"))
	// Fields requiring type conversion
	if (autoApprovalSettings) mergeAutoApprovalSettings(controller, autoApprovalSettings)
	applyReasoningEffort(controller, planModeReasoningEffort, actModeReasoningEffort)
	if (mode !== undefined) applyModeCli(controller, mode)
	if (customPrompt === "compact") controller.stateManager.setGlobalState("customPrompt", "compact")
	if (planModeApiProvider !== undefined) controller.stateManager.setGlobalState("planModeApiProvider", planModeApiProvider)
	if (actModeApiProvider !== undefined) controller.stateManager.setGlobalState("actModeApiProvider", actModeApiProvider)
	// Telemetry setting
	if (telemetrySetting) await controller.updateTelemetrySetting(telemetrySetting as TelemetrySetting)
	// Settings with telemetry capture
	applyTelemetrySettingsCli(controller, {
		yoloModeToggled,
		useAutoCondense,
		diracWebToolsEnabled,
		worktreesEnabled,
		subagentsEnabled,
	})
	// Browser settings
	mergeBrowserSettingsCli(controller, browserSettings)
	// Terminal profile
	if (defaultTerminalProfile !== undefined && defaultTerminalProfile !== "")
		setDefaultTerminalProfile(controller, defaultTerminalProfile)
}

/**
 * Updates multiple extension settings from a CLI request
 * @param controller The controller instance
 * @param request The request containing the settings and secrets to update
 * @returns An empty response
 */
export async function updateSettingsCli(controller: Controller, request: UpdateSettingsRequestCli): Promise<Empty> {
	const settings = request.settings
	const secrets = request.secrets
		? Object.fromEntries(Object.entries(request.secrets).filter(([_, value]) => value !== undefined))
		: {}
	const candidateConfiguration = { ...controller.stateManager.getApiConfiguration(), ...secrets }
	let candidateMode = controller.stateManager.getGlobalSettingsKey("mode")
	const planModeApiProvider =
		settings?.planModeApiProvider === undefined ? undefined : convertProtoToApiProvider(settings.planModeApiProvider)
	const actModeApiProvider =
		settings?.actModeApiProvider === undefined ? undefined : convertProtoToApiProvider(settings.actModeApiProvider)
	if (settings) {
		Object.assign(candidateConfiguration, filterSimpleSettingsBatch(settings))
		if (planModeApiProvider !== undefined) {
			candidateConfiguration.planModeApiProvider = planModeApiProvider
		}
		if (actModeApiProvider !== undefined) {
			candidateConfiguration.actModeApiProvider = actModeApiProvider
		}
		if (settings.planModeReasoningEffort !== undefined) {
			candidateConfiguration.planModeReasoningEffort = normalizeOpenaiReasoningEffort(settings.planModeReasoningEffort)
		}
		if (settings.actModeReasoningEffort !== undefined) {
			candidateConfiguration.actModeReasoningEffort = normalizeOpenaiReasoningEffort(settings.actModeReasoningEffort)
		}
		if (settings.mode !== undefined) candidateMode = convertPlanActMode(settings.mode)
	}
	const candidateHandler = buildCandidateApiHandler(controller, candidateConfiguration, candidateMode)

	if (request.environment !== undefined) DiracEnv.setEnvironment(request.environment)
	if (settings) await applyCliSettings(controller, settings, planModeApiProvider, actModeApiProvider)
	commitApiConfiguration(
		controller,
		() => {
			if (Object.keys(secrets).length > 0) controller.stateManager.setSecretsBatch(secrets)
		},
		candidateHandler,
	)
	await controller.postStateToWebview()
	return Empty.create()
}
