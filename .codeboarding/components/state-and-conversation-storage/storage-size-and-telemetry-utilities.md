---
component_id: 9.3
component_name: Storage Size & Telemetry Utilities
---

# Storage Size & Telemetry Utilities

## Component Description

Calculates disk usage across task and checkpoint directories and records extension storage error and user lifecycle telemetry events.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/utils/storage.ts (lines 10-22)
```
export async function getTotalTasksSize(): Promise<number | null> {
	const tasksDir = path.resolve(HostProvider.get().globalStorageFsPath, "tasks")
	const checkpointsDir = path.resolve(HostProvider.get().globalStorageFsPath, "checkpoints")

	try {
		const tasksSize = await getFolderSize.loose(tasksDir)
		const checkpointsSize = await getFolderSize.loose(checkpointsDir)
		return tasksSize + checkpointsSize
	} catch (error) {
		Logger.error("Failed to calculate total task size:", error)
		return null
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/UserTelemetry.ts (lines 12-78)
```
export class UserTelemetry {
	private static readonly EVENTS = TELEMETRY_EVENTS.USER

	constructor(
		private readonly emitter: TelemetryEventEmitter,
		private readonly contextManager: TelemetryContextManager,
		private readonly providerManager: TelemetryProviderManager,
	) {}

	captureUserOptOut(): void {
		this.emitter.captureRequired(UserTelemetry.EVENTS.OPT_OUT, {})
	}

	captureUserOptIn(): void {
		this.emitter.capture({ event: UserTelemetry.EVENTS.OPT_IN })
	}

	captureExtensionActivated(): void {
		this.emitter.capture({ event: UserTelemetry.EVENTS.EXTENSION_ACTIVATED })
	}

	captureExtensionStorageError(errorMessage: string, eventName: string): void {
		this.emitter.capture({
			event: UserTelemetry.EVENTS.EXTENSION_STORAGE_ERROR,
			properties: {
				error:
					errorMessage.length > MAX_ERROR_MESSAGE_LENGTH
						? errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH) + "..."
						: errorMessage,
				eventName,
			},
		})
	}

	captureAuthStarted(provider?: string): void {
		this.emitter.capture({ event: UserTelemetry.EVENTS.AUTH_STARTED, properties: { provider } })
	}

	captureAuthSucceeded(provider?: string): void {
		this.emitter.capture({ event: UserTelemetry.EVENTS.AUTH_SUCCEEDED, properties: { provider } })
	}

	captureAuthFailed(provider?: string): void {
		this.emitter.capture({ event: UserTelemetry.EVENTS.AUTH_FAILED, properties: { provider } })
	}

	captureAuthLoggedOut(provider?: string, reason?: string): void {
		this.emitter.capture({ event: UserTelemetry.EVENTS.AUTH_LOGGED_OUT, properties: { provider, reason } })
	}

	captureOnboardingProgress(args: { step: number; action?: string; model?: string; completed?: boolean }): void {
		this.emitter.capture({ event: UserTelemetry.EVENTS.ONBOARDING_PROGRESS, properties: { ...args } })
	}

	identifyAccount(userInfo: any): void {
		if (!userInfo || !userInfo.id) {
			return
		}
		this.contextManager.setUserInfo({
			id: userInfo.id,
			organizationId: userInfo.organizationId,
			organizationName: userInfo.organizationName,
			memberId: userInfo.memberId,
		})
		this.providerManager.identifyUser(userInfo, this.contextManager.getStandardAttributes())
	}
}
```


## Source Files:

- `src/services/telemetry/UserTelemetry.ts`
- `src/utils/storage.ts`

