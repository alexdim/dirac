import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { EnvironmentManager } from "../EnvironmentManager";
import { TaskState } from "../TaskState";

function createEnvironmentManager(
	taskState: TaskState,
	options: { taskMode?: "plan" | "act"; requestMode?: "plan" | "act" } = {},
): EnvironmentManager {
	const taskMode = options.taskMode ?? "act"
	const requestMode = options.requestMode ?? taskMode
	return new EnvironmentManager({
		cwd: "/test/project",
		terminalManager: {} as any,
		taskState,
		fileContextTracker: {} as any,
		api: {} as any,
		messageStateHandler: {} as any,
		getWorkingConfiguration: () => ({ settings: { mode: taskMode }, executionOptions: { multiRootEnabled: false } }) as any,
		getRequestRuntime: () => ({
			requestId: "request-1",
			workingConfiguration: { settings: { mode: requestMode }, executionOptions: { multiRootEnabled: false } },
		}) as any,
	})
}

describe("EnvironmentManager mode-entry guidance", () => {
	it("emits Plan guidance only for a pending Plan entry", async () => {
		const taskState = new TaskState()
		taskState.pendingModeNotice = { mode: "plan" }
		const manager = createEnvironmentManager(taskState, { taskMode: "plan" })

		const entryDetails = await manager.getEnvironmentDetails(false)
		assert.match(entryDetails, /# Current Mode\nPLAN MODE/)
		assert.match(entryDetails, /Research without modifying files/)
		assert.doesNotMatch(entryDetails, /EDITING FILES/)
		assert.equal(taskState.pendingModeNotice.includedInRequestId, "request-1")

		taskState.pendingModeNotice = undefined
		assert.equal(await manager.getEnvironmentDetails(false), "")
	})

	it("emits concise editing guidance only for a pending Act entry", async () => {
		const taskState = new TaskState()
		taskState.pendingModeNotice = { mode: "act" }
		const manager = createEnvironmentManager(taskState)

		const entryDetails = await manager.getEnvironmentDetails(false)
		assert.match(entryDetails, /# Current Mode\nACT MODE/)
		assert.match(entryDetails, /## EDITING FILES/)
		assert.match(entryDetails, /ANCHOR§CONTENT/)
		assert.doesNotMatch(entryDetails, /EDITING FILES INSTRUCTIONS/)
		assert.doesNotMatch(entryDetails, /REQUIRED `edit_file` WORKFLOW/)
		assert.equal(taskState.pendingModeNotice.includedInRequestId, "request-1")

		taskState.pendingModeNotice = undefined
		assert.equal(await manager.getEnvironmentDetails(false), "")
	})

	it("uses the request-bound mode and does not claim a newer mismatched notice", async () => {
		const planState = new TaskState()
		planState.pendingModeNotice = { mode: "plan" }
		const planRequest = createEnvironmentManager(planState, { taskMode: "act", requestMode: "plan" })
		assert.match(await planRequest.getEnvironmentDetails(false), /# Current Mode\nPLAN MODE/)
		assert.equal(planState.pendingModeNotice.includedInRequestId, "request-1")

		const actState = new TaskState()
		actState.pendingModeNotice = { mode: "act" }
		const stalePlanRequest = createEnvironmentManager(actState, { taskMode: "act", requestMode: "plan" })
		assert.equal(await stalePlanRequest.getEnvironmentDetails(false), "")
		assert.deepEqual(actState.pendingModeNotice, { mode: "act" })
	})
})
