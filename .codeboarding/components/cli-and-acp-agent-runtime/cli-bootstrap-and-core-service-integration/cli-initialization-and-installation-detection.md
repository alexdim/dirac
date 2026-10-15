---
component_id: 2.4.2
component_name: CLI Initialization & Installation Detection
---

# CLI Initialization & Installation Detection

## Component Description

Initializes CLI core services and entrypoints while providing Dirac CLI installation detection and task utilities.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/initCoreServices.ts (lines 26-30)
```
export async function initCoreServices(opts: CoreServicesInitOptions): Promise<void> {
	await DiracEndpoint.initialize(opts.extensionDir)
	await StateManager.initialize(opts.storageContext)
	await ErrorService.initialize()
}
```

### /Users/highlands/pools/Development/dirac/src/utils/cli-detector.ts (lines 10-26)
```
export async function isDiracCliInstalled(): Promise<boolean> {
	try {
		// Try to get the version of the dirac CLI tool
		// This will fail if the tool is not installed
		const { stdout } = await execAsync("dirac version", {
			timeout: 5000, // 5 second timeout
		})

		// If we get here, the CLI is installed
		// We could also validate the version if needed
		return stdout.includes("Dirac CLI Version") || stdout.includes("Dirac Core Version")
	} catch (error) {
		// Command failed, which likely means CLI is not installed
		// or not in PATH
		return false
	}
}
```


## Source Files:

- `cli/src/index.ts`
- `cli/src/init.ts`
- `cli/src/initCoreServices.ts`
- `cli/src/types.ts`
- `src/core/task/utils.ts`
- `src/utils/cli-detector.ts`

