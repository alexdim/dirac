import "should"
import { expect } from "chai"
import sinon from "sinon"
import { OpenAiHandler } from "../openai"

describe("OpenAiHandler cancellation", () => {
	afterEach(() => {
		sinon.restore()
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
		const handler = new OpenAiHandler({
			openAiApiKey: "test-key",
			openAiModelId: "test-model",
			openAiModelInfo: { supportsPromptCache: false, supportsTools: true },
		})
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create: createStub } } })

		const nextPromise = handler
			.createMessage("system", [{ role: "user", content: "hello" }])
			[Symbol.asyncIterator]()
			.next()
		await new Promise<void>((resolve) => setImmediate(resolve))
		if (!requestSignal) throw new Error("OpenAI request did not start")

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
		const handler = new OpenAiHandler({
			openAiApiKey: "test-key",
			openAiModelId: "test-model",
			openAiModelInfo: { supportsPromptCache: false, supportsTools: true },
			onRetryAttempt: () => notifyRetryStarted(),
		})
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create: createStub } } })

		const pendingChunk = handler.createMessage("system", [{ role: "user", content: "hello" }]).next()
		const rejectedChunk = pendingChunk.should.be.rejected()
		await retryStarted

		handler.abort()
		await clock.tickAsync(1_000)
		await rejectedChunk

		sinon.assert.calledOnce(createStub)
	})
})
