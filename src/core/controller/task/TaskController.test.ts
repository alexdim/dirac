import { strict as assert } from "node:assert"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskController } from "./TaskController"

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
})
