---
component_id: 5.2.1
component_name: Standalone Server Bootstrap & Host Runtime
---

# Standalone Server Bootstrap & Host Runtime

## Component Description

Bootstraps the standalone Dirac server process, initializes emulated VSCode extension context, starts the ProtoBus gRPC service and HostBridge client, and manages the global SQLite instance lock manager.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/standalone/dirac-core.ts (lines 24-102)
```
async function main() {
	log("\n\n\nStarting dirac-core service...\n\n\n")
	log(`Runtime: node ${process.version} on ${process.platform}/${process.arch}`)

	// Parse command line arguments
	const args = parseArgs()

	// Show help if requested
	if (args.help) {
		showHelp()
		process.exit(0)
	}

	// Resource loading assumes cwd is the installation directory
	process.chdir(__dirname)

	// Initialize context with optional custom directory from CLI
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeContext(args.config)

	// Configure ports - CLI args override everything
	if (args.port) {
		process.env.PROTOBUS_ADDRESS = `127.0.0.1:${args.port}`
		// Auto-calculate hostbridge port if not specified
		if (!args.hostBridgePort) {
			process.env.HOST_BRIDGE_ADDRESS = `127.0.0.1:${HOSTBRIDGE_PORT}`
		}
	}
	if (args.hostBridgePort) {
		process.env.HOST_BRIDGE_ADDRESS = `127.0.0.1:${args.hostBridgePort}`
	}

	try {
		// Set up error handlers FIRST (before any service starts)
		setupGlobalErrorHandlers()

		const hostAddress = await waitForHostBridgeReady()

		// The host bridge should be available before creating the host provider because it depends on the host bridge.
		setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR)

		// Create shared file-backed storage
		const storageContext = createStorageContext({ diracDir: args.config })
		const webviewProvider = await initialize(storageContext)

		// Enable the localhost HTTP server that handles auth redirects.
		AuthHandler.getInstance().setEnabled(true)

		// Now this will throw instead of exit if binding fails
		const protobusAddress = await startProtobusService(webviewProvider.controller)

		// Initialize SQLite lock manager for instance registration
		const dbPath = `${DATA_DIR}/locks.db`
		globalLockManager = await SqliteLockManager.create({
			dbPath,
			instanceAddress: protobusAddress,
		})

		// Make lock manager available to other modules
		setLockManager(globalLockManager)

		await globalLockManager.registerInstance({
			hostAddress,
		})
		log(`Registered instance in SQLite locks: ${protobusAddress}`)

		// Clean up any orphaned folder locks from dead instances
		globalLockManager.cleanupOrphanedFolderLocks()

		// Mark instance healthy after services are up
		globalLockManager.touchInstance()

		log("All services started successfully")
	} catch (err) {
		log(`FATAL ERROR during startup: ${err}`)
		log(`Cleaning up and shutting down...`)
		await shutdownGracefully(globalLockManager)
		process.exit(1)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/standalone/dirac-core.ts (lines 104-134)
```
function setupHostProvider(extensionContext: any, extensionDir: string, dataDir: string) {
	const createWebview = (): DiracWebviewProvider => {
		return new ExternalDiracWebviewProvider(extensionContext)
	}
	const createDiffView = (): DiffViewProvider => {
		return new ExternalDiffViewProvider()
	}
	const createCommentReview = () => new ExternalCommentReviewController()
	const createTerminalManager = () => new StandaloneTerminalManager()
	const getCallbackUrl = (path: string, preferredPort?: number): Promise<string> => {
		return AuthHandler.getInstance().getCallbackUrl(path, preferredPort)
	}
	// dirac-core expects the binaries to be unpacked in the directory where it is running.
	const getBinaryLocation = async (name: string): Promise<string> => path.join(process.cwd(), name)
	const getEnvironmentVariables = async (_cwd: string) => undefined

	HostProvider.initialize(
		"extension",
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		new ExternalHostBridgeClientManager(),
		log,
		getCallbackUrl,
		getBinaryLocation,
		extensionDir,
		dataDir,
		getEnvironmentVariables,
	)
}
```

### /Users/highlands/pools/Development/dirac/src/standalone/protobus-service.ts (lines 13-44)
```
export function startProtobusService(controller: Controller): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = new grpc.Server()

		// Set up health check.
		const healthImpl = new health.HealthImplementation({ "": "SERVING" })
		healthImpl.addToServer(server)

		// Add all the handlers for the ProtoBus services to the server.
		addProtobusServices(server, controller, wrapHandler, wrapStreamingResponseHandler)

		// Create reflection service with protobus service names
		const packageDefinition = getPackageDefinition()
		const reflection = new ReflectionService(packageDefinition, {
			services: getProtobusServiceNames(packageDefinition),
		})
		reflection.addToServer(server)

		// Start the server.
		const host = process.env.PROTOBUS_ADDRESS || `127.0.0.1:${PROTOBUS_PORT}`
		server.bindAsync(host, grpc.ServerCredentials.createInsecure(), (err) => {
			if (err) {
				log(`Could not start ProtoBus service: Failed to bind to ${host}, port may be unavailable. ${err.message}`)
				reject(new Error(`Failed to bind ProtoBus to ${host}: ${err.message}`))
				return
			}
			server.start()
			log(`ProtoBus gRPC server listening on ${host}`)
			resolve(host)
		})
	})
}
```

### /Users/highlands/pools/Development/dirac/src/standalone/lock-manager.ts (lines 13-15)
```
export function getLockManager(): SqliteLockManager | undefined {
	return lockManagerInstance
}
```

### /Users/highlands/pools/Development/dirac/src/standalone/vscode-context.ts (lines 31-96)
```
export function initializeContext(diracDir?: string) {
	const DIRAC_DIR = diracDir || process.env.DIRAC_DIR || `${os.homedir()}/.dirac`
	const DATA_DIR = path.join(DIRAC_DIR, SETTINGS_SUBFOLDER)
	const INSTALL_DIR = process.env.INSTALL_DIR || __dirname
	const WORKSPACE_STORAGE_DIR = process.env.WORKSPACE_STORAGE_DIR || path.join(DATA_DIR, "workspace")

	mkdirSync(DATA_DIR, { recursive: true })
	mkdirSync(WORKSPACE_STORAGE_DIR, { recursive: true })
	log("Using settings dir:", DATA_DIR)

	const EXTENSION_DIR = path.join(INSTALL_DIR, "extension")
	const EXTENSION_MODE = isDev() ? ExtensionMode.Development : ExtensionMode.Production

	const extension: Extension<void> = {
		id: ExtensionRegistryInfo.id,
		isActive: true,
		extensionPath: EXTENSION_DIR,
		extensionUri: URI.file(EXTENSION_DIR),
		packageJSON: readJson(path.join(EXTENSION_DIR, "package.json")),
		exports: undefined, // There are no API exports in the standalone version.
		activate: async () => {},
		extensionKind: ExtensionKind.UI,
	}

	const extensionContext: StandaloneExtensionContext = {
		extension: extension,
		extensionMode: EXTENSION_MODE,

		// Set up KV stores.
		globalState: new MementoStore(path.join(DATA_DIR, "globalState.json")),
		secrets: new SecretStore(path.join(DATA_DIR, "secrets.json")),

		// Set up URIs.
		storageUri: URI.file(WORKSPACE_STORAGE_DIR),
		storagePath: WORKSPACE_STORAGE_DIR, // Deprecated, not used in dirac.
		globalStorageUri: URI.file(DATA_DIR),
		globalStoragePath: DATA_DIR, // Deprecated, not used in dirac.

		// Logs are global per extension, not per workspace.
		logUri: URI.file(DATA_DIR),
		logPath: DATA_DIR, // Deprecated, not used in dirac.

		extensionUri: URI.file(EXTENSION_DIR),
		extensionPath: EXTENSION_DIR, // Deprecated, not used in dirac.
		asAbsolutePath: (relPath: string) => path.join(EXTENSION_DIR, relPath),

		subscriptions: [], // These need to be destroyed when the extension is deactivated.

		environmentVariableCollection: new EnvironmentVariableCollection(),

		languageModelAccessInformation: {
			onDidChange: () => ({ dispose: () => {} }),
			canSendRequest: () => undefined,
		},
		// Workspace state is per project/workspace when WORKSPACE_STORAGE_DIR is provided by the host.
		workspaceState: new MementoStore(path.join(WORKSPACE_STORAGE_DIR, "workspaceState.json")),
	}

	log("Finished loading vscode context...")

	return {
		extensionContext,
		DATA_DIR,
		EXTENSION_DIR,
	}
}
```


## Source Files:

- `src/standalone/dirac-core.ts`
- `src/standalone/hostbridge-client.ts`
- `src/standalone/lock-manager.ts`
- `src/standalone/protobus-service.ts`
- `src/standalone/utils.ts`
- `src/standalone/vscode-context-utils.ts`
- `src/standalone/vscode-context.ts`

