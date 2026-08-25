import "should"
import sinon from "sinon"
import { deepSeekModels } from "@/shared/api"
import { DeepSeekHandler } from "../deepseek"

const createAsyncIterable = (data: any[] = []) => ({
	[Symbol.asyncIterator]: async function* () {
		yield* data
	},
})

describe("DeepSeekHandler", () => {
	afterEach(() => sinon.restore())

	it("registers DeepSeek V4 Flash Vision Exp with image support", () => {
		deepSeekModels["deepseek-v4-flash-vision-exp"].should.deepEqual({
			maxTokens: 384_000,
			contextWindow: 1_048_576,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsReasoningEffort: true,
			supportsTools: true,
			inputPrice: 0,
			outputPrice: 0.66,
			cacheWritesPrice: 0.22,
			cacheReadsPrice: 0.007,
			pricingSchedule: {
				timeZone: "UTC",
				defaultLabel: "Off-peak",
				periods: [
					{
						label: "Peak",
						weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
						startMinuteUtc: 60,
						endMinuteUtc: 240,
						prices: { inputPrice: 0, outputPrice: 1.32, cacheWritesPrice: 0.44, cacheReadsPrice: 0.014 },
					},
					{
						label: "Peak",
						weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
						startMinuteUtc: 360,
						endMinuteUtc: 600,
						prices: { inputPrice: 0, outputPrice: 1.32, cacheWritesPrice: 0.44, cacheReadsPrice: 0.014 },
					},
				],
			},
		})
	})

	it("registers the updated DeepSeek V4 Flash and Pro rates", () => {
		const flash = deepSeekModels["deepseek-v4-flash"]
		flash.outputPrice!.should.equal(0.66)
		flash.cacheWritesPrice!.should.equal(0.22)
		flash.cacheReadsPrice!.should.equal(0.007)
		flash.pricingSchedule.periods[0].prices.should.deepEqual({
			inputPrice: 0,
			outputPrice: 1.32,
			cacheWritesPrice: 0.44,
			cacheReadsPrice: 0.014,
		})

		const pro = deepSeekModels["deepseek-v4-pro"]
		pro.outputPrice!.should.equal(1.98)
		pro.cacheWritesPrice!.should.equal(0.66)
		pro.cacheReadsPrice!.should.equal(0.022)
		pro.pricingSchedule.periods[0].prices.should.deepEqual({
			inputPrice: 0,
			outputPrice: 3.96,
			cacheWritesPrice: 1.32,
			cacheReadsPrice: 0.044,
		})
	})

	it("sends images to DeepSeek V4 Flash Vision Exp as OpenAI image URL blocks", async () => {
		const create = sinon.stub().resolves(createAsyncIterable())
		const handler = new DeepSeekHandler({
			deepSeekApiKey: "test-api-key",
			apiModelId: "deepseek-v4-flash-vision-exp",
		})
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create } } })

		for await (const _chunk of handler.createMessage("system", [
			{
				role: "user",
				content: [
					{ type: "text", text: "What is in this image?" },
					{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
				],
			},
		])) {
			// Consume the stream so the request is issued.
		}

		const request = create.firstCall.args[0]
		request.model.should.equal("deepseek-v4-flash-vision-exp")
		request.max_tokens.should.equal(384_000)
		request.messages.should.deepEqual([
			{ role: "system", content: "system" },
			{
				role: "user",
				content: [
					{ type: "text", text: "What is in this image?" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
				],
			},
		])
	})

	it("sends images returned by tools in a following user message", async () => {
		const create = sinon.stub().resolves(createAsyncIterable())
		const handler = new DeepSeekHandler({
			deepSeekApiKey: "test-api-key",
			apiModelId: "deepseek-v4-flash-vision-exp",
		})
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create } } })

		for await (const _chunk of handler.createMessage("system", [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "call_1", name: "read_file", input: {} }],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: [
							{ type: "text", text: "Successfully read image" },
							{
								type: "image",
								source: { type: "base64", media_type: "image/png", data: "BASE64_SENTINEL" },
							},
						],
					},
				],
			},
		])) {
			// Consume the stream so the request is issued.
		}

		create.firstCall.args[0].messages.should.deepEqual([
			{ role: "system", content: "system" },
			{
				role: "assistant",
				content: "",
				tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
				reasoning_content: "",
			},
			{
				role: "tool",
				tool_call_id: "call_1",
				content: "Successfully read image\n(see following user message for image)",
			},
			{
				role: "user",
				content: [{ type: "image_url", image_url: { url: "data:image/png;base64,BASE64_SENTINEL" } }],
			},
		])
	})
})
