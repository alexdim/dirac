import type { GoalTaskSummary, GoalViewState } from "@shared/goal"
import { render } from "ink-testing-library"
import React, { act } from "react"
import { describe, expect, it, vi } from "vitest"

type InputHandler = (input: string, key: import("ink").Key) => void
const capturedInput = vi.hoisted(() => ({
	handler: null as InputHandler | null,
	options: null as { isActive?: boolean } | null,
}))

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
	useTerminalSize: () => ({ columns: 120, rows: 30, resizeKey: 0 }),
}))

import { GoalSummary } from "./GoalSummary"

function terminalChild(index: number): GoalTaskSummary {
	return {
		id: `terminal-${index}`,
		title: `Terminal child ${index}`,
		role: index === 1 ? "verification" : "task",
		status: index === 1 ? "failed" : "completed",
		createdAt: index,
		lastActivityAt: index,
		endedAt: index,
		deliveredResponseCursor: 0,
		idleDurationMs: 0,
	}
}

function goalWithOlderChildren(): GoalViewState {
	return {
		id: "goal-1",
		status: "working",
		objective: { markdown: "Inspect every child", revision: 1, updatedAt: 1 },
		createdAt: 1,
		updatedAt: 1,
		wallDurationMs: 1_000,
		activeDurationMs: 1_000,
		children: [
			...Array.from({ length: 7 }, (_, index) => terminalChild(index + 1)),
			{
				id: "active",
				title: "Active child",
				role: "task",
				status: "running",
				createdAt: 8,
				lastActivityAt: 8,
				deliveredResponseCursor: 0,
				idleDurationMs: 0,
			},
		],
		pendingInteractionCount: 0,
		accounting: {},
		mode: "act",
		modeSwitchingDisabled: true,
		modeSwitchingExplanation: "Mode switching is disabled while a Goal is active.",
	}
}

async function pressPageKey(key: "pageUp" | "pageDown") {
	if (!capturedInput.handler) throw new Error("GoalSummary input handler was not registered")
	await act(async () => {
		capturedInput.handler?.("", { [key]: true } as import("ink").Key)
	})
}

describe("GoalSummary child inspection", () => {
	it("pages from active and recent children to the oldest child", async () => {
		const view = render(
			React.createElement(GoalSummary, {
				goal: goalWithOlderChildren(),
				isProcessing: false,
				isStopConfirmationPending: false,
			}),
		)

		expect(capturedInput.options?.isActive).toBe(true)
		expect(view.lastFrame()).toContain("page 1/2")
		expect(view.lastFrame()).toContain("(active)")
		expect(view.lastFrame()).not.toContain("(terminal-1)")

		await pressPageKey("pageDown")

		expect(view.lastFrame()).toContain("page 2/2")
		expect(view.lastFrame()).toContain("failed · verification · Terminal child 1 (terminal-1)")

		await pressPageKey("pageUp")

		expect(view.lastFrame()).toContain("page 1/2")
		expect(view.lastFrame()).not.toContain("(terminal-1)")
	})
})
