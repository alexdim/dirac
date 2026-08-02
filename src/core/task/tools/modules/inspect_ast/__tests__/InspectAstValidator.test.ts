import { strict as assert } from "node:assert"
import { InspectAstValidator } from "../InspectAstValidator"

describe("InspectAstValidator", () => {
	it("normalizes harmless singular runtime inputs", () => {
		const result = InspectAstValidator.normalize({
			operation: "implementation",
			paths: "src/service.ts",
			symbols: "UserService.load",
			include_anchors: true,
		})

		assert.equal(result.valid, true)
		if (!result.valid) return
		assert.deepEqual(result.args, {
			operation: "implementation",
			paths: ["src/service.ts"],
			symbols: ["UserService.load"],
			includeAnchors: true,
		})
	})

	it("requires symbols for every operation except outline", () => {
		for (const operation of ["implementation", "definitions", "references", "occurrences"] as const) {
			const result = InspectAstValidator.normalize({ operation, paths: ["src"] })
			assert.equal(result.valid, false)
			if (!result.valid) assert.match(result.message, /symbols/)
		}
	})

	it("rejects symbols for outline", () => {
		const result = InspectAstValidator.normalize({ operation: "outline", paths: ["src/a.ts"], symbols: ["main"] })
		assert.equal(result.valid, false)
		if (!result.valid) assert.match(result.message, /must be absent or empty/)
	})

	it("rejects missing paths and invalid operations", () => {
		const missingPaths = InspectAstValidator.normalize({ operation: "outline", paths: [] })
		assert.equal(missingPaths.valid, false)

		const invalidOperation = InspectAstValidator.normalize({ operation: "search", paths: ["src"] })
		assert.equal(invalidOperation.valid, false)
		if (!invalidOperation.valid) assert.match(invalidOperation.message, /outline, implementation, definitions/)
	})
})
