---
component_id: 1.2.1
component_name: State & Auth Controllers
---

# State & Auth Controllers

## Component Description

Manages extension state persistence, settings updates, state publication queues, and OAuth/provider authentication completion flows.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/state/StateController.ts (lines 21-103)
```
export class StateController {
	private readonly stateManager: StateManager
	private readonly getTask: () => import("@core/task").Task | undefined
	private readonly buildApiHandlerFn: typeof buildApiHandler
	private readonly postStateToWebviewFn: () => Promise<void>
	private readonly cancelTaskFn: () => Promise<void>
	private readonly captureModeSwitchFn: (taskId: string, mode: Mode) => void

	constructor(deps: StateControllerDependencies) {
		this.stateManager = deps.stateManager
		this.getTask = () => deps.task
		this.buildApiHandlerFn = deps.buildApiHandlerFn
		this.postStateToWebviewFn = deps.postStateToWebviewFn
		this.cancelTaskFn = deps.cancelTaskFn
		this.captureModeSwitchFn = deps.captureModeSwitchFn
	}

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		const previousSetting = this.stateManager.getGlobalSettingsKey("telemetrySetting")
		const wasOptedIn = previousSetting !== "disabled"
		const isOptedIn = telemetrySetting !== "disabled"

		if (wasOptedIn && !isOptedIn) {
			telemetryService.captureUserOptOut()
		}

		this.stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		telemetryService.updateTelemetryState(isOptedIn)

		if (!wasOptedIn && isOptedIn) {
			telemetryService.captureUserOptIn()
		}

		await this.postStateToWebviewFn()
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		const modeToSwitchTo: Mode = "act"
		const task = this.getTask()
		const persistMode = () => persistModeSelection(this.stateManager, modeToSwitchTo)

		if (task) await task.applyWorkingConfigurationUpdate({ settings: { mode: modeToSwitchTo } }, persistMode)
		else persistMode()

		await this.postStateToWebviewFn()
		return !!task
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		const didSwitchToActMode = modeToSwitchTo === "act"
		const task = this.getTask()
		const persistMode = () => persistModeSelection(this.stateManager, modeToSwitchTo)

		if (task) await task.applyWorkingConfigurationUpdate({ settings: { mode: modeToSwitchTo } }, persistMode)
		else persistMode()

		this.captureModeSwitchFn(task?.ulid ?? "0", modeToSwitchTo)
		await this.postStateToWebviewFn()

		if (!task) return false
		if (task.stateView.isAwaitingPlanResponse && didSwitchToActMode) {
			const cardId = task.stateView.lastWaitingCardId
			if (cardId) {
				await task.submitCardResponse(
					cardId,
					DiracAskResponse.APPROVE,
					chatContent?.message || PlanInteractionResponse.MODE_TOGGLE,
					chatContent?.images || [],
					chatContent?.files || [],
				)
			}
			return true
		}
		if (task.stateView.status === TaskStatus.COMPLETED) return false

		await this.cancelTaskFn()
		return false
	}

	async getTelemetrySetting(): Promise<TelemetrySetting> {
		return this.stateManager.getGlobalSettingsKey("telemetrySetting") || "default"
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/auth/AuthController.ts (lines 22-105)
```
export class AuthController {
	constructor(private readonly deps: AuthControllerDependencies) {}

	async completeOpenRouterAuth(code: string) {
		let apiKey: string
		try {
			const response = await axios.post("https://openrouter.ai/api/v1/auth/keys", { code }, getAxiosSettings())
			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			Logger.error("Error exchanging code for API key:", error)
			throw error
		}

		const openrouter: ApiProvider = "openrouter"
		const currentApiConfiguration = this.deps.stateManager.getApiConfiguration()
		const updatedConfig = {
			...currentApiConfiguration,
			openRouterApiKey: apiKey,
			...(currentApiConfiguration.planModeOpenRouterModelId ? { planModeApiProvider: openrouter } : {}),
			...(currentApiConfiguration.actModeOpenRouterModelId ? { actModeApiProvider: openrouter } : {}),
		}
		await applyApiConfigurationTransaction(this.deps, updatedConfig, undefined, undefined, {
			openRouterApiKey: apiKey,
			...(currentApiConfiguration.planModeOpenRouterModelId ? { planModeApiProvider: openrouter } : {}),
			...(currentApiConfiguration.actModeOpenRouterModelId ? { actModeApiProvider: openrouter } : {}),
		})
		await this.deps.postStateToWebview()
	}

	async completeGithubLogin() {
		try {
			const data = await githubCopilotAuthManager.initiateDeviceFlow()
			const openUrl = "Open GitHub"
			const response = await HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `GitHub Copilot: Enter code ${data.user_code} at ${data.verification_uri}`,
				options: { items: [openUrl] },
			})
			if (response.selectedOption !== openUrl) return

			await openExternal(data.verification_uri)

			githubCopilotAuthManager
				.pollForToken(data.device_code, data.interval)
				.then(async () => {
					await this.deps.postStateToWebview()
					HostProvider.window.showMessage({
						type: ShowMessageType.INFORMATION,
						message: "Successfully authenticated with GitHub Copilot!",
					})
				})
				.catch((error) => {
					Logger.error("GitHub Copilot auth polling failed:", error)
				})
		} catch (error) {
			Logger.error("GitHub Copilot login failed:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `GitHub Copilot login failed: ${getErrorMessage(error)}`,
			})
		}
	}

	async completeRequestyAuth(code: string) {
		const requesty: ApiProvider = "requesty"
		const currentApiConfiguration = this.deps.stateManager.getApiConfiguration()
		const updatedConfig = {
			...currentApiConfiguration,
			planModeApiProvider: requesty,
			actModeApiProvider: requesty,
			requestyApiKey: code,
		}
		await applyApiConfigurationTransaction(this.deps, updatedConfig, undefined, undefined, {
			planModeApiProvider: requesty,
			actModeApiProvider: requesty,
			requestyApiKey: code,
		})
		await this.deps.postStateToWebview()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/state/settingsApiConfig.ts (lines 9-28)
```
export async function applyApiConfiguration(controller: Controller, request: UpdateSettingsRequest): Promise<void> {
	const mode = convertMode(request.mode)
	if (!request.apiConfiguration) {
		if (mode === undefined) return
		await commitWorkingConfigurationUpdate(
			controller,
			() => persistApiConfigurationAndMode(controller.stateManager, {}, mode),
			controller.task ? { settings: { mode } } : undefined,
		)
		return
	}

	const configuration = convertProtoToApiConfiguration(request.apiConfiguration)
	await applyApiConfigurationTransaction(
		controller,
		configuration,
		() => persistApiConfigurationAndMode(controller.stateManager, configuration, mode),
		mode,
	)
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/state/subscribeToState.ts (lines 14-38)
```
export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
	requestId?: string,
): Promise<void> {
	const cleanup = () => {
		activeStateSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	try {
		const initialDelivery = enqueueSubscriptionDelivery(responseStream, async () => {
			await sendStateToSubscription(await controller.getStateToPostToWebview(), responseStream, 0)
		})
		activeStateSubscriptions.add(responseStream)
		await initialDelivery
	} catch (error) {
		Logger.error("Error publishing initial state:", error)
		activeStateSubscriptions.delete(responseStream)
	}
}
```


## Source Files:

- `src/core/controller/auth/AuthController.ts`
- `src/core/controller/state/StateController.ts`
- `src/core/controller/state/StatePublicationQueue.ts`
- `src/core/controller/state/activateModelProviderPreset.ts`
- `src/core/controller/state/captureOnboardingProgress.ts`
- `src/core/controller/state/dismissBanner.ts`
- `src/core/controller/state/flushPendingState.ts`
- `src/core/controller/state/getAvailableTerminalProfiles.ts`
- `src/core/controller/state/getLatestState.ts`
- `src/core/controller/state/getProcessInfo.ts`
- `src/core/controller/state/persistModeSelection.ts`
- `src/core/controller/state/reasoningEffort.ts`
- `src/core/controller/state/resetState.ts`
- `src/core/controller/state/setWelcomeViewCompleted.ts`
- `src/core/controller/state/settingsApiConfig.ts`
- `src/core/controller/state/settingsTerminalProfile.ts`
- `src/core/controller/state/settingsWebview.ts`
- `src/core/controller/state/subscribeToState.ts`
- `src/core/controller/state/testOtelConnection.ts`
- `src/core/controller/state/testPromptUploading.ts`
- `src/core/controller/state/toggleFavoriteModel.ts`
- `src/core/controller/state/togglePlanActModeProto.ts`
- `src/core/controller/state/trackBannerEvent.ts`
- `src/core/controller/state/updateAutoApprovalSettings.ts`
- `src/core/controller/state/updateInfoBannerVersion.ts`
- `src/core/controller/state/updateModelBannerVersion.ts`
- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/state/updateTelemetrySetting.ts`
- `src/core/controller/state/updateTerminalConnectionTimeout.ts`
- `src/core/controller/state/updateTerminalReuseEnabled.ts`

