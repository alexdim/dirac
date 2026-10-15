---
component_id: 5.3.3
component_name: Baseten Model Catalog Refresh
---

# Baseten Model Catalog Refresh

## Component Description

Fetches, validates, and caches Baseten chat model metadata and pricing with static model fallbacks.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/models/refreshBasetenModels.ts (lines 14-27)
```
export async function refreshBasetenModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const apiKey = controller.stateManager.getSecretKey("basetenApiKey")?.trim()
	return fetchAndCacheModels({
		provider: "baseten",
		cacheFileName: GlobalFileNames.basetenModels,
		fetchUrl: "https://inference.baseten.co/v1/models",
		headers: { Authorization: `Bearer ${apiKey}`, ...jsonHeaders(), "User-Agent": "Dirac-VSCode-Extension" },
		requiresAuth: true,
		apiKey,
		providerLabel: "Baseten",
		parseResponse: parseBasetenResponse,
		staticModels: getBasetenStaticModels,
	})
}
```


## Source Files:

- `src/core/controller/models/refreshBasetenModels.ts`

