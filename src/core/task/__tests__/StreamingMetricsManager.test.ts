import { expect } from "chai"
import { describe, it } from "mocha"
import { StreamingMetricsManager } from "../StreamingMetricsManager"

function stubApi(contextWindow?: number) {
	return {
		getModel: () => ({ info: { contextWindow } }),
	} as any
}

describe("StreamingMetricsManager", () => {
	it("merges usage chunks into running totals", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5, reasoningTokens: 2 })
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5, cacheWriteTokens: 3, cacheReadTokens: 4 })

		expect(manager.getMetrics()).to.deep.equal({
			inputTokens: 10,
			outputTokens: 5,
			reasoningTokens: 2,
			cacheWriteTokens: 3,
			cacheReadTokens: 4,
			totalCost: undefined,
		})
	})

	it("falls back to thoughtsTokenCount for reasoning and keeps prior cache values", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		manager.updateFromChunk({ inputTokens: 1, outputTokens: 1, thoughtsTokenCount: 7 })
		// a later chunk without cache values must keep the previous ones
		manager.updateFromChunk({ inputTokens: 1, outputTokens: 1, cacheWriteTokens: 9 })
		manager.updateFromChunk({ inputTokens: 1, outputTokens: 1 })

		expect(manager.getMetrics().reasoningTokens).to.equal(7)
		expect(manager.getMetrics().cacheWriteTokens).to.equal(9)
	})

	it("returns the provider-calculated total cost when present", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5, totalCost: 1.23 })
		expect(manager.getTotalCost()).to.equal(1.23)
	})

	it("computes cost via calculateCost when provider totalCost is absent", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi(100_000) as any)
		manager.updateFromChunk({ inputTokens: 0, outputTokens: 0 })
		// zero tokens and no provider cost -> calculateCost yields 0
		expect(manager.getTotalCost()).to.equal(0)
	})

	it("getMetrics returns a snapshot, not a live reference", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		const snapshot = manager.getMetrics()
		snapshot.inputTokens = 999
		expect(manager.getMetrics().inputTokens).to.equal(0)
	})
})
