---
component_id: 5.1.1
component_name: Browser Controller & Task Tool Handlers
---

# Browser Controller & Task Tool Handlers

## Component Description

Provides controller endpoints, task tool adapters, and URL mention handlers that orchestrate browser discovery, connection testing, settings updates, and automated browser actions.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/browser/discoverBrowser.ts (lines 16-51)
```
export async function discoverBrowser(
	controller: Controller,
	_request: EmptyRequest,
	createBrowserSession: (stateManager: StateManager) => BrowserSession = (stateManager) => new BrowserSession(stateManager),
): Promise<BrowserConnection> {
	try {
		const discoveredHost = await discoverChromeInstances()

		if (discoveredHost) {
			// Don't update the remoteBrowserHost state when auto-discovering
			// This way we don't override the user's preference

			// Test the connection to get the endpoint
			const browserSession = createBrowserSession(controller.stateManager)
			const result = await browserSession.testConnection(discoveredHost)

			return BrowserConnection.create({
				success: true,
				message: `Successfully discovered and connected to Chrome at ${discoveredHost}`,
				endpoint: result.endpoint || "",
			})
		}
		return BrowserConnection.create({
			success: false,
			message:
				"No Chrome instances found. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
			endpoint: "",
		})
	} catch (error) {
		return BrowserConnection.create({
			success: false,
			message: `Error discovering browser: ${getErrorMessage(error)}`,
			endpoint: "",
		})
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/browser/getBrowserConnectionInfo.ts (lines 12-47)
```
export async function getBrowserConnectionInfo(controller: Controller, _: EmptyRequest): Promise<BrowserConnectionInfo> {
	try {
		// Get browser settings from extension state
		const browserSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")

		// Check if there's an active browser session by using the controller's handleWebviewMessage approach
		// This is similar to what's done in controller/index.ts for the "getBrowserConnectionInfo" message
		if (controller.task?.browserSession) {
			// Access the browser session through the controller's task property
			// Using indexer notation to access private property
			const browserSession = controller.task.browserSession
			const connectionInfo = browserSession.getConnectionInfo()

			// Convert from BrowserSession.BrowserConnectionInfo to proto.BrowserConnectionInfo
			return BrowserConnectionInfo.create({
				isConnected: connectionInfo.isConnected,
				isRemote: connectionInfo.isRemote,
				host: connectionInfo.host || "", // Ensure host is never undefined
			})
		}

		// Fallback to browser settings if no active browser session
		return BrowserConnectionInfo.create({
			isConnected: false,
			isRemote: !!browserSettings.remoteBrowserEnabled,
			host: browserSettings.remoteBrowserHost || "",
		})
	} catch (error: unknown) {
		Logger.error("Error getting browser connection info:", error)
		return BrowserConnectionInfo.create({
			isConnected: false,
			isRemote: false,
			host: "",
		})
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/web/openInBrowser.ts (lines 12-22)
```
export async function openInBrowser(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (request.value) {
			await openExternal(request.value)
		}
		return Empty.create()
	} catch (error) {
		Logger.error("Error opening URL in browser:", error)
		return Empty.create()
	}
}
```


## Source Files:

- `src/core/controller/browser/discoverBrowser.ts`
- `src/core/controller/browser/getBrowserConnectionInfo.ts`
- `src/core/controller/browser/getDetectedChromePath.ts`
- `src/core/controller/browser/relaunchChromeDebugMode.ts`
- `src/core/controller/browser/testBrowserConnection.ts`
- `src/core/controller/state/settingsBrowser.ts`
- `src/core/controller/state/updateTaskSettings.ts`
- `src/core/controller/web/openInBrowser.ts`
- `src/core/mentions/url-mention.ts`
- `src/core/task/tools/adapters/traits/BrowserTraitBuilder.ts`
- `src/core/task/tools/modules/browser_action/BrowserActionTool.ts`
- `src/core/task/tools/modules/browser_action/tool.ts`

