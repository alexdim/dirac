import "should"
import type { ModelInfo } from "../api"
import {
    getReasoningEffortOptionsForModel,
    resolveReasoningEffortForModel,
    supportsReasoningEffortForModel,
} from "./reasoning-support"

const constrainedModel: ModelInfo = {
	supportsPromptCache: true,
	supportsReasoningEffort: true,
	reasoningEffortOptions: ["low", "high", "max"],
	defaultReasoningEffort: "max",
}

describe("reasoning support", () => {
	it("uses model-provided effort options", () => {
		getReasoningEffortOptionsForModel("provider/model", constrainedModel).should.deepEqual(["low", "high", "max"])
		supportsReasoningEffortForModel("provider/model", constrainedModel).should.equal(true)
	})

	it("preserves a supported configured effort", () => {
		resolveReasoningEffortForModel("provider/model", constrainedModel, "low")!.should.equal("low")
	})

	it("falls back to the model default for unsupported efforts", () => {
		resolveReasoningEffortForModel("provider/model", constrainedModel, "medium")!.should.equal("max")
	})
})
