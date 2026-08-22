import assert from "node:assert/strict"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, it } from "mocha"
import sinon from "sinon"
import { EnvironmentManager } from "../EnvironmentManager"
import { TaskState } from "../TaskState"

function createEnvironmentManager(taskState: TaskState, cwd = "/test/project"): EnvironmentManager {
	return new EnvironmentManager({
		cwd,
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

	it("T-WALK-BUDGET U24/U29 bounds the file walk and stops after abort", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-environment-"))
		const taskState = new TaskState()
		const manager = createEnvironmentManager(taskState, cwd)
		const stat = sinon.stub(fs, "stat").callsFake(async () => {
			stat.callCount === 1 && (taskState.abort = true)
			return { mtime: new Date() } as any
		})

		try {
			await Promise.all(
				Array.from({ length: 25 }, (_, index) => fs.writeFile(path.join(cwd, `file-${index}.ts`), "export {}")),
			)
			await manager.getEnvironmentDetails(true)
			assert.ok(stat.callCount <= 10, `walk stat calls were not bounded: ${stat.callCount}`)
		} finally {
			stat.restore()
			await fs.rm(cwd, { recursive: true, force: true })
		}
	})
})
