import { describe, expect, it } from "vitest"
import {
	formatOpenAiCodexActivityDate,
	formatOpenAiCodexFreshness,
	formatOpenAiCodexPlan,
	formatOpenAiCodexRemaining,
	formatOpenAiCodexReset,
	formatOpenAiCodexWindowDuration,
	getOpenAiCodexQuotaFetchedAt,
	selectOpenAiCodexDisplayWindows,
} from "./formatOpenAiCodexUsage"

describe("OpenAI Codex usage formatting", () => {
	it("formats remaining percentage without threshold language", () => {
		expect(formatOpenAiCodexRemaining(32)).toBe("68% remaining")
		expect(formatOpenAiCodexRemaining(99.5)).toBe("<1% remaining")
		expect(formatOpenAiCodexRemaining(100)).toBe("0% remaining")
	})

	it("maps known windows by backend duration", () => {
		const bucket = { limitId: "codex" }
		expect(formatOpenAiCodexWindowDuration(300, "primary", bucket)).toBe("5-hour")
		expect(formatOpenAiCodexWindowDuration(10_080, "secondary", bucket)).toBe("Weekly")
	})

	it("normalizes known plans and safely humanizes unknown plans", () => {
		expect(formatOpenAiCodexPlan("self_serve_business_usage_based")).toBe("Business usage based")
		expect(formatOpenAiCodexPlan("future_special_plan")).toBe("Future Special Plan")
	})

	it("sorts the codex bucket first and windows by duration", () => {
		const result = selectOpenAiCodexDisplayWindows({
			rateLimits: [
				{ limitId: "images", limitName: "Images", primary: { usedPercent: 5 } },
				{
					limitId: "codex",
					primary: { usedPercent: 10, windowMinutes: 10_080 },
					secondary: { usedPercent: 20, windowMinutes: 300 },
				},
			],
		})
		expect(result.map((item) => `${item.bucket.limitId}:${item.label}`)).toEqual([
			"codex:5-hour",
			"codex:Weekly",
			"images:Images",
		])
	})

	it("marks old data neutrally and formats same-day reset text", () => {
		const now = new Date("2026-07-29T12:00:00").getTime()
		expect(formatOpenAiCodexFreshness(now - 16 * 60_000, now)).toBe("Updated 16m ago · May be outdated")
		expect(formatOpenAiCodexReset(new Date("2026-07-29T14:00:00").getTime() / 1_000, now)).toContain("Resets today")
	})

	it("keeps quota and activity freshness separate", () => {
		expect(getOpenAiCodexQuotaFetchedAt({ rateLimits: [], quotaFetchedAt: 100, activityFetchedAt: 200 })).toBe(100)
	})

	it("formats date-only activity buckets as local calendar dates", () => {
		const expected = new Date(2026, 6, 28).toLocaleDateString(undefined, { month: "short", day: "numeric" })
		expect(formatOpenAiCodexActivityDate("2026-07-28")).toBe(expected)
	})

})
