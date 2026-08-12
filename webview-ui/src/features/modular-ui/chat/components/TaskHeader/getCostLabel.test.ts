import type { ModelInfo } from "@shared/api"
import { describe, expect, it } from "vitest"
import { getCostLabel } from "./getCostLabel"

const paid: ModelInfo = { supportsPromptCache: true, inputPrice: 3.0, outputPrice: 15.0 }
const free: ModelInfo = { supportsPromptCache: true, inputPrice: 0, outputPrice: 0 }
const unknown: ModelInfo = { supportsPromptCache: true }

describe("getCostLabel", () => {
	it("returns n/a when model info is missing", () => {
		expect(getCostLabel(0)).toBe("n/a")
	})

	it("returns n/a when pricing is unknown", () => {
		expect(getCostLabel(0, unknown)).toBe("n/a")
		expect(getCostLabel(1.23, unknown)).toBe("n/a")
	})

	it("returns FREE for explicitly zero-priced models", () => {
		expect(getCostLabel(0, free)).toBe("FREE")
		expect(getCostLabel(0.5, free)).toBe("FREE")
	})

	// Regression: paid model with totalCost === 0 must show $0.0000, not FREE.
	it("returns $0.0000 for paid models with no usage yet", () => {
		expect(getCostLabel(0, paid)).toBe("$0.0000")
	})

	it("returns formatted cost for paid models with usage", () => {
		expect(getCostLabel(0.0105, paid)).toBe("$0.0105")
	})
})
