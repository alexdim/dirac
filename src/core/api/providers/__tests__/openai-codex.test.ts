import "should"
import { expect } from "chai"
import sinon from "sinon"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { expectLoggerErrors } from "@/test/loggerGuard"
import { OpenAiCodexHandler } from "../openai-codex"

const tools = [
	{
		type: "function",
		function: { name: "read_file", description: "", parameters: { type: "object" } },
	},
] as any

function currentCodexResponse(modelId = "gpt-5.6-terra") {
	return {
		role: "assistant",
		content: "previous answer",
		id: "resp_123",
		ts: Date.now(),
		modelInfo: { providerId: "openai-codex", modelId, mode: "act" },
	} as any
}

function createHandler(modelId = "gpt-5.6-terra"): OpenAiCodexHandler {
	return new OpenAiCodexHandler({ apiModelId: modelId })
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const chunks: unknown[] = []
	for await (const chunk of stream) chunks.push(chunk)
	return chunks
}

describe("OpenAiCodexHandler persisted reasoning", () => {
	beforeEach(() => {
		sinon.stub(openAiCodexOAuthManager, "getAccessToken").resolves("test-access-token")
		sinon.stub(openAiCodexOAuthManager, "getAccountId").resolves(null)
	})

	afterEach(() => {
		sinon.restore()
	})

	it("continues an allowlisted Codex model over Responses WebSocket", async () => {
		const handler = createHandler()
		const requests: any[] = []
		sinon.stub(handler as any, "createResponseStreamWebsocket").callsFake(async function* (request: any) {
			requests.push(request)
		})

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "old question" },
					currentCodexResponse(),
					{ role: "user", content: "new question" },
				] as any,
				tools,
			),
		)

		requests.should.have.length(1)
		requests[0].previous_response_id.should.equal("resp_123")
		requests[0].reasoning.context.should.equal("all_turns")
		requests[0].store.should.equal(false)
		requests[0].input.should.have.length(1)
	})

	it("does not chain a response created by another provider", async () => {
		const handler = createHandler()
		const requests: any[] = []
		sinon.stub(handler as any, "createResponseStreamWebsocket").callsFake(async function* (request: any) {
			requests.push(request)
		})

		const response = currentCodexResponse()
		response.modelInfo.providerId = "openai-native"
		await drain(
			handler.createMessage(
				"system",
				[{ role: "user", content: "old question" }, response, { role: "user", content: "new question" }] as any,
				tools,
			),
		)

		expect(requests[0].previous_response_id).to.equal(undefined)
		requests[0].input.should.have.length(3)
	})

	it("does not chain a Codex response from another model", async () => {
		const handler = createHandler()
		const requests: any[] = []
		sinon.stub(handler as any, "createResponseStreamWebsocket").callsFake(async function* (request: any) {
			requests.push(request)
		})

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "old question" },
					currentCodexResponse("gpt-5.6-luna"),
					{ role: "user", content: "new question" },
				] as any,
				tools,
			),
		)

		expect(requests[0].previous_response_id).to.equal(undefined)
		requests[0].reasoning.context.should.equal("all_turns")
		requests[0].store.should.equal(false)
		requests[0].input.should.have.length(3)
	})

	it("does not enable persisted reasoning for an unsupported Codex model", async () => {
		const handler = createHandler("gpt-5.5")
		const requests: any[] = []
		sinon.stub(handler as any, "createResponseStreamHttp").callsFake(async function* (request: any) {
			requests.push(request)
		})

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "old question" },
					currentCodexResponse("gpt-5.5"),
					{ role: "user", content: "new question" },
				] as any,
				tools,
			),
		)

		requests.should.have.length(1)
		expect(requests[0].previous_response_id).to.equal(undefined)
		expect(requests[0].reasoning?.context).to.equal(undefined)
		requests[0].store.should.equal(false)
		requests[0].input.should.have.length(3)
	})

	it("retries a missing previous response with persisted full context before output", async () => {
		const handler = createHandler()
		const requests: any[] = []
		const missingResponse = Object.assign(new Error("missing response"), { status: 404 })
		const websocketStub = sinon.stub(handler as any, "createResponseStreamWebsocket")
		websocketStub.onFirstCall().callsFake(async function* (request: any) {
			requests.push(request)
			throw missingResponse
		})
		websocketStub.onSecondCall().callsFake(async function* (request: any) {
			requests.push(request)
		})

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "old question" },
					currentCodexResponse(),
					{ role: "user", content: "new question" },
				] as any,
				tools,
			),
		)

		requests.should.have.length(2)
		requests[0].previous_response_id.should.equal("resp_123")
		expect(requests[1].previous_response_id).to.equal(undefined)
		requests[1].reasoning.context.should.equal("all_turns")
		requests[1].store.should.equal(false)
		requests[1].input.should.have.length(3)
	})

	it("does not retry a missing previous response after output", async () => {
		const handler = createHandler()
		const missingResponse = Object.assign(new Error("missing response"), { status: 404 })
		const websocketStub = sinon.stub(handler as any, "createResponseStreamWebsocket").callsFake(async function* () {
			yield { type: "text", id: "msg_1", text: "partial" }
			throw missingResponse
		})
		const chunks: any[] = []
		let caught: unknown

		try {
			for await (const chunk of handler.createMessage(
				"system",
				[currentCodexResponse(), { role: "user", content: "new question" }] as any,
				tools,
			)) {
				chunks.push(chunk)
			}
		} catch (error) {
			caught = error
		}

		websocketStub.callCount.should.equal(1)
		chunks.should.deepEqual([{ type: "text", id: "msg_1", text: "partial" }])
		expect(caught).to.equal(missingResponse)
	})

	it("falls back to a non-chained, non-persistent HTTP request when the WebSocket is unavailable", async () => {
		expectLoggerErrors()
		const handler = createHandler()
		const websocketFailure = new Error("Responses websocket closed before opening")
		sinon.stub(handler as any, "createResponseStreamWebsocket").callsFake(async function* () {
			throw websocketFailure
		})
		const httpRequests: any[] = []
		sinon.stub(handler as any, "createResponseStreamHttp").callsFake(async function* (request: any) {
			httpRequests.push(request)
		})

		await drain(
			handler.createMessage(
				"system",
				[
					{ role: "user", content: "old question" },
					currentCodexResponse(),
					{ role: "user", content: "new question" },
				] as any,
				tools,
			),
		)

		httpRequests.should.have.length(1)
		expect(httpRequests[0].previous_response_id).to.equal(undefined)
		httpRequests[0].reasoning.context.should.equal("all_turns")
		httpRequests[0].store.should.equal(false)
		httpRequests[0].input.should.have.length(3)
	})
})
