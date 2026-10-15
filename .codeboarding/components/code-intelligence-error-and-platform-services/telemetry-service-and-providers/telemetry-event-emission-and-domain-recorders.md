---
component_id: 7.1.1
component_name: Telemetry Event Emission & Domain Recorders
---

# Telemetry Event Emission & Domain Recorders

## Component Description

Captures domain telemetry events (hooks, mentions, terminal), manages telemetry context, and dispatches events and metrics to configured providers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/telemetry/TelemetryEventEmitter.ts (lines 10-85)
```
export class TelemetryEventEmitter {
	constructor(
		private providerManager: TelemetryProviderManager,
		private contextManager: TelemetryContextManager,
	) {}

	/** Captures a telemetry event if telemetry is enabled, merging standard attributes. */
	capture(event: { event: string; properties?: TelemetryProperties }): void {
		const propertiesWithMetadata = this.contextManager.getStandardAttributes(event.properties)
		this.captureToProviders(event.event, propertiesWithMetadata, false)
	}

	/** Captures a required telemetry event that bypasses user opt-out settings. */
	captureRequired(event: string, properties?: TelemetryProperties): void {
		const propertiesWithMetadata = this.contextManager.getStandardAttributes(properties)
		this.captureToProviders(event, propertiesWithMetadata, true)
	}

	/** Dispatches an event to all providers with error isolation. */
	private captureToProviders(event: string, properties: TelemetryProperties, required: boolean): void {
		this.providerManager.getProviderList().forEach((provider) => {
			try {
				if (required) {
					provider.logRequired(event, properties)
				} else {
					provider.log(event, properties)
				}
			} catch (error) {
				Logger.error(`[TelemetryService] Provider failed for event ${event}:`, error)
			}
		})
	}

	recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required = false): void {
		const attrs = this.contextManager.getStandardAttributes(attributes)
		this.providerManager.getProviderList().forEach((provider) => {
			try {
				provider.recordCounter(name, value, attrs, description, required)
			} catch (error) {
				Logger.error(`[TelemetryService] recordCounter failed: ${name}`, error)
			}
		})
	}

	recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required = false): void {
		const attrs = this.contextManager.getStandardAttributes(attributes)
		this.providerManager.getProviderList().forEach((provider) => {
			try {
				provider.recordHistogram(name, value, attrs, description, required)
			} catch (error) {
				Logger.error(`[TelemetryService] recordHistogram failed: ${name}`, error)
			}
		})
	}

	/**
	 * Gauge values require explicit cleanup: callers must pass null with the same attribute set
	 * when the series identified by name+attributes ends to prevent stale metric entries.
	 */
	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		const attrs = this.contextManager.getStandardAttributes(attributes)
		this.providerManager.getProviderList().forEach((provider) => {
			try {
				provider.recordGauge(name, value, attrs, description, required)
			} catch (error) {
				Logger.error(`[TelemetryService] recordGauge failed: ${name}`, error)
			}
		})
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/HookTelemetry.ts (lines 26-113)
```
export class HookTelemetry {
	private static readonly EVENTS = TELEMETRY_EVENTS
	private static readonly METRICS = TELEMETRY_METRICS

	constructor(
		private readonly emitter: TelemetryEventEmitter,
		private readonly categoryGate: TelemetryCategoryGate,
	) {}

	captureHookCacheAccess(hookName: string, cacheHit: boolean): void {
		if (!this.categoryGate.isEnabled("hooks")) {
			return
		}
		this.emitter.recordCounter(HookTelemetry.METRICS.HOOKS.CACHE_ACCESSES_TOTAL, 1, {
			hookName,
			cacheHit: cacheHit.toString(),
		})
	}

	captureHookExecution(ulid: string, hookName: string, status: HookExecutionStatus, metadata?: HookExecutionMetadata): void {
		if (!this.categoryGate.isEnabled("hooks")) {
			return
		}
		const properties: TelemetryProperties = {
			ulid,
			hookName,
			status,
			timestamp: new Date().toISOString(),
			...(metadata?.source && { source: metadata.source }),
			...(metadata?.toolName && { toolName: metadata.toolName }),
			...(metadata?.durationMs !== undefined && { durationMs: metadata.durationMs }),
			...(metadata?.exitCode !== undefined && { exitCode: metadata.exitCode }),
			...(metadata?.errorType && { errorType: metadata.errorType }),
			...(metadata?.errorMessage && { errorMessage: metadata.errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH) }),
			...(metadata?.cancelRequested !== undefined && { cancelRequested: metadata.cancelRequested }),
			...(metadata?.contextModified !== undefined && { contextModified: metadata.contextModified }),
			...(metadata?.contextSize !== undefined && { contextSize: metadata.contextSize }),
		}
		this.emitter.capture({ event: "hooks.execution", properties })
		const hookAttributes = {
			ulid,
			hookName,
			status,
			...(metadata?.source && { source: metadata.source }),
			...(metadata?.toolName && { toolName: metadata.toolName }),
		}
		if (status === "started") {
			this.emitter.recordCounter(HookTelemetry.METRICS.HOOKS.EXECUTIONS_TOTAL, 1, hookAttributes)
		} else if (status === "completed") {
			if (metadata?.durationMs !== undefined) {
				this.emitter.recordHistogram(
					HookTelemetry.METRICS.HOOKS.DURATION_SECONDS,
					metadata.durationMs / 1000,
					hookAttributes,
				)
			}
			if (metadata?.cancelRequested) {
				this.emitter.recordCounter(HookTelemetry.METRICS.HOOKS.CANCELLATIONS_TOTAL, 1, hookAttributes)
			}
			if (metadata?.contextModified) {
				this.emitter.recordCounter(HookTelemetry.METRICS.HOOKS.CONTEXT_MODIFICATIONS_TOTAL, 1, hookAttributes)
			}
		} else if (status === "failed") {
			this.emitter.recordCounter(HookTelemetry.METRICS.HOOKS.FAILURES_TOTAL, 1, {
				...hookAttributes,
				errorType: metadata?.errorType || "unknown",
			})
		} else if (status === "cancelled") {
			this.emitter.recordCounter(HookTelemetry.METRICS.HOOKS.CANCELLATIONS_TOTAL, 1, hookAttributes)
		}
	}

	captureHookDiscovery(hookName: string, globalCount: number, workspaceCount: number): void {
		if (!this.categoryGate.isEnabled("hooks")) {
			return
		}
		this.emitter.capture({
			event: HookTelemetry.EVENTS.HOOKS.DISCOVERY_COMPLETED,
			properties: {
				hookName,
				globalCount,
				workspaceCount,
				totalCount: globalCount + workspaceCount,
				timestamp: new Date().toISOString(),
			},
		})
	}
}
```


## Source Files:

- `src/services/telemetry/HookTelemetry.ts`
- `src/services/telemetry/MentionTelemetry.ts`
- `src/services/telemetry/TelemetryContextManager.ts`
- `src/services/telemetry/TelemetryEventEmitter.ts`
- `src/services/telemetry/TelemetryTypes.ts`
- `src/services/telemetry/TerminalTelemetry.ts`

