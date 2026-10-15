---
component_id: 2.1.4
component_name: CLI Extension & Storage Context Adapter
---

# CLI Extension & Storage Context Adapter

## Component Description

Initializes the CLI storage context and VSCode extension context shim with CLI-specific global state overrides.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/vscode-context.ts (lines 157-228)
```
export function initializeCliContext(config: CliContextConfig = {}): CliContextResult {
	const DIRAC_DIR = config.diracDir || process.env.DIRAC_DIR || path.join(os.homedir(), ".dirac")

	// Create the shared StorageContext — this owns all DiracFileStorage instances.
	// CLI, JetBrains, and VSCode all share this same file-backed implementation.
	let storageContext = createStorageContext({
		diracDir: DIRAC_DIR,
		workspacePath: config.workspaceDir || process.cwd(),
		workspaceStorageDir: process.env.WORKSPACE_STORAGE_DIR || undefined,
	})
	storageContext = {
		...storageContext,
		// Storage — delegates to storageContext stores (with CLI overrides for globalState)
		globalState: new MementoAdapter(storageContext.globalState, CLI_STATE_OVERRIDES),
	}

	const DATA_DIR = storageContext.dataDir
	const WORKSPACE_STORAGE_DIR = storageContext.workspaceStoragePath

	// For CLI, extension dir is the package root (one level up from dist/)
	let EXTENSION_DIR = path.resolve(__dirname, "..")

	// If we're running from a bundled CLI, __dirname might be inside dist/
	// and we want to make sure we can find the source code.
	if (process.env.IS_CLI === "true" && !fs.existsSync(path.join(EXTENSION_DIR, "package.json"))) {
		// Try to find the repo root or the directory containing 'dist/source'
		if (fs.existsSync(path.join(__dirname, "source"))) {
			EXTENSION_DIR = __dirname
		}
	}
	const EXTENSION_MODE = process.env.IS_DEV === "true" ? ExtensionMode.Development : ExtensionMode.Production

	const extension: DiracExtensionContext["extension"] = {
		id: ExtensionRegistryInfo.id,
		isActive: true,
		extensionPath: EXTENSION_DIR,
		extensionUri: URI.file(EXTENSION_DIR),
		packageJSON: readJson(path.join(EXTENSION_DIR, "package.json")),
		exports: undefined,
		activate: async () => {},
		extensionKind: ExtensionKind.UI,
	}

	// Build the DiracExtensionContext shell. All storage delegates to storageContext —
	// there are NO separate DiracFileStorage instances here.
	const extensionContext: DiracExtensionContext = {
		extension: extension,
		extensionMode: EXTENSION_MODE,

		// URIs / paths
		storageUri: URI.file(WORKSPACE_STORAGE_DIR),
		storagePath: WORKSPACE_STORAGE_DIR,
		globalStorageUri: URI.file(DATA_DIR),
		globalStoragePath: DATA_DIR,
		logUri: URI.file(DATA_DIR),
		logPath: DATA_DIR,
		extensionUri: URI.file(EXTENSION_DIR),
		extensionPath: EXTENSION_DIR,
		asAbsolutePath: (relPath: string) => path.join(EXTENSION_DIR, relPath),

		subscriptions: [],
		environmentVariableCollection: new EnvironmentVariableCollection() as any,
	}

	return {
		extensionContext,
		storageContext,
		DATA_DIR,
		EXTENSION_DIR,
		WORKSPACE_STORAGE_DIR,
	}
}
```


## Source Files:

- `cli/src/vscode-context.ts`

