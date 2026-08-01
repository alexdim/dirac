import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { filterMessagesForClaudeCode } from "./message-filter"

describe("filterMessagesForClaudeCode", () => {
	it("removes internal provenance and steering receipt metadata recursively", () => {
		const result = filterMessagesForClaudeCode([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "guidance",
						isUserInput: true,
						steeringMessageIds: ["transcript-1"],
					},
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: [{ type: "text", text: "nested", isUserInput: true }],
					},
				],
			} as any,
		])
		const content = result[0].content as any[]

		assert.equal("isUserInput" in content[0], false)
		assert.equal("steeringMessageIds" in content[0], false)
		assert.equal("isUserInput" in content[1].content[0], false)
	})
})
