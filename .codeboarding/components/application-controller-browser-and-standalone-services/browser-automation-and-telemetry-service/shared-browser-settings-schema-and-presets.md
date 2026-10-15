---
component_id: 5.1.4
component_name: Shared Browser Settings Schema & Presets
---

# Shared Browser Settings Schema & Presets

## Component Description

Defines shared TypeScript interfaces, default configuration values, and viewport presets for browser automation settings.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/BrowserSettings.ts (lines 1-14)
```
export interface BrowserSettings {
	// Viewport size settings
	viewport: {
		width: number
		height: number
	}
	// Chrome installation to use
	// chromeType: "chromium" | "system"
	remoteBrowserHost?: string
	remoteBrowserEnabled?: boolean
	chromeExecutablePath?: string
	disableToolUse?: boolean
	customArgs?: string
}
```


## Source Files:

- `src/shared/BrowserSettings.ts`

