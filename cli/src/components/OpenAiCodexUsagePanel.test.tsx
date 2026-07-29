import type { OpenAiCodexUsageSnapshot } from "@shared/openai-codex-usage"
import { render } from "ink-testing-library"
// biome-ignore lint/correctness/noUnusedImports: Vitest transforms this test with the classic JSX runtime.
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

type InputHandler = (input: string, key: import("ink").Key) => void

const capturedInput = vi.hoisted(() => ({
	handler: null as InputHandler | null,
	options: null as { isActive?: boolean } | null,
}))
const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock("ink", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ink")>()
	return {
		...actual,
		useInput: (handler: InputHandler, options?: { isActive?: boolean }) => {
			capturedInput.handler = handler
			capturedInput.options = options ?? null
		},
	}
})

vi.mock("../context/StdinContext", () => ({
	useStdinContext: () => ({ isRawModeSupported: true }),
}))

vi.mock("../hooks/useTerminalSize", () => ({
	useTerminalSize: () => ({ columns: 120, rows: 40, resizeKey: 0 }),
}))

vi.mock("@/core/controller/models/refreshOpenAiCodexUsage", () => ({
	refreshOpenAiCodexUsage: (...args: unknown[]) => mockRefresh(...args),
}))

vi.mock("@shared/proto-conversions/openai-codex-usage", () => ({
	fromProtobufOpenAiCodexUsage: (value: unknown) => value,
}))

import { OpenAiCodexUsagePanel } from "./OpenAiCodexUsagePanel"

const delay = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

function pressKey(input: string, keyOverrides: Partial<import("ink").Key> = {}) {
	if (!capturedInput.handler) throw new Error("useInput handler was not registered")
	capturedInput.handler(input, {
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		...keyOverrides,
	})
}

function usageSnapshot(usedPercent = 32): OpenAiCodexUsageSnapshot {
	const fetchedAt = Date.now()
	return {
		planType: "plus",
		rateLimits: [
			{
				limitId: "codex",
				primary: { usedPercent, windowMinutes: 300, resetsAt: Math.floor(fetchedAt / 1000) + 3600 },
				secondary: { usedPercent: 58, windowMinutes: 10080, resetsAt: Math.floor(fetchedAt / 1000) + 86400 },
			},
		],
		credits: { hasCredits: true, unlimited: false, balance: "12.50" },
		activity: {
			lifetimeTokens: 123456,
			peakDailyTokens: 12000,
			currentStreakDays: 3,
			longestStreakDays: 8,
			dailyUsageBuckets: [{ startDate: "2026-07-28", tokens: 4321 }],
		},
		quotaFetchedAt: fetchedAt,
		activityFetchedAt: fetchedAt,
	}
}

describe("OpenAiCodexUsagePanel", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		capturedInput.handler = null
		capturedInput.options = null
	})

	it("calmly explains when the user is not signed in", () => {
		const frame =
			render(
				<OpenAiCodexUsagePanel
					controller={{}}
					isAuthenticated={false}
					onClose={vi.fn()}
				/>,
			).lastFrame() || ""

		expect(frame).toContain("Sign in with ChatGPT to view subscription usage")
		expect(frame).toContain("authenticate the openai-codex provider")
	})

	it("renders backend percentages as neutral remaining quota and keeps activity distinct", () => {
		const frame =
			render(
				<OpenAiCodexUsagePanel
					controller={{}}
					isAuthenticated={true}
					onClose={vi.fn()}
					snapshot={usageSnapshot(100)}
				/>,
			).lastFrame() || ""

		expect(frame).toContain("0% remaining")
		expect(frame).toContain("Weekly · 42% remaining")
		expect(frame).toContain("Token activity is account history and does not directly represent quota remaining")
		expect(frame).toContain("Jul 28: 4,321 tokens")
	})

	it("refreshes with r while retaining the previous values until the refresh completes", async () => {
		let resolveRefresh: (snapshot: OpenAiCodexUsageSnapshot) => void = () => {}
		mockRefresh.mockImplementation(
			() =>
				new Promise<OpenAiCodexUsageSnapshot>((resolve) => {
					resolveRefresh = resolve
				}),
		)
		const view = render(
			<OpenAiCodexUsagePanel
				controller={{}}
				isAuthenticated={true}
				onClose={vi.fn()}
				snapshot={usageSnapshot(32)}
			/>,
		)

		pressKey("r")
		await delay()
		expect(mockRefresh).toHaveBeenCalledOnce()
		expect(view.lastFrame()).toContain("68% remaining")
		expect(view.lastFrame()).toContain("Refreshing…")

		resolveRefresh(usageSnapshot(10))
		await delay()
		expect(view.lastFrame()).toContain("90% remaining")
	})

	it("closes on Escape", () => {
		const onClose = vi.fn()
		render(
			<OpenAiCodexUsagePanel
				controller={{}}
				isAuthenticated={true}
				onClose={onClose}
				snapshot={usageSnapshot()}
			/>,
		)

		pressKey("", { escape: true })
		expect(onClose).toHaveBeenCalledOnce()
	})
})
