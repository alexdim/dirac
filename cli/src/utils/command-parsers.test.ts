import { InvalidArgumentError } from "commander"
import { describe, expect, it } from "vitest"
import { parsePositiveInteger, parseReasoningEffort, parseThinkingBudget } from "./command-parsers"

describe("parsePositiveInteger", () => {
	it.each(["1", "20", "9007199254740991"])("accepts %s", (value) => {
		expect(parsePositiveInteger(value)).toBe(Number(value))
	})

	it.each(["0", "-1", "1.5", "2items", "", "Infinity", "NaN", "9007199254740992"])("rejects %s", (value) => {
		expect(() => parsePositiveInteger(value)).toThrow(InvalidArgumentError)
	})
})

describe("parseThinkingBudget", () => {
	it.each(["0", "1", "4096"])("accepts %s", (value) => {
		expect(parseThinkingBudget(value)).toBe(Number(value))
	})

	it.each(["-1", "1.5", "4096tokens", "", "Infinity", "NaN", "9007199254740992"])("rejects %s", (value) => {
		expect(() => parseThinkingBudget(value)).toThrow(InvalidArgumentError)
	})

	describe("parseReasoningEffort", () => {
		it("accepts exported reasoning efforts case-insensitively", () => {
			expect(parseReasoningEffort("XHIGH")).toBe("xhigh")
		})

		it("rejects unknown reasoning efforts", () => {
			expect(() => parseReasoningEffort("extreme")).toThrow("Reasoning effort must be one of")
		})
	})
})
