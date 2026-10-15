---
component_id: 9.2.2
component_name: State & Provider Key Definitions
---

# State & Provider Key Definitions

## Component Description

Defines global state, user settings, secret schemas, and provider-specific model and API key mappings.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/storage/provider-keys.ts (lines 131-141)
```
export function getProviderModelIdKey(provider: ApiProvider, mode: "act" | "plan"): SettingsKey {
	const keySuffix = ProviderKeyMap[provider]
	if (keySuffix) {
		// E.g. actModeOpenAiModelId, planModeOpenAiModelId, etc.
		return `${mode}Mode${keySuffix}` as SettingsKey
	}

	// For providers without a specific key (anthropic, gemini, bedrock, etc.),
	// they use the generic actModeApiModelId/planModeApiModelId
	return `${mode}ModeApiModelId`
}
```


## Source Files:

- `src/shared/storage/provider-keys.ts`
- `src/shared/storage/state-keys.ts`

