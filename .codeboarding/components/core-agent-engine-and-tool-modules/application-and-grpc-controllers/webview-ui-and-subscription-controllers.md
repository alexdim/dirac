---
component_id: 1.2.4
component_name: Webview UI & Subscription Controllers
---

# Webview UI & Subscription Controllers

## Component Description

Assembles webview state snapshots, initializes the webview UI, and manages UI event subscriptions and navigation actions.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/ui/initializeWebview.ts (lines 42-56)
```
export async function initializeWebview(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await postCachedOpenRouterModels(controller)
		// Fire-and-forget: refresh other providers' models and sync model info into state
		refreshGroqModels(controller).then((m) => syncProviderModelInfo(controller, m, groqFields))
		refreshBasetenModels(controller).then((m) => syncProviderModelInfo(controller, m, basetenFields))
		refreshGithubCopilotModels().then((m) => syncProviderModelInfo(controller, m, githubCopilotFields))
		await refreshLiteLlmIfConfigured(controller)
		syncTelemetrySetting(controller)
		return Empty.create({})
	} catch (error) {
		Logger.error("Failed to initialize webview:", error)
		return Empty.create({})
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/ui/subscribeToChatButtonClicked.ts (lines 39-56)
```
export async function sendChatButtonClickedEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeChatButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			const event = Empty.create({})
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending chatButtonClicked event:", error)
			// Remove the subscription if there was an error
			activeChatButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/ui/subscribeToAddToInput.ts (lines 16-34)
```
export async function subscribeToAddToInput(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ProtoString>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeAddToInputSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeAddToInputSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "addToInput_subscription" }, responseStream)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/ui/subscribeToAccountButtonClicked.ts (lines 16-34)
```
export async function subscribeToAccountButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeAccountButtonClickedSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeAccountButtonClickedSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "accountButtonClicked_subscription" }, responseStream)
	}
}
```


## Source Files:

- `src/core/controller/ui/UiController.ts`
- `src/core/controller/ui/assembleAuthState.ts`
- `src/core/controller/ui/assembleModelState.ts`
- `src/core/controller/ui/assembleRuntimeState.ts`
- `src/core/controller/ui/assembleToolState.ts`
- `src/core/controller/ui/discoverAvailableSkills.ts`
- `src/core/controller/ui/getWebviewHtml.ts`
- `src/core/controller/ui/githubCopilotLogin.ts`
- `src/core/controller/ui/initializeWebview.ts`
- `src/core/controller/ui/onDidShowAnnouncement.ts`
- `src/core/controller/ui/openUrl.ts`
- `src/core/controller/ui/openWalkthrough.ts`
- `src/core/controller/ui/processTaskHistory.ts`
- `src/core/controller/ui/scrollToSettings.ts`
- `src/core/controller/ui/setTerminalExecutionMode.ts`
- `src/core/controller/ui/subscribeToAccountButtonClicked.ts`
- `src/core/controller/ui/subscribeToAddToInput.ts`
- `src/core/controller/ui/subscribeToChatButtonClicked.ts`
- `src/core/controller/ui/subscribeToHistoryButtonClicked.ts`
- `src/core/controller/ui/subscribeToRelinquishControl.ts`
- `src/core/controller/ui/subscribeToSettingsButtonClicked.ts`
- `src/core/controller/ui/subscribeToShowWebview.ts`
- `src/core/controller/ui/subscribeToWorktreesButtonClicked.ts`

