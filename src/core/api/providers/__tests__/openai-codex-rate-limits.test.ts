import "should"
import { processResponsesEvents } from "../openai-responses-utils"

describe("OpenAI Codex live rate-limit events", () => {
	it("passes codex.rate_limits to the callback without emitting an API stream chunk", async () => {
		const event = {
			type: "codex.rate_limits",
			plan_type: "plus",
			rate_limits: { primary: { used_percent: 32, window_minutes: 300 } },
		}
		async function* stream() {
			yield event
			yield { type: "response.output_text.delta", item_id: "message-1", delta: "hello" }
		}

		const received: unknown[] = []
		const chunks: any[] = []
		for await (const chunk of processResponsesEvents(stream() as any, {} as any, {
			onRateLimits: (update) => received.push(update),
		})) {
			chunks.push(chunk)
		}

		received.should.deepEqual([event])
		chunks.should.deepEqual([{ id: "message-1", type: "text", text: "hello" }])
	})

	it("remains source-compatible when no rate-limit callback is supplied", async () => {
		async function* stream() {
			yield { type: "codex.rate_limits", plan_type: "pro" }
		}

		const chunks: any[] = []
		for await (const chunk of processResponsesEvents(stream() as any, {} as any)) chunks.push(chunk)
		chunks.should.deepEqual([])
	})
})
