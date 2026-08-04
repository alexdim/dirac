import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { EnvironmentManager } from "../EnvironmentManager"
import { TaskState } from "../TaskState"

function createEnvironmentManager(taskState: TaskState): EnvironmentManager {
	return new EnvironmentManager({
		cwd: "/test/project",
		terminalManager: {} as any,
		taskState,
		fileContextTracker: {} as any,
		api: {} as any,
		messageStateHandler: {} as any,
		stateManager: {
			getGlobalSettingsKey: (key: string) => key === "mode" ? "act" : false,
			getGlobalStateKey: () => false,
		} as any,
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
})
