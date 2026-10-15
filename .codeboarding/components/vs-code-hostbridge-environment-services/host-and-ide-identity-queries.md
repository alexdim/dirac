---
component_id: 17.2
component_name: Host and IDE identity queries
---

# Host and IDE identity queries

## Component Description

Provides the host application version and the IDE redirect URI for auth callbacks.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/getHostVersion.ts (lines 7-14)
```
export async function getHostVersion(_: EmptyRequest): Promise<GetHostVersionResponse> {
	return {
		platform: vscode.env.appName,
		version: vscode.version,
		diracType: DiracClient.VSCode,
		diracVersion: ExtensionRegistryInfo.version,
	}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/getIdeRedirectUri.ts (lines 4-13)
```
export async function getIdeRedirectUri(_: EmptyRequest): Promise<String> {
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		// In VS Code Web (code serve-web), the auth callback is handled by an HTTP server
		// (AuthHandler). Returning empty here means the success page won't try to redirect
		// to a vscode:// URI (which would open the desktop app instead of the web tab).
		return { value: "" }
	}
	const uriScheme = vscode.env.uriScheme || "vscode"
	return { value: `${uriScheme}://dirac-run.dirac` }
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/env/getHostVersion.ts`
- `src/hosts/vscode/hostbridge/env/getIdeRedirectUri.ts`
- `src/hosts/vscode/hostbridge/env/getTelemetrySettings.ts`

