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
		const task = { taskState: { pendingTaskReplacement: replacement } } as any
		controller.task = task
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
			undefined,
		)
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
})
