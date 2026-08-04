import assert from "node:assert/strict"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { DeepSeekHandler } from "../deepseek"
import { MinimaxHandler } from "../minimax"
import { MoonshotHandler } from "../moonshot"
import { ZAiHandler } from "../zai"

type CancellableHandler = {
	abort(): void
	createMessage(systemPrompt: string, messages: Array<{ role: "user"; content: string }>): AsyncGenerator<unknown>
}

type HandlerInternals = {
	abortController?: AbortController
	ensureClient(): unknown
}

function getHandlerInternals(handler: CancellableHandler): HandlerInternals {
	return handler as unknown as HandlerInternals
}

const emptyStream = {
	[Symbol.asyncIterator]: async function* () {},
}

async function assertRequestCancellation(
	handler: CancellableHandler,
	stubClient: (create: sinon.SinonStub) => void,
): Promise<void> {
	let resolveFirstSignal: (signal: AbortSignal) => void
	const firstSignalPromise = new Promise<AbortSignal>((resolve) => {
		resolveFirstSignal = resolve
	})
	const signals: AbortSignal[] = []
	const create = sinon.stub().callsFake((_request: unknown, options: { signal: AbortSignal }) => {
		const { signal } = options
		signals.push(signal)
		if (signals.length > 1) return Promise.resolve(emptyStream)

		resolveFirstSignal(signal)
		return new Promise((_resolve, reject) => {
			signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true })
		})
	})
	stubClient(create)

	const firstNext = handler.createMessage("sys", [{ role: "user", content: "hi" }]).next()
	const firstSignal = await firstSignalPromise
	assert.equal(firstSignal.aborted, false)

	handler.abort()
	await assert.rejects(firstNext, /request aborted/)
	assert.equal(firstSignal.aborted, true)
	assert.equal(getHandlerInternals(handler).abortController, undefined)

	for await (const _chunk of handler.createMessage("sys", [{ role: "user", content: "again" }])) {
		// Consume the empty second stream.
	}
	assert.equal(signals.length, 2)
	assert.notEqual(signals[1], firstSignal)
	assert.equal(signals[1].aborted, false)
	assert.equal(getHandlerInternals(handler).abortController, undefined)
}

async function assertOlderRequestDoesNotClearActiveController(
	handler: CancellableHandler,
	stubClient: (create: sinon.SinonStub) => void,
): Promise<void> {
	let releaseFirstStream!: () => void
	let markFirstStreamStarted!: () => void
	const firstStreamStarted = new Promise<void>((resolve) => {
		markFirstStreamStarted = resolve
	})
	const firstStream = {
		[Symbol.asyncIterator]: async function* () {
			markFirstStreamStarted()
			await new Promise<void>((resolve) => {
				releaseFirstStream = resolve
			})
		},
	}

	let resolveSecondSignal!: (signal: AbortSignal) => void
	const secondSignalPromise = new Promise<AbortSignal>((resolve) => {
		resolveSecondSignal = resolve
	})
	const create = sinon.stub()
	create.onFirstCall().resolves(firstStream)
	create.onSecondCall().callsFake((_request: unknown, options: { signal: AbortSignal }) => {
		resolveSecondSignal(options.signal)
		return new Promise((_resolve, reject) => {
			options.signal.addEventListener("abort", () => reject(new Error("active request aborted")), { once: true })
		})
	})
	stubClient(create)

	const firstNext = handler.createMessage("sys", [{ role: "user", content: "first" }]).next()
	await firstStreamStarted
	const secondNext = handler.createMessage("sys", [{ role: "user", content: "second" }]).next()
	const secondSignal = await secondSignalPromise

	releaseFirstStream()
	await firstNext
	assert.equal(secondSignal.aborted, false)

	handler.abort()
	await assert.rejects(secondNext, /active request aborted/)
	assert.equal(secondSignal.aborted, true)
	assert.equal(getHandlerInternals(handler).abortController, undefined)
}

async function assertAbortDuringRetryBackoff(
	handler: CancellableHandler,
	stubClient: (create: sinon.SinonStub) => void,
	retryStarted: Promise<void>,
): Promise<void> {
	const clock = sinon.useFakeTimers()
	try {
		let requestSignal: AbortSignal | undefined
		const rateLimitError = Object.assign(new Error("rate limited"), { status: 429 })
		const create = sinon.stub().callsFake((_request: unknown, options: { signal: AbortSignal }) => {
			requestSignal = options.signal
			return Promise.reject(rateLimitError)
		})
		stubClient(create)

		const pendingChunk = handler.createMessage("sys", [{ role: "user", content: "hi" }]).next()
		const rejectedChunk = assert.rejects(
			pendingChunk,
			(error: unknown) => error instanceof Error && error.name === "AbortError",
		)
		await retryStarted

		handler.abort()
		await clock.tickAsync(1_000)
		await rejectedChunk

		assert.equal(requestSignal?.aborted, true)
		assert.equal(create.callCount, 1)
		assert.equal(getHandlerInternals(handler).abortController, undefined)
	} finally {
		clock.restore()
	}
}

describe("active provider request cancellation", () => {
	afterEach(() => sinon.restore())

	it("aborts DeepSeek requests and uses a fresh signal for the next request", async () => {
		const handler = new DeepSeekHandler({ deepSeekApiKey: "key" })
		await assertRequestCancellation(handler, (create) => {
			sinon.stub(getHandlerInternals(handler), "ensureClient").returns({ chat: { completions: { create } } })
		})
	})

	it("aborts Z.AI requests and uses a fresh signal for the next request", async () => {
		const handler = new ZAiHandler({ zaiApiKey: "key" })
		await assertRequestCancellation(handler, (create) => {
			sinon.stub(getHandlerInternals(handler), "ensureClient").returns({ chat: { completions: { create } } })
		})
	})

	it("aborts Moonshot requests and uses a fresh signal for the next request", async () => {
		const handler = new MoonshotHandler({ moonshotApiKey: "key" })
		await assertRequestCancellation(handler, (create) => {
			sinon.stub(getHandlerInternals(handler), "ensureClient").returns({ chat: { completions: { create } } })
		})
	})

	it("aborts MiniMax requests and uses a fresh signal for the next request", async () => {
		const handler = new MinimaxHandler({ minimaxApiKey: "key" })
		await assertRequestCancellation(handler, (create) => {
			sinon.stub(getHandlerInternals(handler), "ensureClient").returns({ messages: { create } })
		})
	})

	it("does not let an older request clear a newer active request controller", async () => {
		const openAiHandlers = [
			new DeepSeekHandler({ deepSeekApiKey: "key" }),
			new ZAiHandler({ zaiApiKey: "key" }),
			new MoonshotHandler({ moonshotApiKey: "key" }),
		]
		for (const handler of openAiHandlers) {
			await assertOlderRequestDoesNotClearActiveController(handler, (create) => {
				sinon.stub(getHandlerInternals(handler), "ensureClient").returns({ chat: { completions: { create } } })
			})
		}

		const minimax = new MinimaxHandler({ minimaxApiKey: "key" })
		await assertOlderRequestDoesNotClearActiveController(minimax, (create) => {
			sinon.stub(getHandlerInternals(minimax), "ensureClient").returns({ messages: { create } })
		})
	})

	it("does not start another provider request when aborted during retry backoff", async () => {
		const createRetryNotification = () => {
			let notifyRetryStarted!: () => void
			const retryStarted = new Promise<void>((resolve) => {
				notifyRetryStarted = resolve
			})
			return { retryStarted, onRetryAttempt: notifyRetryStarted }
		}

		const deepSeekRetry = createRetryNotification()
		const deepSeek = new DeepSeekHandler({ deepSeekApiKey: "key", onRetryAttempt: deepSeekRetry.onRetryAttempt })
		await assertAbortDuringRetryBackoff(
			deepSeek,
			(create) => {
				sinon.stub(getHandlerInternals(deepSeek), "ensureClient").returns({ chat: { completions: { create } } })
			},
			deepSeekRetry.retryStarted,
		)

		const zaiRetry = createRetryNotification()
		const zai = new ZAiHandler({ zaiApiKey: "key", onRetryAttempt: zaiRetry.onRetryAttempt })
		await assertAbortDuringRetryBackoff(
			zai,
			(create) => {
				sinon.stub(getHandlerInternals(zai), "ensureClient").returns({ chat: { completions: { create } } })
			},
			zaiRetry.retryStarted,
		)

		const moonshotRetry = createRetryNotification()
		const moonshot = new MoonshotHandler({ moonshotApiKey: "key", onRetryAttempt: moonshotRetry.onRetryAttempt })
		await assertAbortDuringRetryBackoff(
			moonshot,
			(create) => {
				sinon.stub(getHandlerInternals(moonshot), "ensureClient").returns({ chat: { completions: { create } } })
			},
			moonshotRetry.retryStarted,
		)

		const minimaxRetry = createRetryNotification()
		const minimax = new MinimaxHandler({ minimaxApiKey: "key", onRetryAttempt: minimaxRetry.onRetryAttempt })
		await assertAbortDuringRetryBackoff(
			minimax,
			(create) => {
				sinon.stub(getHandlerInternals(minimax), "ensureClient").returns({ messages: { create } })
			},
			minimaxRetry.retryStarted,
		)
	})
})
