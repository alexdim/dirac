import { describe, expect, it } from "vitest"
import { getFileName, parseValue } from "./ConfigViewComponents"

describe("configuration value parsing", () => {
	it("accepts explicit boolean representations", () => {
		expect(parseValue("true", "boolean")).toBe(true)
		expect(parseValue("0", "boolean")).toBe(false)
	})

	it("rejects ambiguous booleans instead of saving false", () => {
		expect(() => parseValue("enabled", "boolean")).toThrow("Boolean values")
	})

	it("rejects empty and partial numbers instead of saving zero or a prefix", () => {
		expect(() => parseValue("", "number")).toThrow("cannot be empty")
		expect(() => parseValue("12px", "number")).toThrow("Invalid number")
	})

	it("reports malformed JSON instead of replacing it with an empty object", () => {
		expect(() => parseValue("{broken", "object")).toThrow()
	})
})

describe("configuration path display", () => {
	it("extracts filenames from POSIX and Windows paths", () => {
		expect(getFileName("/workspace/rules/example.md")).toBe("example.md")
		expect(getFileName("C:\\workspace\\rules\\example.md")).toBe("example.md")
	})
})
