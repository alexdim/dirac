import { DiracMessageType, type DiracMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { createDynamicTimelineItems } from "./useChatTimeline"

const message: DiracMessage = {
	id: "long-card",
	ts: 1,
	content: {
		type: DiracMessageType.CARD,
		card: {
			id: "long-card",
			header: "Long card",
			status: "success" as any,
			renderType: "text",
			body: Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"),
		},
	},
}

const layoutRows = {
	liveViewportRows: 6,
	activeContentRows: 3,
	compactHistoryRows: 2,
}

describe("createDynamicTimelineItems card suppression", () => {
	it("does not allocate body rows or scrolling for a suppressed card", () => {
		const plan = createDynamicTimelineItems([message], undefined, layoutRows, 80, 0, () => true)
		const item = plan.items[0]

		expect(plan.maxScrollOffset).toBe(0)
		expect(item.type).toBe("message")
		if (item.type === "message") expect(item.maxContentLines).toBeUndefined()
	})

	it("allocates scrolling for the same card when its body is visible", () => {
		const plan = createDynamicTimelineItems([message], undefined, layoutRows, 80, 0, () => false)
		expect(plan.maxScrollOffset).toBeGreaterThan(0)
	})
})
