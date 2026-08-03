import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { CardHeader, isTaskCompletionCard } from "./cardIdentity"
import { CardKind } from "./ExtensionMessage"
import {
	isPlanResponseCard,
	isQuestionResponseCard,
	RESPOND_TOOL_NAME,
	responseCardInput,
	ResponseCardHeader,
	ResponseOperation,
} from "./responseTool"

describe("response card identity", () => {
	it("classifies current response cards from semantic metadata", () => {
		const question = {
			header: "Localized question title",
			toolName: RESPOND_TOOL_NAME,
			rawInput: responseCardInput(ResponseOperation.QUESTION, "Choose", ["A", "B"]),
		} as any
		const plan = {
			header: "Localized plan title",
			toolName: RESPOND_TOOL_NAME,
			rawInput: responseCardInput(ResponseOperation.PLAN, "Plan"),
		} as any

		assert.equal(isQuestionResponseCard(question), true)
		assert.equal(isPlanResponseCard(question), false)
		assert.equal(isPlanResponseCard(plan), true)
		assert.equal(isQuestionResponseCard(plan), false)
	})

	it("does not classify unrelated cards by display text", () => {
		const card = {
			header: ResponseCardHeader.QUESTION,
			toolName: "unrelated_tool",
			rawInput: { tool: "unrelated_tool", operation: ResponseOperation.QUESTION },
		} as any

		assert.equal(isQuestionResponseCard(card), false)
	})

	it("keeps historical plan cards readable", () => {
		const card = { header: ResponseCardHeader.PROPOSED_PLAN } as any
		assert.equal(isPlanResponseCard(card), true)
	})

	it("keeps current and historical completion cards readable", () => {
		assert.equal(isTaskCompletionCard({ kind: CardKind.TASK_COMPLETION, header: "Localized" } as any), true)
		assert.equal(isTaskCompletionCard({ header: CardHeader.TASK_COMPLETED } as any), true)
		assert.equal(isTaskCompletionCard({ header: CardHeader.LEGACY_TASK_COMPLETION } as any), true)
	})
})
