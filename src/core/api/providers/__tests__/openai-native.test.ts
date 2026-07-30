import "should"
import { expect } from "chai"
import sinon from "sinon"
import { OpenAiNativeHandler } from "../openai-native"

const tools = [
	{
		type: "function",
		function: { name: "read_file", description: "", parameters: { type: "object" } },
	},
] as any

const createAsyncIterable = (events: any[] = []) => ({
	[Symbol.asyncIterator]: async function* () {
		yield* events
	},
})

const currentModelResponse = (modelId = "gpt-5.6-terra") =>
	({
		role: "assistant",
		content: "previous answer",
		id: "resp_123",
		ts: Date.now(),
		modelInfo: { providerId: "openai-native", modelId, mode: "act" },
	}) as any

function createHandler(
	createStub: sinon.SinonStub,
	options: { modelId?: string; compactStub?: sinon.SinonStub } = {},
): OpenAiNativeHandler {
	const handler = new OpenAiNativeHandler({
		openAiNativeApiKey: "test-api-key",
		apiModelId: options.modelId ?? "gpt-5.6-terra",
	})
	sinon.stub(handler as any, "ensureClient").returns({
		responses: { create: createStub, compact: options.compactStub ?? sinon.stub() },
	})
	sinon.stub(handler as any, "useWebsocketMode").returns(false)
	return handler
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const chunks: unknown[] = []
	for await (const chunk of stream) chunks.push(chunk)
	return chunks
}

describe("OpenAiNativeHandler persisted reasoning", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("continues a supported model with all-turn reasoning context", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable())
		const handler = createHandler(createStub)

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "old question" },
					currentModelResponse(),
					{ role: "user", content: "new question" },
				] as any,
				tools,
			),
		)

		const params = createStub.firstCall.args[0]
		params.previous_response_id.should.equal("resp_123")
		params.reasoning.context.should.equal("all_turns")
		params.store.should.equal(true)
		params.input.should.have.length(1)
	})


	it("preserves Responses call IDs for persisted-reasoning tool results", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable())
		const handler = createHandler(createStub)

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "read the file" },
					{
						role: "assistant",
						id: "resp_123",
						modelInfo: { providerId: "openai-native", modelId: "gpt-5.6-terra", mode: "act" },
						content: [{ type: "tool_use", id: "fc_local", call_id: "call_server", name: "read_file", input: {} }],
					},
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "fc_local", content: "contents" }] },
				] as any,
				tools,
			),
		)

		createStub.firstCall.args[0].input.should.deepEqual([
			{ type: "function_call_output", call_id: "call_server", output: "contents" },
		])
	})

	it("does not enable persisted reasoning for unsupported models", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable())
		const handler = createHandler(createStub, { modelId: "gpt-5.5" })

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "old question" },
					currentModelResponse("gpt-5.5"),
					{ role: "user", content: "new" },
				] as any,
				tools,
			),
		)

		const params = createStub.firstCall.args[0]
		expect(params.previous_response_id).to.equal(undefined)
		expect(params.reasoning?.context).to.equal(undefined)
		params.input.should.have.length(3)
	})


	it("does not chain from a response created by another model", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable())
		const handler = createHandler(createStub)

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "old question" },
					currentModelResponse("gpt-5.6-luna"),
					{ role: "user", content: "new" },
				] as any,
				tools,
			),
		)

		const params = createStub.firstCall.args[0]
		expect(params.previous_response_id).to.equal(undefined)
		params.reasoning.context.should.equal("all_turns")
		params.input.should.have.length(3)
	})

	it("does not chain from a response created by another provider", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable())
		const handler = createHandler(createStub)
		const response = currentModelResponse()
		response.modelInfo.providerId = "openai-codex"

		await drain(
			handler.createMessage(
				"system",
				[{ role: "user", content: "old question" }, response, { role: "user", content: "new" }] as any,
				tools,
			),
		)

		const params = createStub.firstCall.args[0]
		expect(params.previous_response_id).to.equal(undefined)
		params.reasoning.context.should.equal("all_turns")
		params.input.should.have.length(3)
	})

	it("retries a missing previous response with full context and all-turn reasoning", async () => {
		const missingResponse = Object.assign(new Error("missing response"), { status: 404 })
		const createStub = sinon.stub()
		createStub.onFirstCall().rejects(missingResponse)
		createStub.onSecondCall().resolves(createAsyncIterable())
		const handler = createHandler(createStub)

		await drain(
			handler.createMessage(
				"system",
				[{ role: "user", content: "old question" }, currentModelResponse(), { role: "user", content: "new" }] as any,
				tools,
			),
		)

		createStub.callCount.should.equal(2)
		const fallbackParams = createStub.secondCall.args[0]
		expect(fallbackParams.previous_response_id).to.equal(undefined)
		fallbackParams.reasoning.context.should.equal("all_turns")
		fallbackParams.store.should.equal(true)
		fallbackParams.input.should.have.length(3)
	})

	it("does not retry after response output has already been emitted", async () => {
		const missingResponse = Object.assign(new Error("missing response"), { status: 404 })
		const interruptedStream = {
			[Symbol.asyncIterator]: async function* () {
				yield { type: "response.output_text.delta", item_id: "msg_1", delta: "partial" }
				throw missingResponse
			},
		}
		const createStub = sinon.stub().resolves(interruptedStream)
		const handler = createHandler(createStub)
		const chunks: any[] = []
		let caught: unknown

		try {
			for await (const chunk of handler.createMessage(
				"system",
				[currentModelResponse(), { role: "user", content: "new" }] as any,
				tools,
			)) {
				chunks.push(chunk)
			}
		} catch (error) {
			caught = error
		}

		createStub.callCount.should.equal(1)
		chunks.should.deepEqual([{ id: "msg_1", type: "text", text: "partial" }])
		expect(caught).to.equal(missingResponse)
	})

	it("compacts Responses input into opaque replacement items", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable())
		const replacement = [
			{ role: "user", content: [{ type: "input_text", text: "retained" }] },
			{ id: "cmp_1", type: "compaction", encrypted_content: "opaque-state" },
		]
		const compactStub = sinon.stub().resolves({ output: replacement })
		const handler = createHandler(createStub, { compactStub })

		const result = await handler.compactConversation({
			systemPrompt: "system",
			messages: [{ role: "user", content: "question" }] as any,
			tools,
		})

		result.input.should.deepEqual(replacement)
		const body = compactStub.firstCall.args[0]
		expect(body.previous_response_id).to.equal(undefined)
		expect(body.stream).to.equal(undefined)
		body.reasoning.context.should.equal("all_turns")
	})

	it("uses a compact checkpoint before establishing a new persisted-reasoning branch", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable())
		const handler = createHandler(createStub)
		const checkpoint = {
			providerId: "openai-native",
			modelId: "gpt-5.6-terra",
			compactedThroughHistoryIndex: 2,
			input: [
				{ role: "user", content: [{ type: "input_text", text: "retained" }] },
				{ id: "cmp_1", type: "compaction", encrypted_content: "opaque-state" },
			],
		}

		await drain(handler.createMessage("system", [], tools, { checkpoint, breakProviderContinuation: true }))
		const newResponse = currentModelResponse() as any
		newResponse.id = "resp_new"
		await drain(handler.createMessage("system", [newResponse, { role: "user", content: "next" }] as any, tools, { checkpoint }))

		const first = createStub.firstCall.args[0]
		expect(first.previous_response_id).to.equal(undefined)
		first.input.should.deepEqual(checkpoint.input)
		const second = createStub.secondCall.args[0]
		second.previous_response_id.should.equal("resp_new")
		second.input.should.have.length(1)
	})

	it("does not reuse a stale response ID after local compaction fallback", async () => {
		const createStub = sinon.stub().resolves(createAsyncIterable())
		const handler = createHandler(createStub)

		await drain(
			handler.createMessage(
				"system",
				[currentModelResponse(), { role: "user", content: "continue from summary" }] as any,
				tools,
				{ breakProviderContinuation: true },
			),
		)

		const params = createStub.firstCall.args[0]
		expect(params.previous_response_id).to.equal(undefined)
		params.input.should.have.length(2)
	})

})
