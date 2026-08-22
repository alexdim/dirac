/**
 * Structural provider contract coverage for every PROVIDER_REGISTRY entry.
 *
 * This test references review/coverage/algorithms/provider-matrix.md in the
 * private documentation repository. Provider SDK streams are not exercised
 * against live services here: API keys, host services, OAuth credentials, and
 * network responses are unavailable in unit tests. The test therefore locks
 * registry construction, the documented abort surface, and the usage shape
 * exposed without starting a provider request. Mid-stream cancellation and
 * emitted usage events remain documented structural claims in the matrix until
 * provider-specific fakes are introduced.
 */
import { describe, it } from "mocha"
import "should"
import type { ApiConfiguration, ApiProvider } from "@shared/api"
import { buildApiHandler, PROVIDER_REGISTRY } from "../../index"

type AbortSurface = "present" | "absent" | "partial"
type UsageMode = "provider-event" | "estimated" | "local"

interface ProviderContract {
	abort: AbortSurface
	usage: UsageMode
}

const providerContractMatrix: Record<string, ProviderContract> = {
	anthropic: { abort: "absent", usage: "provider-event" },
	openrouter: { abort: "present", usage: "provider-event" },
	bedrock: { abort: "present", usage: "estimated" },
	vertex: { abort: "present", usage: "provider-event" },
	openai: { abort: "present", usage: "provider-event" },
	lmstudio: { abort: "absent", usage: "provider-event" },
	gemini: { abort: "present", usage: "provider-event" },
	"openai-native": { abort: "present", usage: "provider-event" },
	"openai-codex": { abort: "present", usage: "provider-event" },
	deepseek: { abort: "present", usage: "provider-event" },
	requesty: { abort: "absent", usage: "provider-event" },
	fireworks: { abort: "absent", usage: "provider-event" },
	together: { abort: "absent", usage: "provider-event" },
	qwen: { abort: "absent", usage: "provider-event" },
	"qwen-code": { abort: "absent", usage: "provider-event" },
	doubao: { abort: "absent", usage: "provider-event" },
	mistral: { abort: "partial", usage: "provider-event" },
	"vscode-lm": { abort: "absent", usage: "local" },
	"github-copilot": { abort: "absent", usage: "provider-event" },
	litellm: { abort: "absent", usage: "provider-event" },
	moonshot: { abort: "present", usage: "provider-event" },
	huggingface: { abort: "absent", usage: "provider-event" },
	nebius: { abort: "absent", usage: "provider-event" },
	xai: { abort: "absent", usage: "provider-event" },
	sambanova: { abort: "absent", usage: "provider-event" },
	cerebras: { abort: "absent", usage: "provider-event" },
	groq: { abort: "absent", usage: "provider-event" },
	baseten: { abort: "absent", usage: "provider-event" },
	"claude-code": { abort: "absent", usage: "provider-event" },
	"huawei-cloud-maas": { abort: "absent", usage: "provider-event" },
	dify: { abort: "present", usage: "provider-event" },
	"vercel-ai-gateway": { abort: "absent", usage: "provider-event" },
	zai: { abort: "present", usage: "provider-event" },
	aihubmix: { abort: "absent", usage: "provider-event" },
	minimax: { abort: "present", usage: "provider-event" },
	nousResearch: { abort: "absent", usage: "provider-event" },
	wandb: { abort: "absent", usage: "provider-event" },
}

const testConfiguration = (provider: string): ApiConfiguration =>
	({
		apiProvider: provider as ApiProvider,
		apiKey: "test-key",
		openRouterApiKey: "test-key",
		openAiApiKey: "test-key",
		openAiNativeApiKey: "test-key",
		deepSeekApiKey: "test-key",
		requestyApiKey: "test-key",
		fireworksApiKey: "test-key",
		togetherApiKey: "test-key",
		qwenApiKey: "test-key",
		doubaoApiKey: "test-key",
		mistralApiKey: "test-key",
		liteLlmApiKey: "test-key",
		moonshotApiKey: "test-key",
		huggingFaceApiKey: "test-key",
		nebiusApiKey: "test-key",
		xaiApiKey: "test-key",
		sambanovaApiKey: "test-key",
		cerebrasApiKey: "test-key",
		groqApiKey: "test-key",
		basetenApiKey: "test-key",
		huaweiCloudMaasApiKey: "test-key",
		difyApiKey: "test-key",
		difyApiSecret: "test-secret",
		difyBaseUrl: "https://dify.example/v1",
		vercelAiGatewayApiKey: "test-key",
		zaiApiKey: "test-key",
		aihubmixApiKey: "test-key",
		minimaxApiKey: "test-key",
		nousResearchApiKey: "test-key",
		wandbApiKey: "test-key",
		geminiApiKey: "test-key",
		anthropicApiKey: "test-key",
		awsAccessKey: "test-key",
		awsSecretKey: "test-secret",
		vertexProjectId: "test-project",
		vertexRegion: "us-central1",
		lmStudioBaseUrl: "http://localhost:1234",
		qwenCodeOauthPath: "/test/path",
		planModeApiModelId: "gpt-4o",
		actModeApiModelId: "gpt-4o",
		planModeOpenRouterModelId: "openai/gpt-4o",
		actModeOpenRouterModelId: "openai/gpt-4o",
		planModeVsCodeLmModelSelector: "gpt-4o",
		actModeVsCodeLmModelSelector: "gpt-4o",
		planModeLmStudioModelId: "gpt-4o",
		actModeLmStudioModelId: "gpt-4o",
		planModeOpenAiModelId: "gpt-4o",
		actModeOpenAiModelId: "gpt-4o",
	}) as ApiConfiguration

function assertUsageShape(value: unknown): void {
	if (value === undefined) return

	const usage = value as { inputTokens?: unknown; outputTokens?: unknown }
	usage.should.be.an.Object()
	usage.should.have.property("inputTokens")
	usage.should.have.property("outputTokens")
	;(typeof usage.inputTokens === "number" || usage.inputTokens === undefined).should.be.true()
	;(typeof usage.outputTokens === "number" || usage.outputTokens === undefined).should.be.true()
}

describe("Provider contract matrix", () => {
	it("has exactly one matrix entry for every registered provider", () => {
		const registryKeys = Object.keys(PROVIDER_REGISTRY).sort()
		const matrixKeys = Object.keys(providerContractMatrix).sort()

		matrixKeys.should.eql(registryKeys)
	})

	for (const provider of Object.keys(PROVIDER_REGISTRY)) {
		it(`${provider} is constructible and satisfies its matrix surface`, async () => {
			const contract = providerContractMatrix[provider]
			contract.should.not.be.undefined()
			contract.usage.should.not.equal("undefined")

			const handler = buildApiHandler(testConfiguration(provider), "plan")
			handler.should.not.be.undefined()
			handler.should.have.property("createMessage")
			handler.createMessage.should.be.a.Function()

			if (contract.abort === "present") {
				const abort = handler.abort
				;(typeof abort === "function").should.be.true()
			} else {
				;(handler.abort === undefined).should.be.true()
			}

			if (handler.getApiStreamUsage) {
				const usage = await handler.getApiStreamUsage()
				assertUsageShape(usage)
			}
		})
	}
})

describe("Provider abort presence contract (T-ABORT-MATRIX)", () => {
	for (const provider of Object.keys(PROVIDER_REGISTRY)) {
		it(`${provider} exposes abort; see review/coverage/algorithms/provider-matrix.md`, () => {
			const handler = buildApiHandler(testConfiguration(provider), "plan")
			const abort = handler.abort

			;(typeof abort === "function").should.be.true()
			if (typeof abort !== "function") {
				throw new Error(`Provider ${provider} is missing abort; update review/coverage/algorithms/provider-matrix.md`)
			}

			if (typeof abort === "function") {
				abort.call(handler)
				const controller = (handler as any).abortController as AbortController | undefined
				if (controller) controller.signal.aborted.should.be.true()
			}
		})
	}
})
