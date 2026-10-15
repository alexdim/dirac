---
component_id: 5.3
component_name: Feature Flags & Task Telemetry
---

# Feature Flags & Task Telemetry

## Component Description

Evaluates feature flags across configured providers and records task-level telemetry events.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/feature-flags/FeatureFlagsService.ts (lines 21-155)
```
export class FeatureFlagsService {
	/**
	 * Constructor that accepts an IFeatureFlagsProvider instance
	 * @param provider IFeatureFlagsProvider instance for retrieving feature flags
	 */
	public constructor(private provider: IFeatureFlagsProvider) {}

	private cache: Map<FeatureFlag, FeatureFlagPayload> = new Map()
	/**
	 * Tracks cache update time and user ID for cache validity
	 */
	private cacheInfo: CacheInfo = { updateTime: 0, userId: null }

	/**
	 * Poll all known feature flags to update their cached values
	 */
	public async poll(userId: string | null): Promise<void> {
		// Do not update cache if last update was less than an hour ago
		const timesNow = Date.now()
		if (timesNow - this.cacheInfo.updateTime < DEFAULT_CACHE_TTL && this.cache.size) {
			// Skip fetch if within TTL and user context is unchanged
			if (this.cacheInfo.userId === userId) {
				return
			}
		}

		// Only update timestamp after successfully populating cache
		this.cacheInfo = { updateTime: timesNow, userId: userId || null }

		try {
			const values = await this.provider.getAllFlagsAndPayloads({
				flagKeys: FEATURE_FLAGS,
			})
			this.cacheInfo.flagsPayload = values

			for (const flag of FEATURE_FLAGS) {
				const payload = await this.getFeatureFlag(flag).catch(() => false)
				this.cache.set(flag, payload ?? false)
			}
		} catch (error) {
			// On error, clear cache info to force refresh on next poll
			this.cacheInfo = { updateTime: 0, userId: null }
			throw error
		}
	}

	private async getFeatureFlag(flagName: FeatureFlag): Promise<FeatureFlagPayload | undefined> {
		try {
			const payload = this.cacheInfo.flagsPayload?.featureFlagPayloads?.[flagName]
			const flagValue = this.cacheInfo.flagsPayload?.featureFlags?.[flagName]
			const value = payload ?? flagValue ?? FeatureFlagDefaultValue[flagName] ?? undefined

			if (!this.cache.has(flagName) || this.cache.get(flagName) !== value) {
				telemetryService.capture({
					event: "$feature_flag_called",
					properties: {
						$feature_flag: flagName,
						$feature_flag_response: flagValue,
					},
				})
			}

			return value
		} catch (error) {
			Logger.error(`Error checking if feature flag ${flagName} is enabled:`, error)
			return FeatureFlagDefaultValue[flagName] ?? false
		}
	}

	/**
	 * Wrapper: safely get boolean flag with default fallback
	 * Only check the cached value of a feature flag. If not cached, return defaultValue.
	 * Useful for performance-sensitive paths where we don't want to await a network call.
	 * Cache is updated periodically via poll(), and is generated on extension startup,
	 * and whenever the user logs in.
	 */
	public getBooleanFlagEnabled(flagName: FeatureFlag): boolean {
		return this.cache.get(flagName) === true
	}

	/**
	 * Get a cached flag payload (or default) without triggering a network call.
	 */
	public getFlagPayload(flagName: FeatureFlag): FeatureFlagPayload | undefined {
		return this.cache.get(flagName) ?? FeatureFlagDefaultValue[flagName]
	}

	public getWebtoolsEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.WEBTOOLS)
	}

	public getWorktreesEnabled(): boolean {
		return this.getBooleanFlagEnabled(FeatureFlag.WORKTREES)
	}

	/**
	 * Get the feature flags provider instance
	 * @returns The current feature flags provider
	 */
	public getProvider(): IFeatureFlagsProvider {
		return this.provider
	}

	/**
	 * Check if feature flags are currently enabled
	 * @returns Boolean indicating whether feature flags are enabled
	 */
	public isEnabled(): boolean {
		return this.provider.isEnabled()
	}

	/**
	 * Get current feature flags settings
	 * @returns Current feature flags settings
	 */
	public getSettings() {
		return this.provider.getSettings()
	}

	/**
	 * For testing: directly set a feature flag in the cache
	 */
	public test(flagName: FeatureFlag, value: boolean) {
		if (process.env.NODE_ENV === "true") {
			this.cache.set(flagName, value)
		}
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		await this.provider.dispose()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/feature-flags/FeatureFlagsProviderFactory.ts (lines 23-53)
```
export class FeatureFlagsProviderFactory {
	/**
	 * Creates a feature flags provider based on the provided configuration
	 * @param config Configuration for the feature flags provider
	 * @returns IFeatureFlagsProvider instance
	 */
	public static createProvider(config: FeatureFlagsProviderConfig): IFeatureFlagsProvider {
		switch (config.type) {
			case "dirac": {
				return new DiracFeatureFlagsProvider()
			}
			default:
				return new NoOpFeatureFlagsProvider()
		}
	}

	/**
	 * Gets the default feature flags provider configuration
	 * @returns Default configuration using Dirac, or no-op for self-hosted mode
	 */
	public static getDefaultConfig(): FeatureFlagsProviderConfig {
		// Use no-op provider in self-hosted mode to avoid external network calls
		if (DiracEndpoint.isSelfHosted()) {
			return { type: "no-op" }
		}
		const hasValidConfig = isDiracTelemetryConfigValid(diracTelemetryConfig)
		return {
			type: hasValidConfig ? "dirac" : "no-op",
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/services/telemetry/TaskTelemetry.ts (lines 16-263)
```
export class TaskTelemetry {
	private static readonly EVENTS = TELEMETRY_EVENTS.TASK
	private static readonly METRICS = TELEMETRY_METRICS

	constructor(
		private readonly emitter: TelemetryEventEmitter,
		private readonly sessionTracker: TelemetrySessionTracker,
	) {}

	captureTaskCreated(ulid: string, apiProvider?: string, openAiCompatibleDomain?: string): void {
		this.sessionTracker.resetAggregates(ulid)
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.CREATED,
			properties: { ulid, apiProvider, openAiCompatibleDomain },
		})
	}

	captureTaskRestarted(ulid: string, apiProvider?: string, openAiCompatibleDomain?: string): void {
		this.sessionTracker.resetAggregates(ulid)
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.RESTARTED,
			properties: { ulid, apiProvider, openAiCompatibleDomain },
		})
	}

	captureTaskCompleted(
		ulid: string,
		args?: {
			provider?: string
			modelId?: string
			apiFormat?: ApiFormat
			timeToFirstTokenMs?: number
			durationMs?: number
			mode: Mode
		},
	): void {
		const apiFormatName = args?.apiFormat !== undefined ? apiFormatToJSON(args.apiFormat) : undefined
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.COMPLETED,
			properties: {
				ulid,
				provider: args?.provider,
				modelId: args?.modelId,
				apiFormat: args?.apiFormat,
				apiFormatName,
				timeToFirstTokenMs: args?.timeToFirstTokenMs,
				durationMs: args?.durationMs,
				mode: args?.mode,
			},
		})
		if (Number.isFinite(args?.timeToFirstTokenMs)) {
			this.emitter.recordHistogram(TaskTelemetry.METRICS.API.TTFT_SECONDS, (args?.timeToFirstTokenMs ?? 0) / 1000, {
				ulid,
				provider: args?.provider,
				model: args?.modelId,
				apiFormat: apiFormatName,
				mode: args?.mode,
			})
		}
		if (Number.isFinite(args?.durationMs)) {
			this.emitter.recordHistogram(TaskTelemetry.METRICS.API.DURATION_SECONDS, (args?.durationMs ?? 0) / 1000, {
				ulid,
				provider: args?.provider,
				model: args?.modelId,
				apiFormat: apiFormatName,
				scope: "task",
				mode: args?.mode,
			})
		}
		this.sessionTracker.resetAggregates(ulid)
	}

	captureConversationTurnEvent(
		ulid: string,
		provider = "unknown",
		model = "unknown",
		source: "user" | "assistant",
		mode: Mode,
		tokenUsage: TokenUsage = {},
		isNativeToolCall?: boolean,
	): void {
		if (!ulid || !provider || !model || !source) {
			Logger.warn("TelemetryService: Missing required parameters for message capture")
			return
		}
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.CONVERSATION_TURN,
			properties: {
				ulid,
				provider,
				model,
				source,
				mode,
				timestamp: new Date().toISOString(),
				...tokenUsage,
				isNativeToolCall,
			},
		})
		const turnCount = this.sessionTracker.incrementTurnCount(ulid)
		const turnAttributes = { ulid, provider, model, source, mode }
		this.emitter.recordCounter(TaskTelemetry.METRICS.TASK.TURNS_TOTAL, 1, turnAttributes)
		this.emitter.recordHistogram(TaskTelemetry.METRICS.TASK.TURNS_PER_TASK, turnCount, turnAttributes)
		if (Number.isFinite(tokenUsage.cacheWriteTokens)) {
			const cacheWriteTokens = tokenUsage.cacheWriteTokens ?? 0
			this.emitter.recordCounter(TaskTelemetry.METRICS.CACHE.WRITE_TOTAL, cacheWriteTokens, { ulid, provider, model, mode })
			this.emitter.recordHistogram(TaskTelemetry.METRICS.CACHE.WRITE_PER_EVENT, cacheWriteTokens, {
				ulid,
				provider,
				model,
				mode,
			})
		}
		if (Number.isFinite(tokenUsage.cacheReadTokens)) {
			const cacheReadTokens = tokenUsage.cacheReadTokens ?? 0
			this.emitter.recordCounter(TaskTelemetry.METRICS.CACHE.READ_TOTAL, cacheReadTokens, { ulid, provider, model, mode })
			this.emitter.recordHistogram(TaskTelemetry.METRICS.CACHE.READ_PER_EVENT, cacheReadTokens, {
				ulid,
				provider,
				model,
				mode,
			})
		}
		if (Number.isFinite(tokenUsage.totalCost)) {
			const totalCost = tokenUsage.totalCost ?? 0
			const costAttributes = { ulid, provider, model, mode, currency: "USD" }
			this.emitter.recordCounter(TaskTelemetry.METRICS.TASK.COST_TOTAL, totalCost, costAttributes)
			this.emitter.recordHistogram(TaskTelemetry.METRICS.TASK.COST_PER_EVENT, totalCost, costAttributes)
		}
	}

	captureTokenUsage(
		ulid: string,
		tokensIn: number,
		tokensOut: number,
		provider: string,
		model: string,
		options?: TokenUsage,
	): void {
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.TOKEN_USAGE,
			properties: { ulid, tokensIn, tokensOut, provider, model, ...options },
		})
		const attributes = { ulid, provider, model }
		if (Number.isFinite(tokensIn)) {
			const value = tokensIn ?? 0
			this.emitter.recordCounter(TaskTelemetry.METRICS.TASK.TOKENS_INPUT_TOTAL, value, attributes)
			this.emitter.recordHistogram(TaskTelemetry.METRICS.TASK.TOKENS_INPUT_PER_RESPONSE, value, attributes)
		}
		if (Number.isFinite(tokensOut)) {
			const value = tokensOut ?? 0
			this.emitter.recordCounter(TaskTelemetry.METRICS.TASK.TOKENS_OUTPUT_TOTAL, value, attributes)
			this.emitter.recordHistogram(TaskTelemetry.METRICS.TASK.TOKENS_OUTPUT_PER_RESPONSE, value, attributes)
		}
		if (Number.isFinite(options?.cacheWriteTokens)) {
			const cacheWriteTokens = options!.cacheWriteTokens ?? 0
			this.emitter.recordCounter(TaskTelemetry.METRICS.CACHE.WRITE_TOTAL, cacheWriteTokens, attributes)
			this.emitter.recordHistogram(TaskTelemetry.METRICS.CACHE.WRITE_PER_EVENT, cacheWriteTokens, attributes)
		}
		if (Number.isFinite(options?.cacheReadTokens)) {
			const cacheReadTokens = options!.cacheReadTokens ?? 0
			this.emitter.recordCounter(TaskTelemetry.METRICS.CACHE.READ_TOTAL, cacheReadTokens, attributes)
			this.emitter.recordHistogram(TaskTelemetry.METRICS.CACHE.READ_PER_EVENT, cacheReadTokens, attributes)
		}
		if (Number.isFinite(options?.totalCost)) {
			const totalCost = options!.totalCost ?? 0
			const costAttributes = { ...attributes, currency: "USD" }
			this.emitter.recordCounter(TaskTelemetry.METRICS.TASK.COST_TOTAL, totalCost, costAttributes)
			this.emitter.recordHistogram(TaskTelemetry.METRICS.TASK.COST_PER_EVENT, totalCost, costAttributes)
		}
	}

	captureModeSwitch(ulid: string, mode: Mode): void {
		this.emitter.capture({ event: TaskTelemetry.EVENTS.MODE_SWITCH, properties: { ulid, mode } })
	}

	captureCondense(
		ulid: string,
		modelId: string,
		provider: string,
		source: "automatic" | "user",
		currentTokens: number,
		maxContextWindow: number,
	): void {
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.CONDENSE,
			properties: { ulid, modelId, provider, source, currentTokens, maxContextWindow },
		})
	}

	captureTaskFeedback(ulid: string, feedbackType: TaskFeedbackType): void {
		Logger.info("TelemetryService: Capturing task feedback", { ulid, feedbackType })
		this.emitter.capture({ event: TaskTelemetry.EVENTS.FEEDBACK, properties: { ulid, feedbackType } })
		this.sessionTracker.resetAggregates(ulid)
	}

	captureTaskInitialization(ulid: string, taskId: string, durationMs: number, hasCheckpoints: boolean): void {
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.INITIALIZATION,
			properties: { ulid, taskId, durationMs, hasCheckpoints },
		})
	}

	captureOptionSelected(ulid: string, qty: number, mode: Mode): void {
		this.emitter.capture({ event: TaskTelemetry.EVENTS.OPTION_SELECTED, properties: { ulid, qty, mode } })
	}

	captureOptionsIgnored(ulid: string, qty: number, mode: Mode): void {
		this.emitter.capture({ event: TaskTelemetry.EVENTS.OPTIONS_IGNORED, properties: { ulid, qty, mode } })
	}

	captureSlashCommandUsed(ulid: string, commandName: string, commandType: "builtin" | "workflow" | "skill"): void {
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.SLASH_COMMAND_USED,
			properties: { ulid, commandName, commandType },
		})
	}

	captureFeatureToggle(ulid: string, featureName: string, enabled: boolean, modelId: string): void {
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.FEATURE_TOGGLED,
			properties: { ulid, featureName, enabled, modelId },
		})
	}

	captureDiracRuleToggled(ulid: string, ruleFileName: string, enabled: boolean, isGlobal: boolean): void {
		// Sanitize filename to remove any path information for privacy
		const sanitizedFileName = ruleFileName.split("/").pop() || ruleFileName.split("\\").pop() || ruleFileName
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.RULE_TOGGLED,
			properties: { ulid, ruleFileName: sanitizedFileName, enabled, isGlobal },
		})
	}

	captureAutoCondenseToggle(ulid: string, enabled: boolean, modelId: string): void {
		this.emitter.capture({
			event: TaskTelemetry.EVENTS.AUTO_CONDENSE_TOGGLED,
			properties: { ulid, enabled, modelId },
		})
	}

	captureYoloModeToggle(ulid: string, enabled: boolean): void {
		this.emitter.capture({ event: TaskTelemetry.EVENTS.YOLO_MODE_TOGGLED, properties: { ulid, enabled } })
	}

	captureDiracWebToolsToggle(ulid: string, enabled: boolean): void {
		this.emitter.capture({ event: TaskTelemetry.EVENTS.CLINE_WEB_TOOLS_TOGGLED, properties: { ulid, enabled } })
	}
}
```


## Source Files:

- `src/core/controller/models/refreshBasetenModels.ts`
- `src/services/feature-flags/FeatureFlagsProviderFactory.ts`
- `src/services/feature-flags/FeatureFlagsService.ts`
- `src/services/feature-flags/index.ts`
- `src/services/feature-flags/providers/DiracFeatureFlagsProvider.ts`
- `src/services/feature-flags/providers/IFeatureFlagsProvider.ts`
- `src/services/telemetry/TaskTelemetry.ts`
- `src/shared/DiracFeatureSetting.ts`
- `src/shared/services/feature-flags/feature-flags.ts`

