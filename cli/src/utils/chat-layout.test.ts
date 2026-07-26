import { describe, expect, it } from "vitest"
import { calculateChatLayoutRows, calculatePermissionModalLayout } from "./chat-layout"

describe("calculateChatLayoutRows", () => {
	it.each([1, 2, 6, 12, 24])("keeps allocations within a %i-row terminal", (terminalRows) => {
		const layout = calculateChatLayoutRows({
			terminalRows,
			hasConversationContent: true,
			hasComposer: true,
			hasFooter: true,
			hasPanel: false,
		})
		expect(layout.liveViewportRows).toBeGreaterThanOrEqual(1)
		expect(layout.liveViewportRows).toBeLessThanOrEqual(Math.max(1, terminalRows))
		expect(layout.activeContentRows).toBeLessThanOrEqual(layout.liveViewportRows)
	})
})
describe("stable live viewport", () => {
	it("keeps the same allocation while activity content changes", () => {
		const layout = calculateChatLayoutRows({
			terminalRows: 40,
			hasConversationContent: true,
			hasComposer: true,
			hasFooter: true,
			hasPanel: false,
		})

		expect(layout).toEqual({
			liveViewportRows: 17,
			activeContentRows: 13,
			compactHistoryRows: 3,
		})
	})
})

describe("calculatePermissionModalLayout", () => {
	it.each([
		[1, 1],
		[8, 5],
		[40, 12],
		[120, 50],
	])("fits within a %i×%i terminal", (columns, rows) => {
		const layout = calculatePermissionModalLayout(columns, rows)
		expect(layout.width).toBeGreaterThanOrEqual(1)
		expect(layout.height).toBeGreaterThanOrEqual(1)
		expect(layout.width).toBeLessThanOrEqual(columns)
		expect(layout.height).toBeLessThanOrEqual(rows)
		expect(layout.bodyColumns).toBeGreaterThanOrEqual(1)
		expect(layout.bodyLines).toBeGreaterThanOrEqual(1)
	})
})
