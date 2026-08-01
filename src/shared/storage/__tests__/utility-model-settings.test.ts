import { expect } from "chai"
import { describe, it } from "mocha"
import type { ModelProviderSelection } from "@shared/api"
import { ApiProvider as ProtoApiProvider } from "@shared/proto/dirac/models"
import { Settings } from "@shared/proto/dirac/state"
import {
	convertApiProviderToProto,
	convertModelProviderSelectionToProto,
	convertProtoToApiProvider,
	convertProtoToModelProviderSelection,
} from "@shared/proto-conversions/models/api-configuration-conversion"
import { getDefaultValue } from "../state-keys"

describe("Utility model settings", () => {
	it("defaults to disabled without a persisted selection", () => {
		expect(getDefaultValue("utilityModelEnabled")).to.equal(false)
		expect(getDefaultValue("utilityModelSelection")).to.be.undefined
	})

	it("round-trips a secret-free provider selection", () => {
		const selection: ModelProviderSelection = {
			provider: "openai",
			modelId: "utility-model",
			modelInfo: {
				contextWindow: 128_000,
				supportsPromptCache: true,
			},
			openAiProfileName: "utility-profile",
			awsBedrockCustomSelected: false,
		}
		const encoded = Settings.encode(
			Settings.create({
				utilityModelEnabled: true,
				utilityModelSelection: {
					...selection,
					provider: ProtoApiProvider.OPENAI,
				},
			}),
		).finish()
		const decoded = Settings.decode(encoded)

		expect(decoded.utilityModelEnabled).to.equal(true)
		expect(decoded.utilityModelSelection?.provider).to.equal(ProtoApiProvider.OPENAI)
		expect(decoded.utilityModelSelection?.modelId).to.equal(selection.modelId)
		expect(decoded.utilityModelSelection?.modelInfo?.contextWindow).to.equal(selection.modelInfo?.contextWindow)
		expect(decoded.utilityModelSelection?.openAiProfileName).to.equal(selection.openAiProfileName)
		expect(decoded.utilityModelSelection?.awsBedrockCustomSelected).to.equal(false)
		expect(Object.keys(decoded.utilityModelSelection!)).to.not.include.members(["apiKey", "accessToken", "secret"])
	})

	it("preserves GitHub Copilot and OCA provider identities through protobuf conversion", () => {
		const cases: Array<[ModelProviderSelection["provider"], ProtoApiProvider]> = [
			["github-copilot", ProtoApiProvider.GITHUB_COPILOT],
			["oca", ProtoApiProvider.OCA],
		]

		for (const [provider, protoProvider] of cases) {
			const selection: ModelProviderSelection = { provider, modelId: `${provider}-utility-model` }
			const protoSelection = convertModelProviderSelectionToProto(selection)
			const encoded = Settings.encode(Settings.create({ utilityModelSelection: protoSelection })).finish()
			const decodedSelection = Settings.decode(encoded).utilityModelSelection!
			const restoredSelection = convertProtoToModelProviderSelection(decodedSelection)

			expect(decodedSelection.provider).to.equal(protoProvider)
			expect(restoredSelection.provider).to.equal(provider)
			expect(restoredSelection.modelId).to.equal(selection.modelId)
		}
	})

	it("rejects unsupported provider values instead of silently converting them to Anthropic", () => {
		expect(() => convertApiProviderToProto("unsupported" as ModelProviderSelection["provider"])).to.throw(
			"Unsupported API provider",
		)
		expect(() => convertProtoToApiProvider(999 as ProtoApiProvider)).to.throw("Unsupported protobuf API provider")
	})
})
