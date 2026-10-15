---
component_id: 7.4
component_name: Environment, Identity & URI Utilities
---

# Environment, Identity & URI Utilities

## Component Description

Provides shared platform utilities for distinct client identification, Dirac request headers, and shared URI handling.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/EnvUtils.ts (lines 24-42)
```
export async function buildBasicDiracHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = buildExternalBasicHeaders()
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[DiracHeaders.PLATFORM] = host.platform || "unknown"
		headers[DiracHeaders.PLATFORM_VERSION] = host.version || "unknown"
		headers[DiracHeaders.CLIENT_TYPE] = host.diracType || "unknown"
		headers[DiracHeaders.CLIENT_VERSION] = host.diracVersion || "unknown"
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[DiracHeaders.PLATFORM] = "unknown"
		headers[DiracHeaders.PLATFORM_VERSION] = "unknown"
		headers[DiracHeaders.CLIENT_TYPE] = "unknown"
		headers[DiracHeaders.CLIENT_VERSION] = "unknown"
	}
	headers[DiracHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}
```

### /Users/highlands/pools/Development/dirac/src/services/logging/distinctId.ts (lines 73-78)
```
export function getDistinctId() {
	if (!_distinctId) {
		Logger.debug("[DistinctId] Not initialized. Call initializeDistinctId() first.")
	}
	return _distinctId
}
```


## Source Files:

- `src/services/EnvUtils.ts`
- `src/services/logging/distinctId.ts`
- `src/services/temp/DiracTempManager.ts`
- `src/services/uri/SharedUriHandler.ts`

