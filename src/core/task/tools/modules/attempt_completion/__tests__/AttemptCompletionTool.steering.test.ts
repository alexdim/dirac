import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { AttemptCompletionTool } from "../AttemptCompletionTool"

describe("AttemptCompletionTool steering arbitration", () => {
	it("skips every completion-only side effect when steering supersedes completion", async () => {
		const createCard = sinon.stub()
		const saveCheckpoint = sinon.stub()
		const runHook = sinon.stub()
		const commitAttemptCompletion = sinon.stub().resolves(false)
		const state = {
			consecutiveMistakeCount: 0,
			doubleCheckCompletionPending: false,
		}
		const env = {
			config: {
				doubleCheckCompletionEnabled: false,
				isSubagentExecution: false,
				autoApprovalSettings: { enableNotifications: false },
			},
			ui: { createCard },
			orchestration: {
				getTaskState: (key: keyof typeof state) => state[key],
				setTaskState: (key: keyof typeof state, value: number | boolean) => {
					state[key] = value as never
				},
				commitAttemptCompletion,
				saveCheckpoint,
				runHook,
			},
		} as any

		const result = await new AttemptCompletionTool().processCall({ result: "Done" }, env)

		assert.equal(result, "Done")
		assert.equal(commitAttemptCompletion.calledOnce, true)
		assert.equal(createCard.notCalled, true)
		assert.equal(saveCheckpoint.notCalled, true)
		assert.equal(runHook.notCalled, true)
	})
	it("keeps completion committed when presentation fails after arbitration", async () => {
		const state = {
			consecutiveMistakeCount: 0,
			doubleCheckCompletionPending: false,
			completionCommitted: false,
			didAttemptCompletion: false,
		}
		const env = {
			config: {
				doubleCheckCompletionEnabled: false,
				isSubagentExecution: false,
				autoApprovalSettings: { enableNotifications: false },
			},
			ui: { createCard: sinon.stub().rejects(new Error("card failed")) },
			logging: { warn: sinon.stub() },
			orchestration: {
				getTaskState: (key: keyof typeof state) => state[key],
				setTaskState: (key: keyof typeof state, value: number | boolean) => {
					state[key] = value as never
				},
				commitAttemptCompletion: sinon.stub().callsFake(async () => {
					state.completionCommitted = true
					state.didAttemptCompletion = true
					return true
				}),
				runHook: sinon.stub(),
			},
		} as any

		assert.equal(await new AttemptCompletionTool().processCall({ result: "Done" }, env), "Done")
		assert.equal((env.orchestration.commitAttemptCompletion as sinon.SinonStub).calledOnce, true)
	})

})
