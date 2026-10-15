---
component_id: 2.1.3
component_name: Terminal Theme & Branding Constants
---

# Terminal Theme & Branding Constants

## Component Description

Defines shared color palettes, ASCII logo assets, and theme constants for terminal UI rendering.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/constants/colors.ts (lines 8-24)
```
export const COLORS = {
	get primaryBlue() { return theme.primary },
	get planYellow() { return theme.plan },
	get text() { return theme.text },
	get strongText() { return theme.strongText },
	get muted() { return theme.muted },
	get subtle() { return theme.subtle },
	get success() { return theme.success },
	get error() { return theme.error },
	get warning() { return theme.warning },
	get info() { return theme.info },
	get link() { return theme.link },
	get magenta() { return theme.magenta },
	get highlightBg() { return theme.highlightBg },
	get highlightText() { return theme.highlightText },
	get buttonText() { return theme.buttonText },
} as const
```

### /Users/highlands/pools/Development/dirac/cli/src/constants/colors.ts (lines 9-9)
```
	get primaryBlue() { return theme.primary },
```


## Source Files:

- `cli/src/constants/colors.ts`
- `cli/src/constants/logo.ts`
- `cli/src/constants/theme.ts`

