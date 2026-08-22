import { strict as assert } from "node:assert"
import { CardStatus, DiracMessageType, TaskStatus } from "@shared/ExtensionMessage"
import { describe, it } from "mocha"
import pWaitFor from "p-wait-for"
import sinon from "sinon"
import { DiracAskResponse } from "@shared/WebviewMessage"
import { ToolSkippedByUserMessage } from "../tools/types/ToolSkippedByUserMessage"
import { TaskMessenger } from "../TaskMessenger"

function createMessenger(postStateToWebview = sinon.stub().resolves()) {
	const messages: any[] = []
	const messageStateHandler = {
		addToDiracMessages: sinon.stub().callsFake(async (message) => {
			messages.push(message)
		}),
		findMessageIndexById: sinon.stub().callsFake((id: string) => messages.findIndex((message) => message.id === id)),
		getDiracMessages: sinon.stub().callsFake(() => messages),
		updateDiracMessage: sinon.stub().resolves(),
		flushPendingWrites: sinon.stub().resolves(),
	}
	const taskState: any = { waitingCardIds: [] }
	const messenger = new TaskMessenger({
		taskState,
		messageStateHandler,
		postStateToWebview,
		getWorkingConfiguration: () => ({ settings: { hooksEnabled: false }, apiConfiguration: {} }) as any,
		taskId: "task-1",
		getCurrentProviderInfo: sinon.stub(),
	} as any)
	return { messenger, messages, taskState, messageStateHandler, postStateToWebview }
}

describe("TaskMessenger text authorship", () => {
	it("defaults non-user text to assistant", async () => {
		const { messenger, messages } = createMessenger()

		await messenger.upsertText("Model update")

		assert.equal(messages[0].content.type, DiracMessageType.MARKDOWN)
		assert.equal(messages[0].content.role, "assistant")
	})

	it("marks model streams as assistant-authored", async () => {
		const { messenger, messages } = createMessenger()

		await messenger.streamText("markdown")

		assert.equal(messages[0].content.type, DiracMessageType.MARKDOWN)
		assert.equal(messages[0].content.role, "assistant")
	})

	it("preserves explicit user authorship", async () => {
		const { messenger, messages } = createMessenger()

		await messenger.upsertText("User guidance", false, undefined, undefined, "user")

		assert.equal(messages[0].content.type, DiracMessageType.MARKDOWN)
		assert.equal(messages[0].content.role, "user")
	})

	it("collapses approval cards when they reach a final status", async () => {
		const { messenger, messages, messageStateHandler } = createMessenger()
		const card = await messenger.createCard({
			header: "Execute: git add .",
			requireApproval: true,
			collapsed: false,
		})

		await card.finalize(CardStatus.CANCELLED)

		assert.equal(messages[0].content.card.status, CardStatus.CANCELLED)
		assert.equal(messages[0].content.card.collapsed, true)
		sinon.assert.calledOnce(messageStateHandler.flushPendingWrites)
	})

	it("does not block card lifecycle operations on state delivery", async () => {
		const postStateToWebview = sinon.stub().returns(new Promise<void>(() => {}))
		const { messenger, messages, messageStateHandler } = createMessenger(postStateToWebview)

		const card = await messenger.createCard({ header: "Long-running publication" })
		await card.update({ body: "updated" })
		await card.finalize(CardStatus.SUCCESS)

		assert.equal(messages[0].content.card.body, "updated")
		assert.equal(messages[0].content.card.status, CardStatus.SUCCESS)
		sinon.assert.calledOnce(messageStateHandler.flushPendingWrites)
		assert.equal(postStateToWebview.callCount, 3)
	})

	it("accepts a chat message while awaiting card input and clears the wait", async () => {
		const { messenger, messages, taskState, messageStateHandler } = createMessenger()
		const card = await messenger.createCard({
			header: "Proposed Plan",
			requireFeedback: true,
			collapsed: false,
		})

		const interaction = card.waitForInteraction()
		await pWaitFor(() => taskState.status === TaskStatus.AWAITING_USER_INPUT)
		sinon.assert.calledOnce(messageStateHandler.flushPendingWrites)
		taskState.askResponse = DiracAskResponse.MESSAGE
		taskState.askResponseText = "Revise step two"

		await assert.rejects(interaction, ToolSkippedByUserMessage)

		assert.deepEqual(taskState.waitingCardIds, [])
		assert.equal(messages.at(-1).content.type, DiracMessageType.MARKDOWN)
		assert.equal(messages.at(-1).content.role, "user")
		assert.equal(messages.at(-1).content.content, "Revise step two")
	})

	it("treats an attachment-only chat response as skipping pending input", async () => {
		const { messenger, taskState } = createMessenger()
		const card = await messenger.createCard({ header: "Permission", requireApproval: true })

		const interaction = card.waitForInteraction()
		await pWaitFor(() => taskState.status === TaskStatus.AWAITING_USER_INPUT)
		taskState.askResponse = DiracAskResponse.MESSAGE
		taskState.askResponseFiles = ["notes.txt"]

		await assert.rejects(interaction, ToolSkippedByUserMessage)
		assert.deepEqual(taskState.waitingCardIds, [])
	})

	it("resolves a waiting tool permission when live auto-approval is enabled", async () => {
		const { messenger, taskState } = createMessenger()
		let autoApprove = false
		const card = await messenger.createCard({
			header: "Permission",
			requireApproval: true,
			isAutoApproved: () => autoApprove,
		})

		const interaction = card.waitForInteraction()
		await pWaitFor(() => taskState.status === TaskStatus.AWAITING_USER_INPUT)
		autoApprove = true

		const result = await interaction
		assert.equal(result.response, DiracAskResponse.APPROVE)
		assert.equal(result.action, DiracAskResponse.APPROVE)
		assert.equal(result.value, DiracAskResponse.APPROVE)
		assert.equal(typeof result.askTs, "number")
		assert.deepEqual(taskState.waitingCardIds, [])
	})

})
