---
component_id: 7.1.2
component_name: Telemetry Provider Management & Dirac Backend
---

# Telemetry Provider Management & Dirac Backend

## Component Description

Defines telemetry provider interfaces, manages active provider lifecycles, and implements factory creation and Dirac telemetry logging.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/telemetry/TelemetryProviderManager.ts (lines 8-55)
```
export class TelemetryProviderManager {
	private providers: ITelemetryProvider[]

	constructor(providers: ITelemetryProvider[]) {
		this.providers = providers
	}

	addProvider(provider: ITelemetryProvider): void {
		this.providers.push(provider)
	}

	removeProvider(name: string): void {
		this.providers = this.providers.filter((p) => p.name !== name)
	}

	getProviders(): ITelemetryProvider[] {
		return [...this.providers]
	}

	isEnabled(): boolean {
		return this.providers.some((provider) => provider.isEnabled())
	}

	getSettings(): TelemetrySettings {
		return this.providers.length > 0 ? this.providers[0].getSettings() : { hostEnabled: false, level: "off" as const }
	}

	/** Dispatches user identification to all providers with error isolation. */
	identifyUser(userInfo: any, attributes: TelemetryProperties): void {
		this.providers.forEach((provider) => {
			try {
				provider.identifyUser(userInfo, attributes)
			} catch (error) {
				Logger.error(`[TelemetryService] identifyUser failed for provider ${provider.name}:`, error)
			}
		})
	}

	/** Returns the raw provider array for internal dispatch (event emitter uses this). */
	getProviderList(): ITelemetryProvider[] {
		return this.providers
	}

	async dispose(): Promise<void> {
		const disposePromises = this.providers.map((provider) => provider.dispose())
		await Promise.allSettled(disposePromises)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/TelemetryProviderFactory.ts (lines 38-131)
```
export class TelemetryProviderFactory {
	/**
	 * Creates multiple telemetry providers based on configuration
	 * Supports dual tracking during transition period
	 */
	public static async createProviders(): Promise<ITelemetryProvider[]> {
		const configs = TelemetryProviderFactory.getDefaultConfigs()
		const providers: ITelemetryProvider[] = []

		for (const config of configs) {
			try {
				const provider = await TelemetryProviderFactory.createProvider(config)
				providers.push(provider)
			} catch (error) {
				Logger.error(`Failed to create telemetry provider: ${config.type}`, error)
			}
		}

		// Always have at least a no-op provider
		if (providers.length === 0) {
			providers.push(new NoOpTelemetryProvider())
		}
		return providers
	}

	/**
	 * Creates a single telemetry provider based on the provided configuration
	 * @param config Configuration for the telemetry provider
	 * @returns ITelemetryProvider instance
	 */
	private static async createProvider(config: TelemetryProviderConfig): Promise<ITelemetryProvider> {
		switch (config.type) {
			case "dirac": {
				return await new DiracTelemetryProvider().initialize()
			}
			case "opentelemetry": {
				const otelConfig = config.config
				if (!otelConfig) {
					return new NoOpTelemetryProvider()
				}
				const client = new OpenTelemetryClientProvider(otelConfig)
				if (client.meterProvider || client.loggerProvider) {
					return await new OpenTelemetryTelemetryProvider(client.meterProvider, client.loggerProvider, {
						bypassUserSettings: config.bypassUserSettings,
					}).initialize()
				}
				Logger.info("TelemetryProviderFactory: OpenTelemetry providers not available")
				return new NoOpTelemetryProvider()
			}
			case "no-op":
				return new NoOpTelemetryProvider()
			default:
				Logger.error(`Unsupported telemetry provider type: ${(config as { type?: string }).type ?? "unknown"}`)
				return new NoOpTelemetryProvider()
		}
	}

	/**
	 * Gets the default telemetry provider configuration
	 * @returns Default configuration using available providers
	 */
	public static getDefaultConfigs(): TelemetryProviderConfig[] {
		const configs: TelemetryProviderConfig[] = []

		// Skip Dirac in selfHosted mode - enterprise customers should not send telemetry to Dirac
		if (!DiracEndpoint.isSelfHosted() && isDiracTelemetryConfigValid(diracTelemetryConfig)) {
			configs.push({ type: "dirac", ...diracTelemetryConfig })
		}

		// Skip build-time OTEL in selfHosted mode - enterprise customers should not send telemetry to Dirac's collector
		// Note: Runtime env OTEL and remote config OTEL are still allowed (user/org explicitly configured them)
		const otelConfig = getValidOpenTelemetryConfig()
		if (!DiracEndpoint.isSelfHosted() && otelConfig) {
			configs.push({
				type: "opentelemetry",
				config: otelConfig,
				bypassUserSettings: false,
			})
		}

		const runtimeOtelConfig = getValidRuntimeOpenTelemetryConfig()
		if (runtimeOtelConfig) {
			configs.push({
				type: "opentelemetry",
				config: runtimeOtelConfig,
				// If the user has `DIRAC_OTEL_TELEMETRY_ENABLED` in his environment, enable
				// OTEL regardless of his Dirac telemetry settings
				bypassUserSettings: true,
			})
		}

		return configs.length > 0 ? configs : [{ type: "no-op" }]
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/providers/DiracTelemetryProvider.ts (lines 95-279)
```
export class DiracTelemetryProvider implements ITelemetryProvider {
	private telemetrySettings: TelemetrySettings
	private optInCache: boolean

	readonly name = "DiracTelemetryProvider"

	constructor() {
		// Initialize telemetry settings
		this.optInCache = true
		this.telemetrySettings = {
			hostEnabled: true,
			level: "all",
		}
	}

	public async initialize(): Promise<DiracTelemetryProvider> {
		// Listen for host telemetry changes
		if (typeof HostProvider.env.subscribeToTelemetrySettings === "function") {
			HostProvider.env.subscribeToTelemetrySettings(
				{},
				{
					onResponse: (event: { isEnabled: Setting }) => {
						const hostEnabled = event.isEnabled === Setting.ENABLED || event.isEnabled === Setting.UNSUPPORTED
						this.telemetrySettings.hostEnabled = hostEnabled
					},
				},
			)
		}

		// Check host-specific telemetry setting (e.g. VS Code setting)
		if (typeof HostProvider.env.getTelemetrySettings === "function") {
			const hostSettings = await HostProvider.env.getTelemetrySettings({})
			if (hostSettings.isEnabled === Setting.DISABLED) {
				this.telemetrySettings.hostEnabled = false
			}
		}

		this.telemetrySettings.level = await this.getTelemetryLevel()
		return this
	}

	async forceFlush() {
		// No-op for now as we've removed legacy telemetry
	}

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

		// Log to Dirac telemetry endpoint
		this.captureToDirac(event, properties)
	}

	public logRequired(event: string, properties?: TelemetryProperties): void {
		this.captureToDirac(event, {
			...properties,
			_required: true, // Mark as required event
		})
	}

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

	public identifyUser(userInfo: any, properties: TelemetryProperties = {}) {
		this.captureToDirac("$identify", properties)
	}

	public isEnabled(): boolean {
		if (!StateManager.isInitialized()) {
			return false
		}
		const isOptedIn = StateManager.get().getGlobalSettingsKey("telemetrySetting") !== "disabled"
		this.optInCache = isOptedIn
		return isOptedIn && this.telemetrySettings.hostEnabled
	}

	public getSettings(): TelemetrySettings {
		return { ...this.telemetrySettings }
	}

	/**
	 * Record a counter metric
	 */
	public recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		_description?: string,
		required = false,
	): void {
		if (!this.isEnabled() && !required) return

		this.log(name, {
			...attributes,
			value,
			metric_type: "counter",
		})
	}

	/**
	 * Record a histogram metric
	 */
	public recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		_description?: string,
		required = false,
	): void {
		if (!this.isEnabled() && !required) return

		this.log(name, {
			...attributes,
			value,
			metric_type: "histogram",
		})
	}

	/**
	 * Record a gauge metric
	 */
	public recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		_description?: string,
		required = false,
	): void {
		if ((!this.isEnabled() && !required) || value === null) return

		this.log(name, {
			...attributes,
			value,
			metric_type: "gauge",
		})
	}

	public async dispose(): Promise<void> {
		await this.forceFlush()
	}

	/**
	 * Get the current telemetry level from VS Code settings
	 */
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
}
```


## Source Files:

- `src/services/telemetry/TelemetryProviderFactory.ts`
- `src/services/telemetry/TelemetryProviderManager.ts`
- `src/services/telemetry/providers/DiracTelemetryProvider.ts`
- `src/services/telemetry/providers/ITelemetryProvider.ts`

