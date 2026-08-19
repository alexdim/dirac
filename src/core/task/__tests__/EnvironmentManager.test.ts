import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { EnvironmentManager } from "../EnvironmentManager";
import { TaskState } from "../TaskState";

function createEnvironmentManager(
	taskState: TaskState,
	options: { taskMode?: "plan" | "act"; requestMode?: "plan" | "act" } = {},
): EnvironmentManager {
	const taskMode = options.taskMode ?? "act"
	const requestMode = options.requestMode
	return new EnvironmentManager({
		cwd: "/test/project",
		terminalManager: {} as any,
		taskState,
		fileContextTracker: {} as any,
		api: {} as any,
		messageStateHandler: {} as any,
		getWorkingConfiguration: () => ({ settings: { mode: taskMode }, executionOptions: { multiRootEnabled: false } }) as any,
		getRequestRuntime: () =>
			requestMode
				? ({ workingConfiguration: { settings: { mode: requestMode }, executionOptions: { multiRootEnabled: false } } } as any)
				: undefined,
	})
}

describe("EnvironmentManager Act-mode guidance", () => {
	it("includes editing instructions only for the first Act request after switching modes", async () => {
		const taskState = new TaskState()
		const manager = createEnvironmentManager(taskState)

		taskState.didSwitchToActMode = true
		const firstActRequest = await manager.getEnvironmentDetails(false)
		assert.match(firstActRequest, /## EDITING FILES INSTRUCTIONS/)

		taskState.didSwitchToActMode = false
		const subsequentActRequest = await manager.getEnvironmentDetails(false)
		assert.doesNotMatch(subsequentActRequest, /## EDITING FILES INSTRUCTIONS/)
		assert.match(subsequentActRequest, /# Current Mode\nACT MODE/)
		assert.doesNotMatch(subsequentActRequest, /Reminder: always batch tool calls/)
	})

	it("uses the request-bound mode instead of a newer Task mode", async () => {
		const planRequest = createEnvironmentManager(new TaskState(), { taskMode: "act", requestMode: "plan" })
		const planDetails = await planRequest.getEnvironmentDetails(false)
		assert.match(planDetails, /# Current Mode\nPLAN MODE/)

		const actRequest = createEnvironmentManager(new TaskState(), { taskMode: "plan", requestMode: "act" })
		const actDetails = await actRequest.getEnvironmentDetails(false)
		assert.match(actDetails, /# Current Mode\nACT MODE/)
		assert.doesNotMatch(actDetails, /PLAN MODE/)
	})
})
