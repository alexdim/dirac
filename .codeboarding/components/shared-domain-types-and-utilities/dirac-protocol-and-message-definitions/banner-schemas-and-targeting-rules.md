---
component_id: 3.2.3
component_name: Banner Schemas & Targeting Rules
---

# Banner Schemas & Targeting Rules

## Component Description

Defines promotional and informational banner data structures, audience targeting rules, dismissal telemetry payloads, and default banner configurations.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/DiracBanner.ts (lines 8-21)
```
export interface Banner {
	id: string
	titleMd: string
	bodyMd: string
	icon?: string
	actions?: BannerAction[]

	rulesJson: string
	activeFrom?: string
	activeTo?: string

	severity?: BannerSeverity
	placement?: BannerPlacement
}
```

### /Users/highlands/pools/Development/dirac/src/shared/DiracBanner.ts (lines 45-62)
```
export interface BannerRules {
	/** Target specific IDEs (e.g., "vscode", "jetbrains") */
	ide?: string[]
	/** Target specific auth providers (e.g., "firebase", "workos") */
	auth?: string[]
	/** Target employees only */
	employee_only?: boolean
	/** Target users with specific API providers (e.g., "anthropic", "openai") */
	providers?: string[]
	/** Target specific audience segment */
	audience?: BannerAudience[]
	/**  Target team vs enterprise organizations */
	org_type?: "all" | "team_only" | "enterprise_only" | ""
	/** Minimum extension version required (e.g., "3.39.2") */
	min_extension_version?: string
	/** Optional actions embedded in rules JSON for banners */
	actions?: BannerAction[]
}
```

### /Users/highlands/pools/Development/dirac/src/shared/dirac/banner.ts (lines 24-55)
```
export interface BannerCardData {
	/** Unique identifier for the banner (used for dismissal tracking) */
	id: string

	/** Banner title text */
	title: string

	/** Banner description/body markdown text */
	description: string

	/**
	 * Icon ID from Lucide icon set (e.g., "lightbulb", "megaphone", "terminal")
	 * LINK: https://lucide.dev/icons/
	 * Optional - if omitted, no icon is shown
	 */
	icon?: string

	/**
	 * Optional footer action buttons
	 * Rendered below the description as prominent buttons
	 */
	actions?: BannerAction[]

	/**
	 * Platform filter - only show on specified platforms
	 * If undefined, show on all platforms
	 */
	platforms?: ("windows" | "mac" | "linux")[]

	/** Only show to Dirac users */
	isDiracUserOnly?: boolean
}
```

### /Users/highlands/pools/Development/dirac/src/shared/dirac/banner.ts (lines 5-18)
```
export enum BannerActionType {
	/** Open external URL */
	Link = "link",
	/** Open API settings tab */
	ShowApiSettings = "show-api-settings",
	/** Open feature settings tab */
	ShowFeatureSettings = "show-feature-settings",
	/** Open account/login view */
	ShowAccount = "show-account",
	/** Set the active model */
	SetModel = "set-model",
	/** Trigger CLI installation flow */
	InstallCli = "install-cli",
}
```


## Source Files:

- `src/shared/DiracBanner.ts`
- `src/shared/dirac/banner.ts`

