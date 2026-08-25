import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Controller } from "@core/controller"
import type { StateManager } from "@core/storage/StateManager"
import { afterEach, beforeEach, describe, it } from "mocha"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { GoalController } from "../GoalController"
import { GoalStore } from "../GoalStore"

describe("GoalController startup transaction", () => {
	let storagePath: string

	beforeEach(async () => {
		storagePath = await fs.mkdtemp(path.join(os.tmpdir(), "goal-controller-"))
		setVscodeHostProviderMock({ globalStorageFsPath: storagePath })
	})

	afterEach(async () => {
		await fs.rm(storagePath, { recursive: true, force: true })
	})

	it("rolls back the Goal record without publishing history when loop construction fails", async () => {
		const history: import("@shared/HistoryItem").HistoryItem[] = []
		let historyWrites = 0
		const stateManager = {
			getGlobalStateKey: (key: string) => {
				assert.equal(key, "taskHistory")
				return history
			},
		} as unknown as StateManager
		const controller = {
			ensureWorkspaceManager: async () => undefined,
		} as unknown as Controller
		const goalController = new GoalController({
			controller,
			stateManager,
			getStandaloneTask: () => undefined,
			clearStandaloneTask: async () => {},
			updateGoalHistory: async (item) => {
				historyWrites += 1
				history.push(item)
				return history
			},
			postState: async () => {},
		})

		await assert.rejects(goalController.start("Ship it"), /initialized workspace manager/)

		assert.equal(historyWrites, 0)
		assert.deepEqual(history, [])
		assert.equal(goalController.selectedGoalId, undefined)
		assert.deepEqual(await new GoalStore().list(), [])
	})
})
