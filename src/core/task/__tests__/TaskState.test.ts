import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { TaskState } from "../TaskState"

describe("TaskState cancellation", () => {
	it("aborts the current signal and creates a fresh signal when reset", () => {
		const state = new TaskState()
		const initialSignal = state.abortSignal

		assert.equal(state.abort, false)
		assert.equal(initialSignal.aborted, false)

		state.abort = true

		assert.equal(state.abort, true)
		assert.equal(initialSignal.aborted, true)

		state.abort = false

		assert.equal(state.abort, false)
		assert.notEqual(state.abortSignal, initialSignal)
		assert.equal(state.abortSignal.aborted, false)
	})
})
