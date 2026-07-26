import { describe, expect, it } from "vitest"
import { shouldIgnoreTerminalInput } from "./input"

describe("shouldIgnoreTerminalInput", () => {
	it("ignores terminal capability responses and mouse reports", () => {
		expect(shouldIgnoreTerminalInput("\x1b[?1;2c", {})).toBe(true)
		expect(shouldIgnoreTerminalInput("\x1b[<35;46;17M", {})).toBe(true)
	})

	it("preserves recognized keyboard input", () => {
		expect(shouldIgnoreTerminalInput("\x1b[A", { upArrow: true })).toBe(false)
		expect(shouldIgnoreTerminalInput("hello", {})).toBe(false)
	})
})
