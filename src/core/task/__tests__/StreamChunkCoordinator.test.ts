import { strict as assert } from "node:assert"
import { expect } from "chai"
import { describe, it } from "mocha"
import type { ApiStream, ApiStreamChunk } from "@core/api/transform/stream"
import { StreamChunkCoordinator } from "../StreamChunkCoordinator"

function makeStream(chunks: ApiStreamChunk[], onReturn?: () => void): ApiStream {
	let index = 0
	const iterator: AsyncIterator<ApiStreamChunk> = {
		next: async () => (index < chunks.length ? { value: chunks[index++], done: false } : { value: undefined, done: true }),
		return: async () => {
			onReturn?.()
			return { value: undefined, done: true }
		},
	}
	return { [Symbol.asyncIterator]: () => iterator } as unknown as ApiStream
}

describe("StreamChunkCoordinator", () => {
	it("routes usage chunks to onUsageChunk and queues non-usage chunks", async () => {
		const usageChunks: unknown[] = []
		const coordinator = new StreamChunkCoordinator(
			makeStream([{ type: "usage", inputTokens: 1, outputTokens: 1 }, { type: "text", text: "hi" }]),
			{ onUsageChunk: (chunk) => usageChunks.push(chunk) },
		)

		expect(await coordinator.nextChunk()).to.deep.equal({ type: "text", text: "hi" })
		expect(usageChunks).to.have.length(1)
		await coordinator.waitForCompletion()
	})

	it("returns chunks in stream order", async () => {
		const coordinator = new StreamChunkCoordinator(
			makeStream([{ type: "text", text: "a" }, { type: "reasoning", reasoning: "r" }]),
			{ onUsageChunk: () => {} },
		)

		expect((await coordinator.nextChunk())?.type).to.equal("text")
		expect((await coordinator.nextChunk())?.type).to.equal("reasoning")
		expect(await coordinator.nextChunk()).to.equal(undefined)
	})

	it("rethrows when the underlying stream errors", async () => {
		const badStream = {
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					throw new Error("stream boom")
				},
				return: async () => ({ value: undefined, done: true }),
			}),
		} as unknown as ApiStream
		const coordinator = new StreamChunkCoordinator(badStream, { onUsageChunk: () => {} })

		await assert.rejects(() => coordinator.nextChunk(), /stream boom/)
	})

	it("closes the stream iterator on stop", async () => {
		let closed = false
		const coordinator = new StreamChunkCoordinator(makeStream([{ type: "text", text: "a" }], () => (closed = true)), {
			onUsageChunk: () => {},
		})
		await coordinator.stop()
		expect(closed).to.equal(true)
	})
})
