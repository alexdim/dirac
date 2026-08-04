import "should"
import sinon from "sinon"
import { FireworksHandler } from "../fireworks"

describe("FireworksHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	it("should handle usage-only chunks when delta is missing", async () => {
		const handler = new FireworksHandler({
			fireworksApiKey: "test-api-key",
			fireworksModelId: "accounts/fireworks/models/llama-v3p1-8b-instruct",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 19,
									completion_tokens: 4,
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		sinon.stub(handler, "getModel").returns({
			id: "accounts/fireworks/models/llama-v3p1-8b-instruct" as any,
			info: { inputPrice: 0, outputPrice: 0, cacheWritesPrice: 0, cacheReadsPrice: 0 } as any,
		})

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				inputTokens: 19,
				outputTokens: 4,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
		])
	})

	it("should emit each tool call delta once", async () => {
		const handler = new FireworksHandler({
			fireworksApiKey: "test-api-key",
			fireworksModelId: "accounts/fireworks/models/llama-v3p1-8b-instruct",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [
									{
										delta: {
											tool_calls: [
												{
													index: 0,
													id: "call_1",
													type: "function",
													function: { name: "read_file", arguments: "{}" },
												},
											],
										},
									},
								],
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.length.should.equal(1)
		chunks[0].type.should.equal("tool_calls")
		chunks[0].tool_call.call_id.should.equal("call_1")
	})
})
