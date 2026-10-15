---
component_id: 2.4.1
component_name: CLI State & Unbiased Model Controller Handlers
---

# CLI State & Unbiased Model Controller Handlers

## Component Description

Handles controller RPC commands for Dirac CLI installation/settings state and Unbiased model authentication and refresh.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/models/authenticateUnbiased.ts (lines 18-64)
```
export async function authenticateUnbiased(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<UnbiasedAuthEvent>,
	requestId?: string,
): Promise<void> {
	const abortController = new AbortController()
	const generation = signOutGeneration.get(controller.stateManager) ?? 0
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, () => abortController.abort(), { type: "unbiased_auth" }, responseStream)
	}
	try {
		const options = { fetcher: fetch, signal: abortController.signal }
		const grant = await startUnbiasedDeviceAuth(os.hostname(), options)
		await responseStream(
			UnbiasedAuthEvent.create({
				url: grant.verificationUri,
				userCode: grant.userCode,
				verificationUriComplete: grant.verificationUriComplete,
			}),
		)
		const token = await pollUnbiasedDeviceAuth(grant, options)
		if (generation !== (signOutGeneration.get(controller.stateManager) ?? 0)) return
		// Persist the one-time issued key before validating an active Task update.
		// Even if that update fails, the user can use their key without signing in again.
		const patch = { unbiasedApiKey: token.accessToken }
		const stateManager = controller.stateManager
		persistApiConfigurationPatch(stateManager, patch)
		stateManager.setGlobalStateBatch(createUnbiasedOAuthAccount(token))
		await stateManager.flushPendingState()
		try {
			if (!abortController.signal.aborted && generation === (signOutGeneration.get(stateManager) ?? 0)) {
				await applyApiConfigurationTransaction(controller, stateManager.getApiConfiguration(), () => {}, undefined, patch)
			}
		} finally {
			// Publish the saved key even if the user cancelled or the active Task update failed.
			await controller.postStateToWebview()
		}
		if (!abortController.signal.aborted && generation === (signOutGeneration.get(stateManager) ?? 0)) {
			await responseStream(UnbiasedAuthEvent.create({ completed: true, workloadName: token.workloadName }), true)
		}
	} catch (error) {
		if (!abortController.signal.aborted) throw error
	} finally {
		if (requestId) getRequestRegistry().cancelRequest(requestId)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/models/refreshUnbiasedModelsRpc.ts (lines 12-35)
```
export async function refreshUnbiasedModelsRpc(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const stateManager = controller.stateManager
	const models = await fetchUnbiasedModels(stateManager.getApiConfiguration().unbiasedApiKey, {
		cache: stateManager,
		cacheFilePath: async () => path.join(await ensureCacheDirectoryExists(), GlobalFileNames.unbiasedModels),
		fileExists: fileExistsAtPath,
		axiosSettings: getAxiosSettings(),
	})
	return OpenRouterCompatibleModelInfo.create({
		models: Object.fromEntries(
			Object.entries(models).map(([id, info]) => [
				id,
				{
					...toProtobufModelInfo(info),
					name: info.name,
					supportsTools: info.supportsTools,
				},
			]),
		),
	})
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/state/checkCliInstallation.ts (lines 10-17)
```
export async function checkCliInstallation(_controller: Controller): Promise<Boolean> {
	try {
		const isInstalled = await isDiracCliInstalled()
		return Boolean.create({ value: isInstalled })
	} catch {
		return Boolean.create({ value: false })
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/state/settingsTelemetry.ts (lines 33-50)
```
export function applyTelemetrySettingsCli(controller: Controller, fields: any): void {
	if (fields.yoloModeToggled !== undefined && controller.task) {
		telemetryService.captureYoloModeToggle(controller.task.ulid, fields.yoloModeToggled)
	}
	if (fields.useAutoCondense !== undefined && controller.task) {
		telemetryService.captureAutoCondenseToggle(
			controller.task.ulid,
			fields.useAutoCondense,
			controller.task.api.getModel().id,
		)
	}
	if (fields.diracWebToolsEnabled !== undefined && controller.task) {
		telemetryService.captureDiracWebToolsToggle(controller.task.ulid, fields.diracWebToolsEnabled)
	}
	if (fields.subagentsEnabled !== undefined) {
		telemetryService.captureSubagentToggle(!!fields.subagentsEnabled)
	}
}
```


## Source Files:

- `src/core/controller/models/authenticateUnbiased.ts`
- `src/core/controller/models/refreshUnbiasedModelsRpc.ts`
- `src/core/controller/models/signOutUnbiased.ts`
- `src/core/controller/state/checkCliInstallation.ts`
- `src/core/controller/state/installDiracCli.ts`
- `src/core/controller/state/settingsCli.ts`
- `src/core/controller/state/settingsMode.ts`
- `src/core/controller/state/settingsTelemetry.ts`
- `src/core/controller/state/updateCliBannerVersion.ts`
- `src/core/controller/state/updateSettingsCli.ts`

