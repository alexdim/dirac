import "should"
import { expect } from "chai"
import axios from "axios"
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

	it("aborts an in-flight Chat Completions request", async () => {
		let requestSignal: AbortSignal | undefined
		const createStub = sinon.stub().callsFake((_body: unknown, options: { signal: AbortSignal }) => {
			requestSignal = options.signal
			return new Promise((_resolve, reject) => {
				options.signal.addEventListener(
					"abort",
					() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
					{ once: true },
				)
			})
		})
		const handler = new OpenRouterHandler({ openRouterApiKey: "test-key" })
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create: createStub } } })
		sinon.stub(handler, "getModel").returns({ id: "openai/gpt-4o-mini", info: modelInfo })

		const nextPromise = handler
			.createMessage("system", [{ role: "user", content: "hello" }])
			[Symbol.asyncIterator]()
			.next()
		await new Promise<void>((resolve) => setImmediate(resolve))
		if (!requestSignal) throw new Error("OpenRouter request did not start")

		requestSignal.aborted.should.equal(false)
		handler.abort()
		requestSignal.aborted.should.equal(true)

		let caught: unknown
		try {
			await nextPromise
		} catch (error) {
			caught = error
		}
		expect(caught).to.be.instanceOf(Error)
		expect((handler as any).abortController).to.equal(undefined)
	})

	it("does not start another request when aborted during retry backoff", async () => {
		const clock = sinon.useFakeTimers()
		let notifyRetryStarted!: () => void
		const retryStarted = new Promise<void>((resolve) => {
			notifyRetryStarted = resolve
		})
		const createStub = sinon.stub().rejects(Object.assign(new Error("rate limited"), { status: 429 }))
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-key",
			onRetryAttempt: () => notifyRetryStarted(),
		})
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create: createStub } } })
		sinon.stub(handler, "getModel").returns({ id: "openai/gpt-4o-mini", info: modelInfo })

		const pendingChunk = handler.createMessage("system", [{ role: "user", content: "hello" }]).next()
		const rejectedChunk = pendingChunk.should.be.rejected()
		await retryStarted

		handler.abort()
		await clock.tickAsync(1_000)
		await rejectedChunk

		sinon.assert.calledOnce(createStub)
	})

	it("passes cancellation to the generation-details request without retrying it", async () => {
		let requestSignal: AbortSignal | undefined
		const getStub = sinon.stub(axios, "get").callsFake((_url, options) => {
			requestSignal = options?.signal as AbortSignal
			return new Promise((_resolve, reject) => {
				requestSignal?.addEventListener(
					"abort",
					() => reject(Object.assign(new Error("aborted"), { name: "CanceledError" })),
					{ once: true },
				)
			})
		})
		const handler = new OpenRouterHandler({ openRouterApiKey: "test-key" })
		const abortController = new AbortController()
		const nextPromise = handler.fetchGenerationDetails("generation-id", abortController.signal).next()
		await new Promise<void>((resolve) => setImmediate(resolve))
		if (!requestSignal) throw new Error("Generation-details request did not start")

		abortController.abort()

		const result = await nextPromise
		expect(result.done).to.equal(true)
		getStub.callCount.should.equal(1)
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
