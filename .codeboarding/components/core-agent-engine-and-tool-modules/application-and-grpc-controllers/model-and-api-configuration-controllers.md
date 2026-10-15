---
component_id: 1.2.2
component_name: Model & API Configuration Controllers
---

# Model & API Configuration Controllers

## Component Description

Handles model catalog discovery, caching, provider model refresh RPCs, and transactional API configuration persistence.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/models/apiConfigurationTransaction.ts (lines 54-77)
```
export async function applyApiConfigurationTransaction(
	controller: ApiConfigurationTransactionContext,
	configuration: ApiConfiguration,
	persist: ApiConfigurationPersistence = () => persistApiConfigurationPatch(controller.stateManager, configuration),
	mode?: Mode,
	activeConfigurationPatch: Partial<ApiConfiguration> = configuration,
): Promise<void> {
	const activeTaskPatch: TaskWorkingConfigurationPatch = {
		apiConfiguration: activeConfigurationPatch,
		...(mode === undefined ? {} : { settings: { mode } }),
	}

	if (!controller.task) {
		validateApiConfiguration(configuration, mode ?? controller.stateManager.getGlobalSettingsKey("mode"))
	} else {
		const current = controller.task.getWorkingConfiguration()
		validateApiConfiguration(
			{ ...current.apiConfiguration, ...activeConfigurationPatch } as ApiConfiguration,
			mode ?? current.settings.mode,
		)
	}

	await commitWorkingConfigurationUpdate(controller, persist, controller.task ? activeTaskPatch : undefined)
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/models/apiConfigurationPersistence.ts (lines 49-74)
```
export function persistApiConfigurationAndMode(
	stateManager: StateManager,
	configurationPatch: Partial<ApiConfiguration>,
	mode?: Mode,
	afterPersist?: () => void,
): void {
	const hadApiUpdate = Object.keys(configurationPatch).length > 0
	const hadModeUpdate = mode !== undefined
	const snapshot = capturePersistenceSnapshot(stateManager, configurationPatch, mode)

	try {
		if (hadApiUpdate) stateManager.setApiConfiguration(configurationPatch as ApiConfiguration)
		if (mode !== undefined) {
			stateManager.setGlobalState("mode", mode)
			stateManager.setSessionOverride("mode", mode)
		}
		afterPersist?.()
	} catch (error) {
		try {
			restorePersistenceSnapshot(stateManager, snapshot, hadApiUpdate, hadModeUpdate)
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], "API and mode persistence rollback failed")
		}
		throw error
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/models/authenticateOpenAiCodex.ts (lines 8-46)
```
export async function authenticateOpenAiCodex(
	controller: Controller,
	request: OpenAiCodexAuthRequest,
	responseStream: StreamingResponseHandler<OpenAiCodexAuthEvent>,
	requestId?: string,
): Promise<void> {
	const abortController = new AbortController()
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => abortController.abort(),
			{ type: "openai_codex_auth" },
			responseStream,
		)
	}
	try {
		if (
			request.method !== OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_BROWSER &&
			request.method !== OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_DEVICE
		) {
			throw new Error("Unknown ChatGPT sign-in method")
		}
		await openAiCodexOAuthManager.authenticate(
			request.method === OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_DEVICE ? "device" : "browser",
			async ({ url, userCode }) => {
				await responseStream(OpenAiCodexAuthEvent.create({ url, userCode }))
			},
			abortController.signal,
		)
		abortController.signal.throwIfAborted()
		openAiCodexUsageService.clear()
		await controller.postStateToWebview()
		await responseStream(OpenAiCodexAuthEvent.create({ completed: true }), true)
	} catch (error) {
		if (!abortController.signal.aborted) throw error
	} finally {
		if (requestId) getRequestRegistry().cancelRequest(requestId)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/models/subscribeToOpenRouterModels.ts (lines 41-58)
```
export async function sendOpenRouterModelsEvent(models: OpenRouterCompatibleModelInfo): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeOpenRouterModelsSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				models,
				false, // Not the last message
			)
			Logger.log("[DEBUG] sending OpenRouter models event")
		} catch (error) {
			Logger.error("Error sending OpenRouter models event:", error)
			// Remove the subscription if there was an error
			activeOpenRouterModelsSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
```


## Source Files:

- `src/core/controller/models/apiConfigurationPersistence.ts`
- `src/core/controller/models/apiConfigurationTransaction.ts`
- `src/core/controller/models/authenticateOpenAiCodex.ts`
- `src/core/controller/models/fetchAndCacheModels.ts`
- `src/core/controller/models/fetchOpenRouterModelRankings.ts`
- `src/core/controller/models/getAihubmixModels.ts`
- `src/core/controller/models/getLmStudioModels.ts`
- `src/core/controller/models/getOpenRouterEndpoints.ts`
- `src/core/controller/models/getVsCodeLmModels.ts`
- `src/core/controller/models/refreshBasetenModelsRpc.ts`
- `src/core/controller/models/refreshGithubCopilotModels.ts`
- `src/core/controller/models/refreshGroqModels.ts`
- `src/core/controller/models/refreshGroqModelsRpc.ts`
- `src/core/controller/models/refreshHuggingFaceModels.ts`
- `src/core/controller/models/refreshLiteLlmModels.ts`
- `src/core/controller/models/refreshLiteLlmModelsRpc.ts`
- `src/core/controller/models/refreshOpenAiCodexUsage.ts`
- `src/core/controller/models/refreshOpenAiModels.ts`
- `src/core/controller/models/refreshOpenRouterModels.ts`
- `src/core/controller/models/refreshOpenRouterModelsRpc.ts`
- `src/core/controller/models/refreshRequestyModels.ts`
- `src/core/controller/models/refreshVercelAiGatewayModels.ts`
- `src/core/controller/models/refreshVercelAiGatewayModelsRpc.ts`
- `src/core/controller/models/signOutOpenAiCodex.ts`
- `src/core/controller/models/subscribeToLiteLlmModels.ts`
- `src/core/controller/models/subscribeToOpenRouterModels.ts`
- `src/core/controller/models/updateApiConfiguration.ts`
- `src/core/controller/models/updateApiConfigurationPartial.ts`
- `src/core/controller/models/updateApiConfigurationProto.ts`

