import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { presentProgressResponse } from "../ProgressResponseOperation"

describe("progress response operation", () => {
	it("emits model text with explicit assistant authorship", async () => {
		const upsertText = sinon.stub().resolves()
		const env = { ui: { upsertText } }

		await presentProgressResponse("Working on it.", env as any)

		assert.ok(upsertText.calledOnceWithExactly("Working on it.", false, "assistant"))
	})
})
