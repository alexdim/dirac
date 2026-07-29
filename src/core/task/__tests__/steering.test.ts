import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import Mutex from "p-mutex"
import sinon from "sinon"
import { DiracMessageType, SteeringTranscriptStatus, TaskStatus } from "@shared/ExtensionMessage"
import { Task } from "../index"
import { formatSteeringMessages, SteeringDeliveryState } from "../steering"
import { TaskState } from "../TaskState"

function createSteerableTask() {
	const messages: any[] = []
	const task = Object.create(Task.prototype) as any
	task.taskState = new TaskState()
	task.taskState.status = TaskStatus.EXECUTING_TOOL
	task.stateMutex = new Mutex()
	task.taskMessenger = { generateId: sinon.stub().returns("transcript-1") }
	task.messageStateHandler = {
		addToDiracMessages: sinon.stub().callsFake(async (message) => messages.push(message)),
		findMessageIndexById: sinon.stub().callsFake((id: string) => messages.findIndex((message) => message.id === id)),
		getDiracMessages: sinon.stub().callsFake(() => messages),
		updateDiracMessage: sinon.stub().callsFake(async (index: number, update: any) => Object.assign(messages[index], update)),
	}
	task.postStateToWebview = sinon.stub().resolves()
	return { task, messages }
}

describe("Task steering inbox", () => {
	it("enqueues a queued user transcript message without interrupting task state", async () => {
		const { task, messages } = createSteerableTask()

		await task.enqueueSteeringMessage("Use <existing> & safe helpers.")

		assert.equal(task.taskState.status, TaskStatus.EXECUTING_TOOL)
		assert.equal(task.taskState.didRejectTool, false)
		assert.equal(task.taskState.steeringMessages.length, 1)
		assert.equal(task.taskState.steeringMessages[0].deliveryState, SteeringDeliveryState.QUEUED)
		assert.equal(messages.length, 1)
		assert.equal(messages[0].content.type, DiracMessageType.MARKDOWN)
		assert.equal(messages[0].content.role, "user")
		assert.deepEqual(messages[0].content.steering, { status: SteeringTranscriptStatus.QUEUED })
	})

	it("claims FIFO messages, escapes XML, and marks transcripts sent on commit", async () => {
		const { task, messages } = createSteerableTask()
		task.taskMessenger.generateId.onFirstCall().returns("transcript-1").onSecondCall().returns("transcript-2")
		await task.enqueueSteeringMessage("First <message>")
		await task.enqueueSteeringMessage("Second & message")

		const claim = await task.claimSteeringMessages()
		assert.deepEqual(claim.messages.map((message: any) => message.text), ["First <message>", "Second & message"])
		const formatted = formatSteeringMessages(claim.messages)
		assert.ok(formatted.includes("<steering_message>First &lt;message&gt;</steering_message>"))
		assert.ok(formatted.includes("<steering_message>Second &amp; message</steering_message>"))

		await task.commitSteeringClaim(claim.id)
		assert.deepEqual(task.taskState.steeringMessages.map((message: any) => message.deliveryState), [
			SteeringDeliveryState.SENT,
			SteeringDeliveryState.SENT,
		])
		assert.deepEqual(messages.map((message) => message.content.steering), [
			{ status: SteeringTranscriptStatus.SENT },
			{ status: SteeringTranscriptStatus.SENT },
		])
	})

	it("rolls a failed request claim back while leaving later guidance queued", async () => {
		const { task } = createSteerableTask()
		task.taskMessenger.generateId.onFirstCall().returns("transcript-1").onSecondCall().returns("transcript-2")
		await task.enqueueSteeringMessage("Claim me")
		const claim = await task.claimSteeringMessages()
		await task.enqueueSteeringMessage("Arrived after claim")

		await task.rollbackSteeringClaim(claim.id)

		assert.deepEqual(task.taskState.steeringMessages.map((message: any) => message.deliveryState), [
			SteeringDeliveryState.QUEUED,
			SteeringDeliveryState.QUEUED,
		])
	})

	it("restores only queued steering from transcript metadata", () => {
		const { task, messages } = createSteerableTask()
		messages.push(
			{
				id: "queued-transcript",
				ts: 1,
				content: {
					type: DiracMessageType.MARKDOWN,
					content: "Restore me",
					role: "user",
					steering: { status: SteeringTranscriptStatus.QUEUED },
				},
			},
			{
				id: "sent-transcript",
				ts: 2,
				content: {
					type: DiracMessageType.MARKDOWN,
					content: "Already sent",
					role: "user",
					steering: { status: SteeringTranscriptStatus.SENT },
				},
			},
		)

		task.restoreQueuedSteeringFromTranscript()

		assert.deepEqual(task.taskState.steeringMessages, [
			{
				id: "queued-transcript",
				text: "Restore me",
				createdAt: 1,
				transcriptMessageId: "queued-transcript",
				deliveryState: SteeringDeliveryState.QUEUED,
			},
		])
	})


	it("queued steering supersedes an uncommitted attempt completion", async () => {
		const { task } = createSteerableTask()
		task.taskState.didAttemptCompletion = true
		await task.enqueueSteeringMessage("Continue before completing")

		assert.equal(await task.commitAttemptCompletion(), false)
		assert.equal(task.taskState.didAttemptCompletion, false)
		assert.equal(task.taskState.status, TaskStatus.EXECUTING_TOOL)
	})

	it("commits completion when no steering was queued", async () => {
		const { task } = createSteerableTask()
		task.taskState.didAttemptCompletion = true

		assert.equal(await task.commitAttemptCompletion(), true)
		assert.equal(task.taskState.completionCommitted, true)
		assert.equal(task.taskState.askResponse, undefined)
		assert.equal(task.taskState.askResponseText, undefined)
		assert.equal(task.taskState.status, TaskStatus.EXECUTING_TOOL)
	})

	it("preserves a follow-up submitted after completion was sealed", async () => {
		const { task } = createSteerableTask()
		task.taskState.askResponse = "message"
		task.taskState.askResponseText = "Immediate follow-up"

		const followUp = await task.waitForFollowUp()

		assert.deepEqual(followUp, [{ type: "text", text: "Immediate follow-up" }])
	})

	it("does not let a stale plan-response flag reject steering without a waiting card", async () => {
		const { task } = createSteerableTask()
		task.taskState.isAwaitingPlanResponse = true

		assert.equal(task.canAcceptSteeringMessage(), true)
		await task.enqueueSteeringMessage("Continue with the active task")
		assert.equal(task.taskState.steeringMessages.length, 1)
	})


})
