import { strict as assert } from "node:assert"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskController } from "./TaskController"
import { Logger } from "@/shared/services/Logger"

describe("TaskController task replacement", () => {
	afterEach(() => sinon.restore())

	function createController(): TaskController {
		return new (TaskController as any)({})
	}

	it("starts an approved replacement even when the old task run rejects", async () => {
		const controller = createController()
		const replacement = { context: "replacement context", images: ["image"], files: ["file"] }
		const latestWorkingConfiguration = {
			revision: 4,
			settings: { mode: "act" },
			apiConfiguration: {},
			workspaceConfiguration: {},
			executionOptions: {},
		} as any
		const task = {
			taskState: { pendingTaskReplacement: replacement },
			getWorkingConfiguration: () => latestWorkingConfiguration,
		} as any
		controller.task = task
		const ownerOptions = { runtimeConfigurationOverrides: { mode: "plan", autoApproveAllToggled: true } } as const
		;(controller as any).currentInitializationOptions = ownerOptions
		const controllerInternals = controller as any
		const initTask = sinon.stub(controller, "initTask").callsFake(async () => {
			assert.equal(task.taskState.pendingTaskReplacement, replacement)
			controllerInternals._taskRunPromise = Promise.resolve()
			return "replacement-task-id"
		})

		await (controller as any).runTaskWithReplacement(task, Promise.reject(new Error("old task unwind failed")))

		sinon.assert.calledOnceWithExactly(
			initTask,
			replacement.context,
			replacement.images,
			replacement.files,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				workingConfiguration: latestWorkingConfiguration,
			},
		)
		const replacementOptions = initTask.firstCall.args[7]!
		assert.equal(replacementOptions.workingConfiguration, latestWorkingConfiguration)
		assert.equal(replacementOptions.runtimeConfigurationOverrides, undefined)
		assert.equal(task.taskState.pendingTaskReplacement, undefined)
	})

	it("retains the approved replacement and surfaces replacement initialization failure", async () => {
		const controller = createController()
		const replacement = { context: "replacement context" }
		const task = { taskState: { pendingTaskReplacement: replacement } } as any
		controller.task = task
		const initializationFailure = new Error("replacement initialization failed")
		sinon.stub(controller, "initTask").rejects(initializationFailure)

		await assert.rejects(
			() => (controller as any).runTaskWithReplacement(task, Promise.resolve()),
			(error: unknown) => error === initializationFailure,
		)
		assert.equal(task.taskState.pendingTaskReplacement, replacement)
	})

	it("propagates the old task failure when no replacement was approved", async () => {
		const controller = createController()
		const task = { taskState: { pendingTaskReplacement: undefined } } as any
		controller.task = task
		const oldTaskFailure = new Error("old task failed")

		await assert.rejects(
			() => (controller as any).runTaskWithReplacement(task, Promise.reject(oldTaskFailure)),
			(error: unknown) => error === oldTaskFailure,
		)
	})

	it("observes detached task failures while preserving them for callers", async () => {
		const controller = createController()
		const failure = new Error("task loop failed")
		const log = sinon.stub(Logger, "error")

		;(controller as any).trackTaskRun(Promise.reject(failure))
		await Promise.resolve()

		sinon.assert.calledWith(log, "Task run failed", failure)
		await assert.rejects(
			() => controller.taskRunPromise!,
			(error: unknown) => error === failure,
		)
	})
})

describe("TaskController task isolation", () => {
	afterEach(() => sinon.restore())

	it("does not cancel a task installed while an older task is aborting", async () => {
		let releaseAbort!: () => void
		const abortGate = new Promise<void>((resolve) => {
			releaseAbort = resolve
		})
		const oldTask = {
			taskId: "old-task",
			taskState: { isApiRequestActive: false },
			abortTask: sinon.stub().returns(abortGate),
		} as any
		const newTask = {
			taskId: "new-task",
			taskState: { isApiRequestActive: false },
			abortTask: sinon.stub().resolves(),
		} as any
		const controller = new (TaskController as any)({
			task: oldTask,
			postStateToWebview: sinon.stub().resolves(),
			getTaskWithId: sinon.stub().rejects(new Error("not found")),
			clearTaskSettings: sinon.stub().resolves(),
		}) as TaskController

		const cancellation = controller.cancelTask()
		await Promise.resolve()
		controller.task = newTask
		releaseAbort()
		await cancellation

		sinon.assert.notCalled(newTask.abortTask)
		assert.equal(newTask.taskState.abandoned, undefined)
		assert.equal(controller.task, newTask)
	})

	it("does not clear a task installed while older task settings are clearing", async () => {
		let releaseSettings!: () => void
		const settingsGate = new Promise<void>((resolve) => {
			releaseSettings = resolve
		})
		const oldTask = { abortTask: sinon.stub().resolves() } as any
		const newTask = { abortTask: sinon.stub().resolves() } as any
		const controller = new (TaskController as any)({
			task: oldTask,
			clearTaskSettings: sinon.stub().returns(settingsGate),
		}) as TaskController

		const clearing = controller.clearTask()
		await Promise.resolve()
		controller.task = newTask
		releaseSettings()
		await clearing

		sinon.assert.calledOnce(oldTask.abortTask)
		sinon.assert.notCalled(newTask.abortTask)
		assert.equal(controller.task, newTask)
	})

	it("releases an acquired task lock when initialization fails", async () => {
		const lockModule = require("../../task/TaskLockUtils")
		const releaseTaskLock = sinon.stub(lockModule, "releaseTaskLock").resolves()
		const initializationFailure = new Error("settings failed")
		const stateManager = {
			refreshModelProviderPresetsFromDisk: sinon.stub(),
			getGlobalSettingsKey: sinon.stub().returns(undefined),
			getGlobalStateKey: sinon.stub().returns(undefined),
			loadTaskSettings: sinon.stub().rejects(initializationFailure),
		} as any
		const workspaceManager = {
			getPrimaryRoot: () => ({ path: "/workspace" }),
		}
		const controller = new (TaskController as any)(
			{
				controller: {},
				stateManager,
				clearTaskSettings: sinon.stub().resolves(),
				postStateToWebview: sinon.stub().resolves(),
			},
			sinon.stub().resolves({ acquired: true, skipped: false }),
			sinon.stub().resolves(workspaceManager),
		) as TaskController

		await assert.rejects(
			() => controller.initTask("test"),
			(error: unknown) => error === initializationFailure,
		)

		sinon.assert.calledOnce(releaseTaskLock)
	})

	it("captures task working configuration after persisted settings and runtime overrides", async () => {
		const order: string[] = []
		const workingConfiguration = {
			revision: 1,
			settings: { shellIntegrationTimeout: 4321, terminalOutputLineLimit: 250, defaultTerminalProfile: "zsh" },
			apiConfiguration: {},
			workspaceConfiguration: {},
			executionOptions: {
				terminalReuseEnabled: false,
				vscodeTerminalExecutionMode: "backgroundExec",
				multiRootEnabled: false,
			},
		}
		const capture = sinon.stub().callsFake((runtimeOverrides: unknown) => {
			order.push("capture")
			assert.deepEqual(runtimeOverrides, { mode: "plan" })
			return workingConfiguration
		})
		const stateManager = {
			refreshModelProviderPresetsFromDisk: sinon.stub(),
			getGlobalStateKey: sinon.stub().returns(undefined),
			loadTaskSettings: sinon.stub().callsFake(async () => order.push("load")),
			setTaskSettingsBatch: sinon.stub().callsFake(() => order.push("persisted")),
			captureEffectiveTaskConfiguration: capture,
		} as any
		const workspaceManager = { getPrimaryRoot: () => ({ path: "/workspace" }) }
		const controller = new (TaskController as any)(
			{
				controller: {},
				stateManager,
				clearTaskSettings: sinon.stub().resolves(),
				postStateToWebview: sinon.stub().resolves(),
			},
			sinon.stub().resolves({ acquired: false, skipped: true }),
			sinon.stub().resolves(workspaceManager),
		) as TaskController

		await assert.rejects(
			() =>
				controller.initTask("test", undefined, undefined, undefined, { mode: "act" }, undefined, undefined, {
					runtimeConfigurationOverrides: { mode: "plan" },
				}),
			/HostProvider|Either historyItem|undefined/,
		)
		assert.deepEqual(order.slice(0, 3), ["load", "persisted", "capture"])
	})
	it("reconstructs from the latest committed task configuration instead of constructor-time overrides", async () => {
		const originalOwnerOptions = {
			runtimeConfigurationOverrides: { mode: "act", autoApproveAllToggled: false },
		} as const
		const latestWorkingConfiguration = {
			revision: 7,
			settings: { mode: "plan", autoApproveAllToggled: true },
		} as any
		const historyItem = { id: "persisted-task" } as any
		const task = { getWorkingConfiguration: () => latestWorkingConfiguration } as any
		const controller = new (TaskController as any)({
			task,
			getTaskWithId: sinon.stub().resolves({ historyItem }),
		}) as TaskController
		;(controller as any).currentInitializationOptions = originalOwnerOptions
		const initTask = sinon.stub(controller, "initTask").resolves(historyItem.id)

		await controller.reinitExistingTaskFromId(historyItem.id)

		sinon.assert.calledOnce(initTask)
		assert.equal(initTask.firstCall.args[3], historyItem)
		const reconstructionOptions = initTask.firstCall.args[7]!
		assert.equal(reconstructionOptions.workingConfiguration, latestWorkingConfiguration)
		assert.equal(reconstructionOptions.runtimeConfigurationOverrides, undefined)
	})

	it("forwards the owning runtime through cancellation recreation after defaults change", async () => {
		const ownerOptions = {
			runtimeConfigurationOverrides: { mode: "plan", autoApproveAllToggled: true, yoloModeToggled: false },
		} as const
		const historyItem = { id: "cancelled-task" } as any
		const latestWorkingConfiguration = {
			revision: 5,
			settings: { mode: "act", autoApproveAllToggled: false, yoloModeToggled: false },
		} as any
		const task = {
			taskId: historyItem.id,
			taskState: { isApiRequestActive: false },
			abortTask: sinon.stub().resolves(),
			getWorkingConfiguration: () => latestWorkingConfiguration,
		} as any
		const postStateToWebview = sinon.stub().resolves()
		const controller = new (TaskController as any)({
			task,
			getTaskWithId: sinon.stub().resolves({ historyItem }),
			postStateToWebview,
		}) as TaskController
		;(controller as any).currentInitializationOptions = ownerOptions
		;(controller as any).currentConversationUlid = "conversation"
		const initTask = sinon.stub(controller, "initTask").callsFake(async (...args: any[]) => {
			assert.equal(args[7].workingConfiguration, latestWorkingConfiguration)
			assert.equal(args[7].runtimeConfigurationOverrides, undefined)
			return historyItem.id
		})

		await controller.cancelTask()

		sinon.assert.calledOnce(initTask)
		assert.equal(initTask.firstCall.args[3], historyItem)
		assert.equal(initTask.firstCall.args[5], "conversation")
		sinon.assert.calledOnce(postStateToWebview)
	})
})
