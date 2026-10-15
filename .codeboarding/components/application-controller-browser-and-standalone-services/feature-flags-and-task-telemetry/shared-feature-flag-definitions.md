---
component_id: 5.3.2
component_name: Shared Feature Flag Definitions
---

# Shared Feature Flag Definitions

## Component Description

Defines shared feature flag identifiers, default fallback payloads, and user-versus-flag feature setting structures.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/services/feature-flags/feature-flags.ts (lines 4-18)
```
export enum FeatureFlag {
	WEBTOOLS = "webtools",
	WORKTREES = "worktree-exp",
	// Feature flag for showing the new onboarding flow or old welcome view.
	ONBOARDING_MODELS = "onboarding_models",
	// Feature flag for remote banner service
	REMOTE_BANNERS = "remote-banners",
	// Feature flag payload (milliseconds) controlling remote banner cache TTL
	EXTENSION_REMOTE_BANNERS_TTL = "extension_remote_banners_ttl",
	// Feature flag for DB-backed welcome banners (What's New modal)
	// When off, hardcoded welcome items are shown instead
	REMOTE_WELCOME_BANNERS = "remote-welcome-banners",
	// Use the websocket mode for OpenAI native Responses API format
	OPENAI_RESPONSES_WEBSOCKET_MODE = "openai-responses-websocket-mode",
}
```

### /Users/highlands/pools/Development/dirac/src/shared/DiracFeatureSetting.ts (lines 1-6)
```
export interface DiracFeatureSetting {
	// Setting is enabled or disabled by user
	user: boolean
	// Setting is enabled or disabled by feature flag
	featureFlag: boolean
}
```


## Source Files:

- `src/shared/DiracFeatureSetting.ts`
- `src/shared/services/feature-flags/feature-flags.ts`

