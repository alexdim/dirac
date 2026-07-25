import { expect } from "chai"
import { describe, it } from "mocha"
import type { ModelInfo } from "@shared/api"
import sinon from "sinon"
import { buildOpenRouterProvider, createOpenRouterStream } from "../openrouter-stream"

describe("createOpenRouterStream", () => {
	const createAsyncIterable = () => ({
		async *[Symbol.asyncIterator]() { },
	})

	const createClient = () => {
		const create = sinon.stub().resolves(createAsyncIterable())
		return {
			client: {
				chat: {
					completions: {
						create,
					},
				},
			},
			create,
		}
	}

	const createModelInfo = (overrides: Partial<ModelInfo> = {}): ModelInfo => ({
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		...overrides,
	})

	it("uses live max-token metadata without a named-model cap", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "google/gemini-2.5-flash",
			info: createModelInfo(),
		})

		expect(create.firstCall.args[0]).to.include({ max_tokens: 65_536 })
	})

	it("adds cache control only when model metadata reports prompt-cache support", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "example/cache-capable",
			info: createModelInfo({ supportsPromptCache: true }),
		})

		const payload = create.firstCall.args[0] as any
		expect(payload.messages[0].content[0].cache_control).to.deep.equal({ type: "ephemeral" })
		expect(payload.messages[1].content[0].cache_control).to.deep.equal({ type: "ephemeral" })
	})

	it("does not infer prompt-cache support from a model name", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "minimax/minimax-m2",
			info: createModelInfo(),
		})

		const payload = create.firstCall.args[0] as any
		expect(payload.messages[0].content).to.equal("system prompt")
	})

	it("omits provider routing when the user has no routing settings", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "example/model",
			info: createModelInfo(),
		})

		expect(create.firstCall.args[0]).not.to.have.property("provider")
		expect(buildOpenRouterProvider(undefined)).to.equal(undefined)
	})

	it("uses pinned providers as an explicit order instead of sorting the unrestricted provider pool", async () => {
		const { client, create } = createClient()
		const routing = {
			sort: "throughput",
			allowedProviders: ["deepinfra/turbo", "novita/fp8"],
			preventFallbacks: true,
		}

		await createOpenRouterStream(
			client as any,
			"system prompt",
			[{ role: "user", content: "hello" }] as any,
			{ id: "example/model", info: createModelInfo() },
			undefined,
			undefined,
			routing,
		)

		expect(create.firstCall.args[0].provider).to.deep.equal({
			order: ["deepinfra/turbo", "novita/fp8"],
			allow_fallbacks: false,
		})
	})
})
