import { jsonHeaders } from "@shared/net"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { getErrorLevelFromString } from "@/services/error"
import { getDistinctId } from "@/services/logging/distinctId"
import { fetch } from "@/shared/net"
import { Setting } from "@/shared/proto/index.host"
import { diracTelemetryConfig } from "@/shared/services/config/dirac-telemetry-config"
import { Logger } from "@/shared/services/Logger"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "./ITelemetryProvider"

const TELEMETRY_SECRET_PATTERNS = [
	/(Bearer\s+)[^\s"']+/gi,
	/\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style keys (sk-..., sk-ant-...)
	/\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub PATs
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
	/\bAKIA[0-9A-Z]{16}\b/g, // AWS access key IDs
	/(?:api[_-]?key|token|secret|password)\s*[=:]\s*["']?[^\s"']+/gi, // key=value pairs
]
const MAX_TELEMETRY_STRING_LENGTH = 2000

function scrubTelemetryProperties(value: unknown): unknown {
	if (typeof value === "string") {
		let result = TELEMETRY_SECRET_PATTERNS.reduce((redacted, pattern) => redacted.replace(pattern, "$1[REDACTED]"), value)
		if (result.length > MAX_TELEMETRY_STRING_LENGTH) {
			result = result.slice(0, MAX_TELEMETRY_STRING_LENGTH) + "…[truncated]"
		}
		return result
	}
	if (Array.isArray(value)) return value.map(scrubTelemetryProperties)
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubTelemetryProperties(v)]))
	}
	return value
}

/**
 * Dirac implementation of the telemetry provider interface
 * Handles Dirac-specific analytics tracking
 */
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
