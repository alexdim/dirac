import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { getErrorMessage, toError } from "./errors"

describe("getErrorMessage", () => {
	it("returns the message of an Error", () => {
		assert.strictEqual(getErrorMessage(new Error("boom")), "boom")
	})

	it("stringifies a non-Error value", () => {
		assert.strictEqual(getErrorMessage("oops"), "oops")
		assert.strictEqual(getErrorMessage(42), "42")
		assert.strictEqual(getErrorMessage(undefined), "undefined")
	})

	it("uses the fallback for a non-Error value when provided", () => {
		assert.strictEqual(getErrorMessage({ code: 1 }, "Unknown error"), "Unknown error")
		assert.strictEqual(getErrorMessage(undefined, "Unknown error"), "Unknown error")
	})

	it("ignores the fallback for an Error", () => {
		assert.strictEqual(getErrorMessage(new Error("boom"), "Unknown error"), "boom")
	})
})

describe("toError", () => {
	it("returns the same Error instance", () => {
		const error = new Error("boom")
		assert.strictEqual(toError(error), error)
	})

	it("wraps a non-Error value in a new Error", () => {
		const error = toError("oops")
		assert.ok(error instanceof Error)
		assert.strictEqual(error.message, "oops")
	})
})
