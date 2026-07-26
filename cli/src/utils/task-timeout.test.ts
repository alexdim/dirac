import { afterEach, describe, expect, it } from "vitest"
import {
	clearTaskDeadline,
	getTaskDeadline,
	hasTaskTimedOut,
	markTaskTimedOut,
	parseTimeoutSeconds,
} from "./task-timeout"

describe("parseTimeoutSeconds", () => {
	it("accepts positive whole seconds", () => {
		expect(parseTimeoutSeconds("15")).toBe(15)
		expect(parseTimeoutSeconds(2)).toBe(2)
	})

	it("rejects zero, fractions, and partial numbers", () => {
		expect(() => parseTimeoutSeconds("0")).toThrow("greater than zero")
		expect(() => parseTimeoutSeconds("1.5")).toThrow("whole number")
		expect(() => parseTimeoutSeconds("12seconds")).toThrow("whole number")
	})
})

describe("task deadlines", () => {
	afterEach(() => clearTaskDeadline("task-1"))

	it("keeps the original deadline across UI remounts", () => {
		expect(getTaskDeadline("task-1", 10, 1_000)).toBe(11_000)
		expect(getTaskDeadline("task-1", 10, 5_000)).toBe(11_000)
	})

	it("allows a fresh deadline after terminal cleanup", () => {
		getTaskDeadline("task-1", 10, 1_000)
		clearTaskDeadline("task-1")
		expect(getTaskDeadline("task-1", 10, 5_000)).toBe(15_000)
	})

	it("records timeout delivery until terminal cleanup", () => {
		markTaskTimedOut("task-1")
		expect(hasTaskTimedOut("task-1")).toBe(true)
		clearTaskDeadline("task-1")
		expect(hasTaskTimedOut("task-1")).toBe(false)
	})
})
