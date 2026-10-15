---
component_id: 4.8
component_name: Host Capabilities & Provider Contracts
---

# Host Capabilities & Provider Contracts

## Component Description

Defines shared host capability registries and client provider contracts consumed across host implementations.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/host-capabilities.ts (lines 9-11)
```
export function setHostCapabilities(next: HostCapabilities | undefined): void {
	capabilities = next
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/host-provider-types.ts (lines 13-18)
```
export interface HostBridgeClientProvider {
	workspaceClient: WorkspaceServiceClientInterface
	envClient: EnvServiceClientInterface
	windowClient: WindowServiceClientInterface
	diffClient: DiffServiceClientInterface
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/host-provider-types.ts (lines 31-44)
```
export interface HostCapabilities {
	/** Opens the product walkthrough UI (VS Code only). */
	openWalkthrough?: () => Promise<void>
	/** Reads the visible contents of the active terminal, when the host exposes them. */
	getLatestTerminalOutput?: () => Promise<string>
	/** Lists chat models offered by the host's built-in language-model API (VS Code `vscode.lm`). */
	listVsCodeLmModels?: () => Promise<VsCodeNativeModel[]>
	/** Builds the vscode-lm API handler — only the VS Code host can create it. */
	createVsCodeLmHandler?: (options: VsCodeLmHandlerFactoryOptions) => ApiHandler
	/** Reads a host workspace-configuration value (VS Code `workspace.getConfiguration`). */
	getWorkspaceConfig?: (section: string, key: string) => unknown
	/** Disposes host-side e2e test-mode watchers; no-op where test mode cannot exist. */
	cleanupTestMode?: () => void
}
```


## Source Files:

- `src/hosts/host-capabilities.ts`
- `src/hosts/host-provider-types.ts`

