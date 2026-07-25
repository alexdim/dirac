import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildLegacySynthetic1mStateUpdates,
	normalizeLegacyOpenRouterPinMap,
	normalizeLegacySynthetic1mModelId,
} from "../legacy-model-id-migration"

describe("legacy synthetic 1m model-id migration", () => {
	it("normalizes plain, fast-mode, and preset IDs idempotently", () => {
		const examples = [
			["model:1m", "model"],
			["model:1m:fast", "model:fast"],
			["author/model:1m@preset/team", "author/model@preset/team"],
			["author/model", "author/model"],
		]

		for (const [legacy, canonical] of examples) {
			expect(normalizeLegacySynthetic1mModelId(legacy)).to.equal(canonical)
			expect(normalizeLegacySynthetic1mModelId(canonical)).to.equal(canonical)
		}
	})

	it("merges canonical pin tags before sorted legacy keys and removes duplicates", () => {
		expect(
			normalizeLegacyOpenRouterPinMap({
				"author/model:1m": ["legacy-a", "shared"],
				"author/model": ["canonical", "shared"],
				"author/model:1m@preset/team": ["preset"],
			}),
		).to.deep.equal({
			"author/model": ["canonical", "shared", "legacy-a"],
			"author/model@preset/team": ["preset"],
		})
	})

	it("normalizes saved selections and model-provider presets together", () => {
		const updates = buildLegacySynthetic1mStateUpdates({
			actModeOpenRouterModelId: "author/model:1m",
			modelProviderPresets: [
				{
					id: "openrouter::author%2Fmodel%3A1m",
					provider: "openrouter",
					modelId: "author/model:1m",
					modelInfo: { contextWindow: 1_000_000, supportsPromptCache: true },
					lastUsedAt: 1,
				},
			],
		})
		const [preset] = updates.modelProviderPresets!

		expect(updates.actModeOpenRouterModelId).to.equal("author/model")
		expect(preset.modelId).to.equal("author/model")
		expect(preset.id).to.equal("openrouter::author%2Fmodel")
		expect(preset.modelInfo).to.equal(undefined)
	})
})
