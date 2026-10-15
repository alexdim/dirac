---
component_id: 3
component_name: Shared Domain Types & Utilities
---

# Shared Domain Types & Utilities

## Component Description

Defines shared domain models, protocol buffer conversions, logging, error helpers, and cross-cutting utilities used across core, hosts, and CLI.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/services/Logger.ts (lines 5-87)
```
export class Logger {
	private static isVerbose = isDev()

	static setVerbose(flag: boolean) {
		Logger.isVerbose = flag
	}
	private static subscribers: Set<(msg: string) => void> = new Set()

	private static output(msg: string): void {
		if (Logger.subscribers.size === 0) {
			process.stderr.write(msg + "\n")
			return
		}
		for (const subscriber of Logger.subscribers) {
			try {
				subscriber(msg)
			} catch {
				// ignore errors from subscribers
			}
		}
	}

	/**
	 * Register a callback to receive log output messages.
	 */
	static subscribe(outputFn: (msg: string) => void): () => void {
		Logger.subscribers.add(outputFn)
		return () => Logger.subscribers.delete(outputFn)
	}

	static error(message: string, ...args: any[]) {
		Logger.#output("ERROR", message, undefined, args)
	}

	static warn(message: string, ...args: any[]) {
		Logger.#output("WARN", message, undefined, args)
	}

	static log(message: string, ...args: any[]) {
		Logger.#output("LOG", message, undefined, args)
	}

	static debug(message: string, ...args: any[]) {
		Logger.#output("DEBUG", message, undefined, args)
	}

	static info(message: string, ...args: any[]) {
		Logger.#output("INFO", message, undefined, args)
	}

	/** Verbose-only output: only emits when verbose mode is enabled (via --verbose flag). */
	static verbose(message: string, ...args: any[]) {
		if (Logger.isVerbose) {
			Logger.#output("VERBOSE", message, undefined, args)
		}
	}

	static trace(message: string, ...args: any[]) {
		Logger.#output("TRACE", message, undefined, args)
	}

	static #output(level: string, message: string, error: Error | undefined, args: any[]) {
		try {
			let fullMessage = message
			if (args.length > 0) {
				fullMessage += ` ${args
					.map((arg) => {
						if (arg instanceof Error) {
							return `${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`
						}
						try {
							return typeof arg === "object" ? JSON.stringify(arg) : String(arg)
						} catch {
							return String(arg)
						}
					})
					.join(" ")}`
			}
			const errorSuffix = error?.message ? ` ${error.message}${error.stack ? `\n${error.stack}` : ""}` : ""
			Logger.output(`${level} ${fullMessage}${errorSuffix}`.trimEnd())
		} catch {}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/shared/errors.ts (lines 6-8)
```
export function getErrorMessage(error: unknown, fallback?: string): string {
	return error instanceof Error ? error.message : fallback ?? String(error)
}
```

### /Users/highlands/pools/Development/dirac/src/shared/net.ts (lines 175-180)
```
export function getAxiosSettings(): Pick<AxiosRequestConfig, "adapter"> & { fetch?: typeof globalThis.fetch } {
	return {
		adapter: "fetch",
		fetch, // Use our configured fetch
	}
}
```

### /Users/highlands/pools/Development/dirac/src/shared/proto-conversions/models/api-configuration-conversion.ts (lines 660-811)
```
export function convertProtoToApiConfiguration(protoConfig: ProtoApiConfiguration): ApiConfiguration {
	return {
		// Global configuration fields
		apiKey: protoConfig.apiKey,
		ulid: protoConfig.ulid,
		liteLlmBaseUrl: protoConfig.liteLlmBaseUrl,
		liteLlmApiKey: protoConfig.liteLlmApiKey,
		liteLlmUsePromptCache: protoConfig.liteLlmUsePromptCache,
		openAiHeaders: Object.keys(protoConfig.openAiHeaders || {}).length > 0 ? protoConfig.openAiHeaders : undefined,
		anthropicBaseUrl: protoConfig.anthropicBaseUrl,
		openRouterApiKey: protoConfig.openRouterApiKey,
		openRouterProviderSorting: protoConfig.openRouterProviderSorting,
		openRouterPinnedProviders: convertProtoToStringArrayMap(protoConfig.openRouterPinnedProviders),
		openRouterPreventFallbacks: protoConfig.openRouterPreventFallbacks,
		awsAccessKey: protoConfig.awsAccessKey,
		awsSecretKey: protoConfig.awsSecretKey,
		awsSessionToken: protoConfig.awsSessionToken,
		awsRegion: protoConfig.awsRegion,
		awsUseCrossRegionInference: protoConfig.awsUseCrossRegionInference,
		awsUseGlobalInference: protoConfig.awsUseGlobalInference,
		awsBedrockUsePromptCache: protoConfig.awsBedrockUsePromptCache,
		awsUseProfile: protoConfig.awsUseProfile,
		awsAuthentication: protoConfig.awsAuthentication,
		awsProfile: protoConfig.awsProfile,
		awsBedrockApiKey: protoConfig.awsBedrockApiKey,
		awsBedrockEndpoint: protoConfig.awsBedrockEndpoint,
		claudeCodePath: protoConfig.claudeCodePath,
		vertexProjectId: protoConfig.vertexProjectId,
		vertexRegion: protoConfig.vertexRegion,
		openAiBaseUrl: protoConfig.openAiBaseUrl,
		openAiApiKey: protoConfig.openAiApiKey,
		lmStudioBaseUrl: protoConfig.lmStudioBaseUrl,
		lmStudioMaxTokens: protoConfig.lmStudioMaxTokens,
		geminiApiKey: protoConfig.geminiApiKey,
		geminiBaseUrl: protoConfig.geminiBaseUrl,
		openAiNativeApiKey: protoConfig.openAiNativeApiKey,
		deepSeekApiKey: protoConfig.deepSeekApiKey,
		unbiasedApiKey: protoConfig.unbiasedApiKey,
		requestyApiKey: protoConfig.requestyApiKey,
		requestyBaseUrl: protoConfig.requestyBaseUrl,
		togetherApiKey: protoConfig.togetherApiKey,
		fireworksApiKey: protoConfig.fireworksApiKey,
		fireworksModelMaxCompletionTokens: protoConfig.fireworksModelMaxCompletionTokens,
		fireworksModelMaxTokens: protoConfig.fireworksModelMaxTokens,
		qwenApiKey: protoConfig.qwenApiKey,
		qwenCodeOauthPath: protoConfig.qwenCodeOauthPath,
		doubaoApiKey: protoConfig.doubaoApiKey,
		mistralApiKey: protoConfig.mistralApiKey,
		azureApiVersion: protoConfig.azureApiVersion,
		qwenApiLine: protoConfig.qwenApiLine,
		moonshotApiLine: protoConfig.moonshotApiLine,
		moonshotApiKey: protoConfig.moonshotApiKey,
		huggingFaceApiKey: protoConfig.huggingFaceApiKey,
		nebiusApiKey: protoConfig.nebiusApiKey,
		wandbApiKey: protoConfig.wandbApiKey,
		xaiApiKey: protoConfig.xaiApiKey,
		sambanovaApiKey: protoConfig.sambanovaApiKey,
		cerebrasApiKey: protoConfig.cerebrasApiKey,
		vercelAiGatewayApiKey: protoConfig.vercelAiGatewayApiKey,
		groqApiKey: protoConfig.groqApiKey,
		basetenApiKey: protoConfig.basetenApiKey,
		requestTimeoutMs: protoConfig.requestTimeoutMs,
		huaweiCloudMaasApiKey: protoConfig.huaweiCloudMaasApiKey,
		zaiApiLine: protoConfig.zaiApiLine,
		zaiApiKey: protoConfig.zaiApiKey,
		difyApiKey: protoConfig.difyApiKey,
		difyBaseUrl: protoConfig.difyBaseUrl,
		aihubmixApiKey: protoConfig.aihubmixApiKey,
		aihubmixBaseUrl: protoConfig.aihubmixBaseUrl,
		aihubmixAppCode: protoConfig.aihubmixAppCode,
		openAiCompatibleProfiles: (protoConfig.openAiCompatibleProfiles || []).map(convertProtoToOpenAiCompatibleProfile),
		minimaxApiKey: protoConfig.minimaxApiKey,
		minimaxApiLine: protoConfig.minimaxApiLine,
		nousResearchApiKey: protoConfig.nousResearchApiKey,

		// Plan mode configurations
		planModeApiProvider:
			protoConfig.planModeApiProvider !== undefined
				? convertProtoToApiProvider(protoConfig.planModeApiProvider)
				: undefined,
		planModeApiModelId: protoConfig.planModeApiModelId,
		planModeThinkingBudgetTokens: protoConfig.planModeThinkingBudgetTokens,
		geminiPlanModeThinkingLevel: protoConfig.geminiPlanModeThinkingLevel,
		planModeReasoningEffort: protoConfig.planModeReasoningEffort as OpenaiReasoningEffort | undefined,
		planModeInferenceSpeed: normalizeInferenceSpeed(protoConfig.planModeInferenceSpeed),
		planModeVsCodeLmModelSelector: protoConfig.planModeVsCodeLmModelSelector,
		planModeAwsBedrockCustomSelected: protoConfig.planModeAwsBedrockCustomSelected,
		planModeAwsBedrockCustomModelBaseId: protoConfig.planModeAwsBedrockCustomModelBaseId as BedrockModelId | undefined,
		planModeOpenRouterModelId: protoConfig.planModeOpenRouterModelId,
		planModeOpenRouterModelInfo: convertProtoToModelInfo(protoConfig.planModeOpenRouterModelInfo),
		planModeOpenAiModelId: protoConfig.planModeOpenAiModelId,
		planModeOpenAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(protoConfig.planModeOpenAiModelInfo),
		planModeOpenAiProfileName: protoConfig.planModeOpenAiProfileName,
		planModeLmStudioModelId: protoConfig.planModeLmStudioModelId,
		planModeLiteLlmModelId: protoConfig.planModeLiteLlmModelId,
		planModeLiteLlmModelInfo: convertProtoToLiteLLMModelInfo(protoConfig.planModeLiteLlmModelInfo),
		planModeRequestyModelId: protoConfig.planModeRequestyModelId,
		planModeRequestyModelInfo: convertProtoToModelInfo(protoConfig.planModeRequestyModelInfo),
		planModeTogetherModelId: protoConfig.planModeTogetherModelId,
		planModeFireworksModelId: protoConfig.planModeFireworksModelId,
		planModeGroqModelId: protoConfig.planModeGroqModelId,
		planModeGroqModelInfo: convertProtoToModelInfo(protoConfig.planModeGroqModelInfo),
		planModeBasetenModelId: protoConfig.planModeBasetenModelId,
		planModeBasetenModelInfo: convertProtoToModelInfo(protoConfig.planModeBasetenModelInfo),
		planModeHuggingFaceModelId: protoConfig.planModeHuggingFaceModelId,
		planModeHuggingFaceModelInfo: convertProtoToModelInfo(protoConfig.planModeHuggingFaceModelInfo),
		planModeHuaweiCloudMaasModelId: protoConfig.planModeHuaweiCloudMaasModelId,
		planModeHuaweiCloudMaasModelInfo: convertProtoToModelInfo(protoConfig.planModeHuaweiCloudMaasModelInfo),
		planModeAihubmixModelId: protoConfig.planModeAihubmixModelId,
		planModeAihubmixModelInfo: convertProtoToOpenAiCompatibleModelInfo(protoConfig.planModeAihubmixModelInfo),
		planModeNousResearchModelId: protoConfig.planModeNousResearchModelId,
		planModeVercelAiGatewayModelId: protoConfig.planModeVercelAiGatewayModelId,
		planModeVercelAiGatewayModelInfo: convertProtoToModelInfo(protoConfig.planModeVercelAiGatewayModelInfo),

		// Act mode configurations
		actModeApiProvider:
			protoConfig.actModeApiProvider !== undefined ? convertProtoToApiProvider(protoConfig.actModeApiProvider) : undefined,
		actModeApiModelId: protoConfig.actModeApiModelId,
		actModeThinkingBudgetTokens: protoConfig.actModeThinkingBudgetTokens,
		geminiActModeThinkingLevel: protoConfig.geminiActModeThinkingLevel,
		actModeReasoningEffort: protoConfig.actModeReasoningEffort as OpenaiReasoningEffort | undefined,
		actModeInferenceSpeed: normalizeInferenceSpeed(protoConfig.actModeInferenceSpeed),
		actModeVsCodeLmModelSelector: protoConfig.actModeVsCodeLmModelSelector,
		actModeAwsBedrockCustomSelected: protoConfig.actModeAwsBedrockCustomSelected,
		actModeAwsBedrockCustomModelBaseId: protoConfig.actModeAwsBedrockCustomModelBaseId as BedrockModelId | undefined,
		actModeOpenRouterModelId: protoConfig.actModeOpenRouterModelId,
		actModeOpenRouterModelInfo: convertProtoToModelInfo(protoConfig.actModeOpenRouterModelInfo),
		actModeOpenAiModelId: protoConfig.actModeOpenAiModelId,
		actModeOpenAiModelInfo: convertProtoToOpenAiCompatibleModelInfo(protoConfig.actModeOpenAiModelInfo),
		actModeOpenAiProfileName: protoConfig.actModeOpenAiProfileName,
		actModeLmStudioModelId: protoConfig.actModeLmStudioModelId,
		actModeLiteLlmModelId: protoConfig.actModeLiteLlmModelId,
		actModeLiteLlmModelInfo: convertProtoToLiteLLMModelInfo(protoConfig.actModeLiteLlmModelInfo),
		actModeRequestyModelId: protoConfig.actModeRequestyModelId,
		actModeRequestyModelInfo: convertProtoToModelInfo(protoConfig.actModeRequestyModelInfo),
		actModeTogetherModelId: protoConfig.actModeTogetherModelId,
		actModeFireworksModelId: protoConfig.actModeFireworksModelId,
		actModeGroqModelId: protoConfig.actModeGroqModelId,
		actModeGroqModelInfo: convertProtoToModelInfo(protoConfig.actModeGroqModelInfo),
		actModeBasetenModelId: protoConfig.actModeBasetenModelId,
		actModeBasetenModelInfo: convertProtoToModelInfo(protoConfig.actModeBasetenModelInfo),
		actModeHuggingFaceModelId: protoConfig.actModeHuggingFaceModelId,
		actModeHuggingFaceModelInfo: convertProtoToModelInfo(protoConfig.actModeHuggingFaceModelInfo),
		actModeHuaweiCloudMaasModelId: protoConfig.actModeHuaweiCloudMaasModelId,
		actModeHuaweiCloudMaasModelInfo: convertProtoToModelInfo(protoConfig.actModeHuaweiCloudMaasModelInfo),
		actModeAihubmixModelId: protoConfig.actModeAihubmixModelId,
		actModeAihubmixModelInfo: convertProtoToOpenAiCompatibleModelInfo(protoConfig.actModeAihubmixModelInfo),
		actModeNousResearchModelId: protoConfig.actModeNousResearchModelId,
		actModeVercelAiGatewayModelId: protoConfig.actModeVercelAiGatewayModelId,
		actModeVercelAiGatewayModelInfo: convertProtoToModelInfo(protoConfig.actModeVercelAiGatewayModelInfo),
	}
}
```


## Source Files:

- `src/shared/AutoApprovalSettings.ts`
- `src/shared/ChatContent.ts`
- `src/shared/DiracAccount.ts`
- `src/shared/DiracBanner.ts`
- `src/shared/HistoryItem.ts`
- `src/shared/Languages.ts`
- `src/shared/Patch.ts`
- `src/shared/PresentationOperation.ts`
- `src/shared/UserApprovedCommand.ts`
- `src/shared/UserInfo.ts`
- `src/shared/WebviewMessage.ts`
- `src/shared/anchor-limits.ts`
- `src/shared/api.ts`
- `src/shared/api/models/anthropic.ts`
- `src/shared/api/models/litellm.ts`
- `src/shared/api/models/openai-codex.ts`
- `src/shared/api/models/openai-native.ts`
- `src/shared/api/models/qwen-mainland.ts`
- `src/shared/api/models/types.ts`
- `src/shared/api/models/vertex.ts`
- `src/shared/array.ts`
- `src/shared/cardIdentity.ts`
- `src/shared/combineCardSequences.ts`
- `src/shared/config-types.ts`
- `src/shared/content-limits.ts`
- `src/shared/context-management.ts`
- `src/shared/dirac/api.ts`
- `src/shared/dirac/banner.ts`
- `src/shared/dirac/context.ts`
- `src/shared/dirac/index.ts`
- `src/shared/errors.ts`
- `src/shared/getApiMetrics.ts`
- `src/shared/goal.ts`
- `src/shared/historyItemFromProto.ts`
- `src/shared/icons.ts`
- `src/shared/internal/account.ts`
- `src/shared/messages/metrics.ts`
- `src/shared/net.ts`
- `src/shared/openai-codex-auth.ts`
- `src/shared/openai-codex-usage.ts`
- `src/shared/presentationState.ts`
- `src/shared/proto-conversions/dirac-message.ts`
- `src/shared/proto-conversions/file/search-result-conversion.ts`
- `src/shared/proto-conversions/models/api-configuration-conversion.ts`
- `src/shared/proto-conversions/models/typeConversion.ts`
- `src/shared/proto-conversions/models/vscode-lm-models-conversion.ts`
- `src/shared/proto-conversions/openai-codex-usage.ts`
- `src/shared/proto-conversions/state/telemetry-setting-conversion.ts`
- `src/shared/proto-conversions/web/open-graph-conversion.ts`
- `src/shared/release-notes.ts`
- `src/shared/responseTool.ts`
- `src/shared/safe-json-parse.ts`
- `src/shared/services/Logger.ts`
- `src/shared/services/Session.ts`
- `src/shared/services/file-logger.ts`
- `src/shared/services/worker/backfill.ts`
- `src/shared/services/worker/queue.ts`
- `src/shared/services/worker/sync.ts`
- `src/shared/services/worker/worker.ts`
- `src/shared/settings-presentation.ts`
- `src/shared/skills.ts`
- `src/shared/slashCommands.ts`
- `src/shared/sqlJsModule.ts`
- `src/shared/string.ts`
- `src/shared/subagentUsage.ts`
- `src/shared/subagents.ts`
- `src/shared/taskStatusProjection.ts`
- `src/shared/text-file-window.ts`
- `src/shared/tools.ts`
- `src/shared/utils/ChokidarWatcherCloser.ts`
- `src/shared/utils/line-hashing.ts`
- `src/shared/utils/model-filters.ts`
- `src/shared/utils/reasoning-support.ts`
- `src/shared/utils/tool-fingerprint.ts`
- `src/shared/vsCodeSelectorUtils.ts`

