---
component_id: 7.1.5
component_name: Category Gating & Subagent Telemetry
---

# Category Gating & Subagent Telemetry

## Component Description

Enforces category-level telemetry opt-in gates and records subagent execution and toggle telemetry events.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/telemetry/TelemetryCategoryGate.ts (lines 7-24)
```
export class TelemetryCategoryGate {
	private readonly enabled: Map<TelemetryCategory, boolean> = new Map([
		["checkpoints", true],
		["browser", true],
		["subagents", true],
		["skills", true],
		["hooks", true],
	])

	/** Returns true unless the category was explicitly disabled. */
	isEnabled(category: TelemetryCategory): boolean {
		return this.enabled.get(category) ?? true
	}

	setEnabled(category: TelemetryCategory, enabled: boolean): void {
		this.enabled.set(category, enabled)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/SubagentTelemetry.ts (lines 9-36)
```
export class SubagentTelemetry {
	private static readonly EVENTS = TELEMETRY_EVENTS.TASK

	constructor(
		private readonly emitter: TelemetryEventEmitter,
		private readonly categoryGate: TelemetryCategoryGate,
	) {}

	captureSubagentToggle(enabled: boolean): void {
		if (!this.categoryGate.isEnabled("subagents")) {
			return
		}
		this.emitter.capture({
			event: enabled ? SubagentTelemetry.EVENTS.SUBAGENT_ENABLED : SubagentTelemetry.EVENTS.SUBAGENT_DISABLED,
			properties: { enabled, timestamp: new Date().toISOString() },
		})
	}

	captureSubagentExecution(ulid: string, durationMs: number, outputLines: number, success: boolean): void {
		if (!this.categoryGate.isEnabled("subagents")) {
			return
		}
		this.emitter.capture({
			event: success ? SubagentTelemetry.EVENTS.SUBAGENT_COMPLETED : SubagentTelemetry.EVENTS.SUBAGENT_STARTED,
			properties: { ulid, durationMs, outputLines, success, timestamp: new Date().toISOString() },
		})
	}
}
```


## Source Files:

- `src/services/telemetry/SubagentTelemetry.ts`
- `src/services/telemetry/TelemetryCategoryGate.ts`

