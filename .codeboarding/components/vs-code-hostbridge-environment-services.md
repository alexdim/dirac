---
component_id: 17
component_name: VS Code Hostbridge Environment Services
---

# VS Code Hostbridge Environment Services

## Component Description

Implements environment-specific hostbridge operations for the VS Code host, including clipboard access, debug logging, version retrieval, telemetry settings, and shutdown handling.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/clipboardReadText.ts (lines 4-7)
```
export async function clipboardReadText(_: EmptyRequest): Promise<String> {
	const text = await vscode.env.clipboard.readText()
	return String.create({ value: text })
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/clipboardWriteText.ts (lines 4-7)
```
export async function clipboardWriteText(request: StringRequest): Promise<Empty> {
	await vscode.env.clipboard.writeText(request.value)
	return Empty.create({})
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/debugLog.ts (lines 7-10)
```
export async function debugLog(request: StringRequest): Promise<Empty> {
	CLINE_OUTPUT_CHANNEL.appendLine(request.value)
	return Empty.create({})
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/env/clipboardReadText.ts`
- `src/hosts/vscode/hostbridge/env/clipboardWriteText.ts`
- `src/hosts/vscode/hostbridge/env/debugLog.ts`
- `src/hosts/vscode/hostbridge/env/getHostVersion.ts`
- `src/hosts/vscode/hostbridge/env/getIdeRedirectUri.ts`
- `src/hosts/vscode/hostbridge/env/getTelemetrySettings.ts`
- `src/hosts/vscode/hostbridge/env/openExternal.ts`
- `src/hosts/vscode/hostbridge/env/shutdown.ts`
- `src/hosts/vscode/hostbridge/env/subscribeToTelemetrySettings.ts`

