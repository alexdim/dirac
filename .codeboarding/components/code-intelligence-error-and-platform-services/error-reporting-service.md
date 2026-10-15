---
component_id: 7.2
component_name: Error Reporting Service
---

# Error Reporting Service

## Component Description

Manages application error representations, severity level parsing, and error reporting through Dirac error providers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/error/index.ts (lines 9-20)
```
export function getErrorLevelFromString(level: string | undefined): ErrorSettings["level"] {
	switch (level) {
		case "disabled":
		case "off":
			return "off"
		case "error":
		case "crash":
			return "error"
		default:
			return "all"
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/error/providers/DiracErrorProvider.ts (lines 127-151)
```
	private async sendToDirac(event: string, properties: Record<string, unknown>) {
		if (!diracTelemetryConfig.apiKey) {
			return
		}

		try {
			await fetch(diracTelemetryConfig.host, {
				method: "POST",
				headers: {
					...jsonHeaders(),
					"X-Dirac-API-Key": diracTelemetryConfig.apiKey,
				},
				body: JSON.stringify({
					distinctId: getDistinctId(),
					event,
					properties: {
						...properties,
						timestamp: new Date().toISOString(),
					},
				}),
			})
		} catch (error) {
			Logger.error(`Failed to send error telemetry to Dirac: ${event}`, error)
		}
	}
```


## Source Files:

- `src/services/error/DiracError.ts`
- `src/services/error/ErrorProviderFactory.ts`
- `src/services/error/ErrorService.ts`
- `src/services/error/index.ts`
- `src/services/error/providers/DiracErrorProvider.ts`
- `src/services/error/providers/IErrorProvider.ts`

