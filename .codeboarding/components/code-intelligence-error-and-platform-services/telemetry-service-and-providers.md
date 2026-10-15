---
component_id: 7.1
component_name: Telemetry Service & Providers
---

# Telemetry Service & Providers

## Component Description

Captures and routes domain telemetry events, session metrics, and traces through Dirac and OpenTelemetry telemetry providers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/telemetry/providers/DiracTelemetryProvider.ts (lines 163-186)
```
	private async captureToDirac(event: string, properties?: TelemetryProperties) {
		if (!diracTelemetryConfig.apiKey) {
			return
		}

		try {
			const scrubbed = properties ? (scrubTelemetryProperties(properties) as TelemetryProperties) : undefined
			await fetch(diracTelemetryConfig.host, {
				method: "POST",
				headers: {
					...jsonHeaders(),
					"X-Dirac-API-Key": diracTelemetryConfig.apiKey,
				},
				body: JSON.stringify({
					distinctId: getDistinctId(),
					event,
					properties: scrubbed,
					timestamp: new Date().toISOString(),
				}),
			})
		} catch (error) {
			Logger.error(`Failed to send telemetry to Dirac: ${event}`, error)
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/providers/DiracTelemetryProvider.ts (lines 269-278)
```
	private async getTelemetryLevel(): Promise<TelemetrySettings["level"]> {
		if (typeof HostProvider.env.getTelemetrySettings !== "function") {
			return "all"
		}
		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			return "off"
		}
		return getErrorLevelFromString(hostSettings.errorLevel)
	}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts (lines 96-120)
```
	public log(event: string, properties?: TelemetryProperties): void {
		if (!this.isEnabled() || this.telemetrySettings.level === "off") {
			return
		}

		// Filter events based on telemetry level
		if (this.telemetrySettings.level === "error") {
			if (!event.includes("error")) {
				return
			}
		}

		// Record log event (primary path)
		if (this.logger) {
			this.logger.emit({
				severityText: "INFO",
				body: event,
				attributes: {
					distinct_id: getDistinctId(),
					...this.flattenProperties(properties),
					...this.userAttributes,
				},
			})
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts (lines 122-136)
```
	public logRequired(event: string, properties?: TelemetryProperties): void {
		// Required events always go through regardless of settings
		if (this.logger) {
			this.logger.emit({
				severityText: "INFO",
				body: event,
				attributes: {
					distinct_id: getDistinctId(),
					_required: true,
					...this.flattenProperties(properties),
					...this.userAttributes,
				},
			})
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts (lines 288-298)
```
	private async getTelemetryLevel(): Promise<TelemetrySettings["level"]> {
		if (this.bypassUserSettings) {
			return "all"
		}

		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			return "off"
		}
		return getErrorLevelFromString(hostSettings.errorLevel)
	}
```


## Source Files:

- `src/services/telemetry/HookTelemetry.ts`
- `src/services/telemetry/MentionTelemetry.ts`
- `src/services/telemetry/SubagentTelemetry.ts`
- `src/services/telemetry/TelemetryCategoryGate.ts`
- `src/services/telemetry/TelemetryContextManager.ts`
- `src/services/telemetry/TelemetryEventEmitter.ts`
- `src/services/telemetry/TelemetryProviderFactory.ts`
- `src/services/telemetry/TelemetryProviderManager.ts`
- `src/services/telemetry/TelemetrySessionTracker.ts`
- `src/services/telemetry/TelemetryTypes.ts`
- `src/services/telemetry/TerminalTelemetry.ts`
- `src/services/telemetry/UiTelemetry.ts`
- `src/services/telemetry/events/EventHandlerBase.ts`
- `src/services/telemetry/index.ts`
- `src/services/telemetry/providers/DiracTelemetryProvider.ts`
- `src/services/telemetry/providers/ITelemetryProvider.ts`
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryClientProvider.ts`
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryExporterFactory.ts`
- `src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts`

