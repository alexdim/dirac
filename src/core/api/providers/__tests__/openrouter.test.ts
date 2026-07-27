import "should"
import sinon from "sinon"
import { OpenRouterHandler } from "../openrouter"

const modelInfo = { supportsPromptCache: false }

describe("OpenRouterHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	const tools = [{ type: "function", function: { name: "read_file", description: "", parameters: { type: "object" } } }] as any

	it("should handle usage-only chunks when delta is missing", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 13,
									completion_tokens: 5,
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		sinon.stub(handler, "getModel").returns({
			id: "openai/gpt-4o-mini",
			info: { ...modelInfo, inputPrice: 0, outputPrice: 0, cacheWritesPrice: 0, cacheReadsPrice: 0 },
		})

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				inputTokens: 13,
				outputTokens: 5,
				totalCost: 0,
			},
		])
	})

	type ParallelToolCallsTestCase = {
		modelId: string
		enableParallelToolCalling: boolean
		expectedParallelToolCalls: boolean
	}

	const parallelToolCallsTestCases: ParallelToolCallsTestCase[] = [
		{
			modelId: "openai/gpt-4o-mini",
			enableParallelToolCalling: true,
			expectedParallelToolCalls: true,
		},
		{
			modelId: "openai/gpt-4o-mini",
			enableParallelToolCalling: false,
			expectedParallelToolCalls: false,
		},
		{
			modelId: "google/gemini-3-flash-preview",
			enableParallelToolCalling: true,
			expectedParallelToolCalls: true,
		},
	]

	for (const testCase of parallelToolCallsTestCases) {
		const settingLabel = testCase.enableParallelToolCalling ? "enabled" : "disabled"
		it(`should set parallel_tool_calls=${testCase.expectedParallelToolCalls} for ${testCase.modelId} when setting is ${settingLabel}`, async () => {
			const handler = new OpenRouterHandler({
				openRouterApiKey: "test-api-key",
				enableParallelToolCalling: testCase.enableParallelToolCalling,
			})
			const createStub = sinon.stub().resolves(createAsyncIterable([]))
			const fakeClient = {
				chat: {
					completions: {
						create: createStub,
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
			sinon.stub(handler, "getModel").returns({
				id: testCase.modelId,
				info: modelInfo,
			})

			for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
				// drain stream
			}

			const payload = createStub.firstCall.args[0]
			payload.parallel_tool_calls.should.equal(testCase.expectedParallelToolCalls)
		})
	}

	it("applies allowed providers only to the active model ID", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
			openRouterProviderSorting: "price",
			openRouterPinnedProviders: {
				"author/model-a": ["provider-a"],
			},
			openRouterPreventFallbacks: true,
		})
		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		sinon.stub(handler as any, "ensureClient").returns({
			chat: { completions: { create: createStub } },
		} as any)
		sinon.stub(handler, "getModel").returns({
			id: "author/model-b",
			info: modelInfo,
		})

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			// drain stream
		}

		createStub.firstCall.args[0].provider.should.deepEqual({
			sort: "price",
			allow_fallbacks: false,
		})
	})
})
