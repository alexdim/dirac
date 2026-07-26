import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { SayTool } from "../say/SayTool"

describe("SayTool", () => {
	it("emits model text with explicit assistant authorship", async () => {
		const upsertText = sinon.stub().resolves()
		const env = { ui: { upsertText } }

		await new SayTool().processCall({ message: "Working on it." }, env as any)

		assert.ok(upsertText.calledOnceWithExactly("Working on it.", false, "assistant"))
	})
})
