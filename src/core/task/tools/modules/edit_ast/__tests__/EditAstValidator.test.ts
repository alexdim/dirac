import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { EditAstValidator } from "../EditAstValidator"

describe("EditAstValidator", () => {
	const validator = new EditAstValidator()

	it("normalizes duplicate rename scopes while preserving one shared rename", () => {
		const result = validator.validate({
			operation: "rename",
			targets: [
				{ path: "src", symbol: "User.load", replacement: "fetch" },
				{ path: "src", symbol: "User.load", replacement: "fetch" },
				{ path: "cli", symbol: "User.load", replacement: "fetch" },
			],
		})

		assert.equal(result.valid, true)
		if (!result.valid) return
		assert.deepEqual(result.args.targets, [
			{ path: "src", symbol: "User.load", replacement: "fetch" },
			{ path: "cli", symbol: "User.load", replacement: "fetch" },
		])
	})

	it("rejects rename targets that disagree", () => {
		const result = validator.validate({
			operation: "rename",
			targets: [
				{ path: "src", symbol: "oldName", replacement: "newName" },
				{ path: "cli", symbol: "otherName", replacement: "newName" },
			],
		})

		assert.equal(result.valid, false)
		if (result.valid) return
		assert.match(result.error, /same symbol/)
	})

	it("rejects invalid rename identifiers", () => {
		const result = validator.validate({
			operation: "rename",
			targets: [{ path: "src", symbol: "oldName", replacement: "not valid" }],
		})

		assert.equal(result.valid, false)
		if (result.valid) return
		assert.match(result.error, /valid identifier/)
	})

	it("rejects duplicate replacement targets before planning", () => {
		const result = validator.validate({
			operation: "replace",
			targets: [
				{ path: "src/user.ts", symbol: "User.load", replacement: "function load() {}" },
				{ path: "src/user.ts", symbol: "User.load", replacement: "function load() { return 1 }" },
			],
		})

		assert.equal(result.valid, false)
		if (result.valid) return
		assert.match(result.error, /Duplicate replacement target/)
	})
})
