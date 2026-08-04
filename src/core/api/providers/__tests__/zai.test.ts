import "should"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { ZAiHandler } from "../zai"

describe("ZAiHandler", () => {
	afterEach(() => sinon.restore())

	it("does not log streamed response content", async () => {
		const sensitiveText = "private response content"
		const stream = {
			[Symbol.asyncIterator]: async function* () {
				yield { choices: [{ delta: { content: sensitiveText } }] }
			},
		}
		const handler = new ZAiHandler({ zaiApiKey: "test-key" })
		sinon.stub(handler as any, "ensureClient").returns({
			chat: { completions: { create: sinon.stub().resolves(stream) } },
		})
		const log = sinon.stub(Logger, "info")
		const chunks: any[] = []

		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hello" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([{ type: "text", text: sensitiveText }])
		sinon.assert.notCalled(log)
	})

	it("does not count cached prompt tokens twice", async () => {
		const stream = {
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [],
					usage: {
						prompt_tokens: 1200,
						completion_tokens: 50,
						prompt_tokens_details: { cached_tokens: 800 },
					},
				}
			},
		}
		const handler = new ZAiHandler({ zaiApiKey: "test-key" })
		sinon.stub(handler as any, "ensureClient").returns({
			chat: { completions: { create: sinon.stub().resolves(stream) } },
		})
		const chunks: any[] = []

		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hello" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				inputTokens: 400,
				outputTokens: 50,
				cacheReadTokens: 800,
				cacheWriteTokens: 0,
				reasoningTokens: 0,
			},
		])
	})
})
