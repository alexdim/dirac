import "should"
import { buildResponseCreateParams, processResponsesEvents, shouldRetryWithFullContext } from "../openai-responses-utils"

// Characterization tests for shouldRetryWithFullContext.
// The function decides whether a failed request should be retried with the full
// conversation context (no previous_response_id) — only when there was a previous
// response id AND the error indicates that id is no longer known to the server.
describe("shouldRetryWithFullContext", () => {
	it("returns false when there was no previous response id", () => {
		shouldRetryWithFullContext({ status: 404, message: "not found" }, false).should.equal(false)
	})

	it("returns true for previous_response_not_found error code", () => {
		shouldRetryWithFullContext({ code: "previous_response_not_found", message: "x" }, true).should.equal(true)
	})

	it("returns true when message contains previous_response_not_found", () => {
		shouldRetryWithFullContext(new Error("previous_response_not_found in stream"), true).should.equal(true)
	})

	it("returns true for HTTP 404 status", () => {
		shouldRetryWithFullContext({ status: 404, message: "missing" }, true).should.equal(true)
	})

	it("returns true when message contains 404 string", () => {
		shouldRetryWithFullContext(new Error("got 404 from server"), true).should.equal(true)
	})

	it("returns false for 404 with details.param === 'input' (item-level 404)", () => {
		shouldRetryWithFullContext({ status: 404, message: "missing", details: { param: "input" } }, true).should.equal(false)
	})

	it("does not retry websocket transport failures as full-context requests", () => {
		shouldRetryWithFullContext({ code: "websocket_closed", message: "x" }, true).should.equal(false)
		shouldRetryWithFullContext({ code: "websocket_error", message: "x" }, true).should.equal(false)
	})

	it("returns false for unrelated errors", () => {
		shouldRetryWithFullContext({ status: 500, message: "server error" }, true).should.equal(false)
	})
})

describe("buildResponseCreateParams", () => {
	const baseArgs = {
		modelId: "gpt-test",
		systemPrompt: "You are helpful.",
		input: [] as any,
		tools: [{ type: "function", name: "read_file", parameters: { type: "object" }, strict: true }] as any,
	}

	it("includes parallel_tool_calls when enabled", () => {
		const params = buildResponseCreateParams({ ...baseArgs, enableParallelToolCalling: true }) as any
		params.parallel_tool_calls.should.equal(true)
	})

	it("includes parallel_tool_calls when disabled", () => {
		const params = buildResponseCreateParams({ ...baseArgs, enableParallelToolCalling: false }) as any
		params.parallel_tool_calls.should.equal(false)
	})

	it("includes all-turn reasoning context only when explicitly requested", () => {
		const params = buildResponseCreateParams({ ...baseArgs, reasoningContext: "all_turns" }) as any
		params.reasoning.context.should.equal("all_turns")
	})

	it("stores a continued response when explicitly requested", () => {
		const params = buildResponseCreateParams({ ...baseArgs, previousResponseId: "resp_123", store: true }) as any
		params.store.should.equal(true)
	})
})
describe("processResponsesEvents", () => {
	it("separates OpenAI reasoning summary parts into distinct paragraphs", async () => {
		async function* stream() {
			yield {
				type: "response.reasoning_summary_part.added",
				item_id: "reasoning-1",
				summary_index: 0,
				part: { text: "" },
			}
			yield {
				type: "response.reasoning_summary_text.delta",
				item_id: "reasoning-1",
				summary_index: 0,
				delta: "**Planning layout restoration**",
			}
			yield {
				type: "response.reasoning_summary_part.done",
				item_id: "reasoning-1",
				summary_index: 0,
				part: { text: "**Planning layout restoration**" },
			}
			yield {
				type: "response.reasoning_summary_part.added",
				item_id: "reasoning-1",
				summary_index: 1,
				part: { text: "" },
			}
			yield {
				type: "response.reasoning_summary_text.delta",
				item_id: "reasoning-1",
				summary_index: 1,
				delta: "**Refining spacing**",
			}
		}

		const chunks: any[] = []
		for await (const chunk of processResponsesEvents(stream() as any, {} as any)) chunks.push(chunk)

		const reasoning = chunks
			.filter((chunk) => chunk.type === "reasoning")
			.map((chunk) => chunk.reasoning)
			.join("")
		reasoning.should.equal("**Planning layout restoration**\n\n**Refining spacing**")
	})
})
