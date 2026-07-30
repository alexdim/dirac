import assert from "node:assert/strict"
import { describe, it } from "mocha"
import {
	mergeOpenAiCodexRollingUsage,
	normalizeOpenAiCodexActivityPayload,
	normalizeOpenAiCodexUsagePayload,
	parseOpenAiCodexRateLimitEvent,
	parseOpenAiCodexRateLimitHeaders,
	selectOpenAiCodexDisplayWindows,
	type OpenAiCodexUsageSnapshot,
} from "@shared/openai-codex-usage"

describe("OpenAI Codex usage normalization", () => {
	it("normalizes complete quota, credits, spend control, and additional limits", () => {
		const fetchedAt = Date.UTC(2026, 6, 29, 12)
		const snapshot = normalizeOpenAiCodexUsagePayload(
			{
				plan_type: "plus",
				rate_limit: {
					allowed: true,
					limit_reached: false,
					primary_window: {
						used_percent: 32,
						limit_window_seconds: 18_000,
						reset_after_seconds: 120,
						reset_at: null,
					},
					secondary_window: {
						used_percent: 58,
						limit_window_seconds: 604_800,
						reset_at: 1_800_000_000,
					},
				},
				credits: { has_credits: true, unlimited: false, balance: "12.50" },
				spend_control: {
					reached: false,
					individual_limit: {
						source: "workspace",
						limit: "100",
						used: "25",
						remaining: "75",
						used_percent: 25,
						remaining_percent: 75,
						reset_after_seconds: 600,
						reset_at: null,
					},
				},
				additional_rate_limits: [
					{
						limit_name: "Cloud tasks",
						metered_feature: "cloud_tasks",
						rate_limit: {
							primary_window: {
								used_percent: 10,
								limit_window_seconds: 86_400,
								reset_at: 1_800_000_100,
							},
						},
					},
				],
				rate_limit_reached_type: { type: "workspace_member_usage_limit_reached" },
				rate_limit_reset_credits: { available_count: 3 },
			},
			fetchedAt,
		)

		assert.equal(snapshot.planType, "plus")
		assert.equal(snapshot.quotaFetchedAt, fetchedAt)
		assert.deepEqual(snapshot.rateLimits, [
			{
				limitId: "codex",
				limitName: undefined,
				primary: { usedPercent: 32, windowMinutes: 300, resetsAt: fetchedAt / 1000 + 120 },
				secondary: { usedPercent: 58, windowMinutes: 10_080, resetsAt: 1_800_000_000 },
			},
			{
				limitId: "cloud_tasks",
				limitName: "Cloud tasks",
				primary: { usedPercent: 10, windowMinutes: 1_440, resetsAt: 1_800_000_100 },
				secondary: undefined,
			},
		])
		assert.deepEqual(snapshot.credits, { hasCredits: true, unlimited: false, balance: "12.50" })
		assert.deepEqual(snapshot.spendControl, {
			reached: false,
			individualLimit: {
				source: "workspace",
				limit: "100",
				used: "25",
				remaining: "75",
				usedPercent: 25,
				remainingPercent: 75,
				resetsAt: fetchedAt / 1000 + 600,
			},
		})
		assert.equal(snapshot.rateLimitReachedType, "workspace_member_usage_limit_reached")
		assert.equal(snapshot.resetCreditsAvailable, 3)
	})

	it("accepts null and partial payloads while preserving unknown strings", () => {
		const snapshot = normalizeOpenAiCodexUsagePayload({
			plan_type: "future_custom_plan",
			rate_limit: { primary_window: null, secondary_window: { used_percent: 0 } },
			credits: { has_credits: null, unlimited: null, balance: null },
			spend_control: { reached: null, individual_limit: null },
			additional_rate_limits: null,
			rate_limit_reached_type: { type: "future_reached_reason" },
			rate_limit_reset_credits: null,
		})

		assert.equal(snapshot.planType, "future_custom_plan")
		assert.equal(snapshot.rateLimitReachedType, "future_reached_reason")
		assert.deepEqual(snapshot.rateLimits[0], {
			limitId: "codex",
			limitName: undefined,
			primary: undefined,
			secondary: { usedPercent: 0, windowMinutes: undefined, resetsAt: undefined },
		})
		assert.deepEqual(snapshot.credits, { hasCredits: false, unlimited: false, balance: undefined })
		assert.deepEqual(snapshot.spendControl, { reached: false, individualLimit: undefined })
	})

	it("normalizes account activity separately from quota", () => {
		const normalized = normalizeOpenAiCodexActivityPayload(
			{
				stats: {
					lifetime_tokens: 1_000_000,
					peak_daily_tokens: 25_000,
					longest_running_turn_sec: null,
					current_streak_days: 4,
					longest_streak_days: 12,
					daily_usage_buckets: [{ start_date: "2026-07-28", tokens: 1200 }],
				},
			},
			1234,
		)

		assert.equal(normalized.activityFetchedAt, 1234)
		assert.deepEqual(normalized.activity, {
			lifetimeTokens: 1_000_000,
			peakDailyTokens: 25_000,
			longestRunningTurnSec: undefined,
			currentStreakDays: 4,
			longestStreakDays: 12,
			dailyUsageBuckets: [{ startDate: "2026-07-28", tokens: 1200 }],
		})
	})
})

describe("OpenAI Codex rolling usage parsing and merge", () => {
	it("discovers default and multiple limit IDs in response headers", () => {
		const update = parseOpenAiCodexRateLimitHeaders(
			new Headers({
				"x-codex-primary-used-percent": "32",
				"x-codex-primary-window-minutes": "300",
				"x-codex-primary-reset-at": "1800000000",
				"x-codex-secondary-used-percent": "58",
				"x-cloud-tasks-primary-used-percent": "12.5",
				"x-cloud-tasks-primary-window-minutes": "1440",
				"x-cloud-tasks-limit-name": "Cloud tasks",
				"x-codex-credits-has-credits": "true",
				"x-codex-credits-unlimited": "false",
				"x-codex-credits-balance": "8.25",
				"x-codex-rate-limit-reached-type": "rate_limit_reached",
				"x-codex-promo-message": "must not be surfaced",
			}),
		)
		assert.ok(update)
		if (!update?.rateLimits) throw new Error("Expected rate limits from Codex headers")

		assert.deepEqual(update.rateLimits.find((limit) => limit.limitId === "codex"), {
			limitId: "codex",
			primary: { usedPercent: 32, windowMinutes: 300, resetsAt: 1_800_000_000 },
			secondary: { usedPercent: 58 },
		})
		assert.deepEqual(update.rateLimits.find((limit) => limit.limitId === "cloud-tasks"), {
			limitId: "cloud-tasks",
			primary: { usedPercent: 12.5, windowMinutes: 1440 },
			limitName: "Cloud tasks",
		})
		assert.deepEqual(update.credits, { hasCredits: true, unlimited: false, balance: "8.25" })
		assert.equal(update.rateLimitReachedType, "rate_limit_reached")
		assert.equal("promoMessage" in update, false)
	})

	it("ignores unrelated response headers", () => {
		assert.equal(
			parseOpenAiCodexRateLimitHeaders(new Headers({ "content-type": "text/event-stream", "request-id": "abc" })),
			undefined,
		)
	})


	it("parses sparse events and does not include promo messages", () => {
		const update = parseOpenAiCodexRateLimitEvent({
			type: "codex.rate_limits",
			plan_type: "prolite",
			rate_limits: { primary: { used_percent: 41 } },
			credits: { balance: "4.00" },
			limit_name: "Codex",
			promo_message: "switch models",
		})

		assert.deepEqual(update, {
			planType: "prolite",
			rateLimits: [{ limitId: "codex", limitName: "Codex", primary: { usedPercent: 41 } }],
			credits: { balance: "4.00" },
		})
		assert.equal(update && "promoMessage" in update, false)
		assert.equal(parseOpenAiCodexRateLimitEvent({ type: "response.completed" }), undefined)
	})

	it("sparse updates preserve prior windows and authoritative metadata", () => {
		const previous: OpenAiCodexUsageSnapshot = {
			planType: "plus",
			rateLimits: [
				{
					limitId: "codex",
					limitName: "Main",
					primary: { usedPercent: 20, windowMinutes: 300, resetsAt: 100 },
					secondary: { usedPercent: 40, windowMinutes: 10_080, resetsAt: 200 },
				},
			],
			credits: { hasCredits: true, unlimited: false, balance: "9" },
			spendControl: { reached: false },
			rateLimitReachedType: "workspace_member_usage_limit_reached",
			resetCreditsAvailable: 2,
			activity: { lifetimeTokens: 500 },
			quotaFetchedAt: 10,
			activityFetchedAt: 20,
		}

		const merged = mergeOpenAiCodexRollingUsage(previous, {
			rateLimits: [{ limitId: "codex", primary: { usedPercent: 35 } }],
			credits: { balance: "7" },
			quotaFetchedAt: 30,
		})

		assert.deepEqual(merged.rateLimits[0], {
			limitId: "codex",
			limitName: "Main",
			primary: { usedPercent: 35, windowMinutes: 300, resetsAt: 100 },
			secondary: { usedPercent: 40, windowMinutes: 10_080, resetsAt: 200 },
		})
		assert.deepEqual(merged.credits, { hasCredits: true, unlimited: false, balance: "7" })
		assert.deepEqual(merged.spendControl, previous.spendControl)
		assert.equal(merged.rateLimitReachedType, previous.rateLimitReachedType)
		assert.equal(merged.resetCreditsAvailable, previous.resetCreditsAvailable)
		assert.deepEqual(merged.activity, previous.activity)
		assert.equal(merged.activityFetchedAt, previous.activityFetchedAt)
		assert.equal(merged.quotaFetchedAt, 30)
	})
})

describe("OpenAI Codex usage display selection", () => {
	it("sorts Codex first, additional buckets by label, and windows by duration", () => {
		const windows = selectOpenAiCodexDisplayWindows({
			rateLimits: [
				{
					limitId: "zeta",
					limitName: "Zeta",
					primary: { usedPercent: 1, windowMinutes: 1440 },
				},
				{
					limitId: "codex",
					primary: { usedPercent: 2, windowMinutes: 10_080 },
					secondary: { usedPercent: 3, windowMinutes: 300 },
				},
				{
					limitId: "alpha",
					limitName: "Alpha",
					primary: { usedPercent: 4 },
				},
			],
		})

		assert.deepEqual(
			windows.map(({ bucket, kind, window }) => [bucket.limitId, kind, window.windowMinutes]),
			[
				["codex", "secondary", 300],
				["codex", "primary", 10_080],
				["alpha", "primary", undefined],
				["zeta", "primary", 1440],
			],
		)
	})
})
