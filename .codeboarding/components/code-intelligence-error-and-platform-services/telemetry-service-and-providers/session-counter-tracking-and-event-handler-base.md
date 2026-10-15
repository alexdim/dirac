---
component_id: 7.1.4
component_name: Session Counter Tracking & Event Handler Base
---

# Session Counter Tracking & Event Handler Base

## Component Description

Tracks per-task session aggregate counters and provides base abstractions, registries, and barrel exports for telemetry event handling.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/telemetry/TelemetrySessionTracker.ts (lines 5-34)
```
export class TelemetrySessionTracker {
	private taskTurnCounts = new Map<string, number>()
	private taskToolCallCounts = new Map<string, number>()
	private taskErrorCounts = new Map<string, number>()

	incrementTurnCount(ulid: string): number {
		return this.increment(this.taskTurnCounts, ulid)
	}

	incrementToolCallCount(ulid: string): number {
		return this.increment(this.taskToolCallCounts, ulid)
	}

	incrementErrorCount(ulid: string): number {
		return this.increment(this.taskErrorCounts, ulid)
	}

	/** Clears all aggregate counters for a task — called on task start, restart, completion, or feedback. */
	resetAggregates(ulid: string): void {
		this.taskTurnCounts.delete(ulid)
		this.taskToolCallCounts.delete(ulid)
		this.taskErrorCounts.delete(ulid)
	}

	private increment(store: Map<string, number>, ulid: string): number {
		const nextValue = (store.get(ulid) ?? 0) + 1
		store.set(ulid, nextValue)
		return nextValue
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/events/EventHandlerBase.ts (lines 8-45)
```
export abstract class EventHandlerBase {
	/** Event prefix for this handler (e.g., "task", "ui", "hooks") */
	static readonly prefix: string

	/**
	 * Capture a regular telemetry event
	 * @param service The telemetry service instance
	 * @param event The full event name (e.g., "task.created")
	 * @param properties Event properties
	 * @param required Whether this is a required event that bypasses user preferences
	 */
	protected static capture(service: TelemetryService, event: string, properties?: TelemetryObject, required = false): void {
		if (required) {
			service.captureRequired(event, properties)
		} else {
			service.capture({ event, properties })
		}
	}

	/**
	 * Capture a required event that bypasses telemetry opt-out settings
	 * @param service The telemetry service instance
	 * @param event The full event name
	 * @param properties Event properties
	 */
	protected static captureRequired(service: TelemetryService, event: string, properties?: TelemetryObject): void {
		service.captureRequired(event, properties)
	}

	/**
	 * Check if telemetry is enabled for regular events
	 * @param service The telemetry service instance
	 * @returns Whether telemetry is enabled
	 */
	protected static isEnabled(service: TelemetryService): boolean {
		return service.isEnabled()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/events/EventHandlerBase.ts (lines 50-91)
```
export class EventHandlerRegistry {
	private static handlers: Map<string, typeof EventHandlerBase> = new Map()
	private static registered = false

	/**
	 * Register an event handler for a specific prefix
	 * @param prefix The event prefix (e.g., "task", "ui")
	 * @param handlerClass The handler class
	 */
	static register(prefix: string, handlerClass: typeof EventHandlerBase): void {
		EventHandlerRegistry.handlers.set(prefix, handlerClass)
	}

	/**
	 * Get a registered event handler by prefix
	 * @param prefix The event prefix
	 * @returns The handler class or undefined
	 */
	static getHandler(prefix: string): typeof EventHandlerBase | undefined {
		return EventHandlerRegistry.handlers.get(prefix)
	}

	/**
	 * Auto-register all event handlers
	 * This is called once during TelemetryService initialization
	 */
	static registerAll(): void {
		if (EventHandlerRegistry.registered) return

		// Import and register all handlers
		// This will be populated as we create the specific handlers
		EventHandlerRegistry.registered = true
	}

	/**
	 * Get all registered prefixes
	 * @returns Array of registered event prefixes
	 */
	static getRegisteredPrefixes(): string[] {
		return Array.from(EventHandlerRegistry.handlers.keys())
	}
}
```


## Source Files:

- `src/services/telemetry/TelemetrySessionTracker.ts`
- `src/services/telemetry/events/EventHandlerBase.ts`
- `src/services/telemetry/index.ts`

