---
component_id: 11.3
component_name: Standalone & HostBridge Test Servers
---

# Standalone & HostBridge Test Servers

## Component Description

Runs mock HostBridge gRPC servers, standalone core API test servers, and testing platform orchestration.

---

## Key References:

### /Users/highlands/pools/Development/dirac/scripts/test-hostbridge-server.ts (lines 13-48)
```
export async function startTestHostBridgeServer() {
	const server = new grpc.Server()

	// Set up health check
	const healthImpl = new health.HealthImplementation({ "": "SERVING" })
	healthImpl.addToServer(server)

	// Add host bridge services using the mock implementations
	server.addService(WorkspaceServiceService, createMockService<WorkspaceServiceServer>("WorkspaceService"))
	server.addService(WindowServiceService, createMockService<WindowServiceServer>("WindowService"))
	server.addService(EnvServiceService, createMockService<EnvServiceServer>("EnvService"))
	server.addService(DiffServiceService, createMockService<DiffServiceServer>("DiffService"))
	server.addService(TestingServiceService, createMockService<TestingServiceServer>("TestingService"))

	// Load package definition for reflection service
	const packageDefinition = await getPackageDefinition()
	// Filter service names to only include host services
	const hostBridgeServiceNames = Object.keys(packageDefinition).filter(
		(name) => name.startsWith("host.") || name.startsWith("grpc.health"),
	)
	const reflection = new ReflectionService(packageDefinition, {
		services: hostBridgeServiceNames,
	})
	reflection.addToServer(server)

	const bindAddress = process.env.HOST_BRIDGE_ADDRESS || `127.0.0.1:26041`

	server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (err) => {
		if (err) {
			console.error(`Failed to bind test host bridge server to ${bindAddress}:`, err)
			process.exit(1)
		}
		server.start()
		console.log(`Test HostBridge gRPC server listening on ${bindAddress}`)
	})
}
```


## Source Files:

- `scripts/test-hostbridge-server.ts`
- `scripts/test-standalone-core-api-server.ts`
- `scripts/testing-platform-orchestrator.ts`

