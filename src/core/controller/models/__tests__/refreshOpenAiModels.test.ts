import { afterEach, describe, it } from "mocha"
import "should"
import { OpenAiModelsRequest } from "@shared/proto/dirac/models"
import axios from "axios"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { refreshOpenAiModels } from "../refreshOpenAiModels"

describe("refreshOpenAiModels", () => {
	afterEach(() => sinon.restore())

	it("normalizes a chat completions URL before discovering models", async () => {
		const get = sinon.stub(axios, "get").resolves({ data: { data: [{ id: "gpt-test" }] } })

		const result = await refreshOpenAiModels(
			undefined as any,
			OpenAiModelsRequest.create({
				baseUrl: "https://provider.example/v1/chat/completions/",
				apiKey: "test-key",
			}),
		)

		result.values.should.deepEqual(["gpt-test"])
		sinon.assert.calledOnceWithExactly(
			get,
			"https://provider.example/v1/models",
			sinon.match({
				headers: { Authorization: "Bearer test-key" },
			}),
		)
	})

	it("warns when the provider does not expose a models endpoint", async () => {
		const warn = sinon.stub(Logger, "warn")
		const error = sinon.stub(Logger, "error")
		sinon.stub(axios, "get").rejects({ isAxiosError: true, response: { status: 404 } })

		const result = await refreshOpenAiModels(
			undefined as any,
			OpenAiModelsRequest.create({ baseUrl: "https://provider.example/v1" }),
		)

		result.values.should.deepEqual([])
		sinon.assert.calledOnceWithExactly(
			warn,
			"Configured OpenAI-compatible provider does not support model discovery at /models",
		)
		sinon.assert.notCalled(error)
	})

	it("logs HTTP 400 responses instead of misreporting them as unsupported discovery", async () => {
		const warn = sinon.stub(Logger, "warn")
		const error = sinon.stub(Logger, "error")
		const requestError = { isAxiosError: true, response: { status: 400 } }
		sinon.stub(axios, "get").rejects(requestError)

		const result = await refreshOpenAiModels(
			undefined as any,
			OpenAiModelsRequest.create({ baseUrl: "https://provider.example/v1" }),
		)

		result.values.should.deepEqual([])
		sinon.assert.notCalled(warn)
		sinon.assert.calledOnceWithExactly(error, "Error fetching OpenAI models:", requestError)
	})
})
