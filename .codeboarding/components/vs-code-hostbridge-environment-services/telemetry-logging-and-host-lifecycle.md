---
component_id: 17.4
component_name: Telemetry, logging, and host lifecycle
---

# Telemetry, logging, and host lifecycle

## Component Description

Subscribes to telemetry setting changes, appends debug logs to the Dirac output channel, opens external URLs, and handles shutdown.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/subscribeToTelemetrySettings.ts (lines 9-20)
```
export async function subscribeToTelemetrySettings(
	_: EmptyRequest,
	responseStream: StreamingResponseHandler,
	_requestId?: string,
): Promise<void> {
	vscode.env.onDidChangeTelemetryEnabled((isTelemetryEnabled) => {
		const event = {
			isEnabled: isTelemetryEnabled ? Setting.ENABLED : Setting.DISABLED,
		}
		responseStream(event, false)
	})
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/debugLog.ts (lines 7-10)
```
export async function debugLog(request: StringRequest): Promise<Empty> {
	CLINE_OUTPUT_CHANNEL.appendLine(request.value)
	return Empty.create({})
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/openExternal.ts (lines 4-9)
```
export async function openExternal(request: StringRequest): Promise<Empty> {
	const uri = vscode.Uri.parse(request.value)
	const opened = await vscode.env.openExternal(uri)
	if (!opened) throw new Error("Could not open the URL in the browser")
	return Empty.create({})
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/shutdown.ts (lines 3-9)
```
export async function shutdown(request: EmptyRequest): Promise<Empty> {
	// VSCode extensions cannot shutdown the host process (VSCode itself)
	// This is a no-op that just returns success
	// The shutdown RPC is primarily used by standalone dirac-core instances
	// to tell their paired host bridge processes to shut down
	return Empty.create({})
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/env/debugLog.ts`
- `src/hosts/vscode/hostbridge/env/openExternal.ts`
- `src/hosts/vscode/hostbridge/env/shutdown.ts`
- `src/hosts/vscode/hostbridge/env/subscribeToTelemetrySettings.ts`

