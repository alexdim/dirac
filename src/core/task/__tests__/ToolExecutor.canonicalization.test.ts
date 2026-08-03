import { strict as assert } from "node:assert"
import { DiracDefaultTool } from "@shared/tools"
import {
	LegacyResponseParameter,
	LegacyResponseTool,
	ResponseOperation,
	ResponseShapeError,
} from "@shared/responseTool"
import { describe, it } from "mocha"
import type { ToolUse } from "../../assistant-message"
import { canonicalizeResponseToolCall } from "../ToolExecutor"

describe("ToolExecutor canonicalization", () => {
	it("canonicalizes every legacy response call into the response contract", () => {
		const cases = [
			[LegacyResponseTool.PROGRESS, LegacyResponseParameter.MESSAGE, ResponseOperation.PROGRESS],
			[LegacyResponseTool.COMPLETE, LegacyResponseParameter.RESULT, ResponseOperation.COMPLETE],
			[LegacyResponseTool.PLAN, LegacyResponseParameter.RESPONSE, ResponseOperation.PLAN],
			[LegacyResponseTool.QUESTION, LegacyResponseParameter.QUESTION, ResponseOperation.QUESTION],
		] as const

		for (const [name, textParameter, operation] of cases) {
			const block: ToolUse = {
				type: "tool_use",
				name,
				params: { [textParameter]: "legacy text", options: ["A", "B"] },
			}

			assert.equal(canonicalizeResponseToolCall(block), true)
			assert.deepEqual(block, {
				type: "tool_use",
				name: DiracDefaultTool.RESPOND,
				params: { operation, text: "legacy text", options: ["A", "B"] },
			})
		}
	})

	it("accepts the historical completion response field", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: LegacyResponseTool.COMPLETE,
			params: { [LegacyResponseParameter.RESPONSE]: "historical result" },
		}

		canonicalizeResponseToolCall(block)

		assert.equal(block.params.text, "historical result")
	})

	it("rejects the removed exploration field without carrying it forward", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: LegacyResponseTool.PLAN,
			params: {
				[LegacyResponseParameter.RESPONSE]: "Plan",
				[LegacyResponseParameter.NEEDS_MORE_EXPLORATION]: true,
			} as any,
		}

		assert.throws(() => canonicalizeResponseToolCall(block), ResponseShapeError)
		assert.equal(block.name, LegacyResponseTool.PLAN)
		assert.equal(canonicalizeResponseToolCall(block, false), false)
		assert.equal(block.name, LegacyResponseTool.PLAN)
	})

	it("leaves a consolidated response call unchanged", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: DiracDefaultTool.RESPOND,
			params: {
				operation: ResponseOperation.COMPLETE,
				text: "already canonical",
			},
		}

		const didCanonicalize = canonicalizeResponseToolCall(block)

		assert.equal(didCanonicalize, false)
		assert.equal(block.params.text, "already canonical")
	})
})
