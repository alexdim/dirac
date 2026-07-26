import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { DiracMessageType } from "@shared/ExtensionMessage"
import { TaskMessenger } from "../TaskMessenger"

function createMessenger() {
	const messages: any[] = []
	const messageStateHandler = {
		addToDiracMessages: sinon.stub().callsFake(async (message) => {
			messages.push(message)
		}),
		findMessageIndexById: sinon.stub().callsFake((id: string) => messages.findIndex((message) => message.id === id)),
		getDiracMessages: sinon.stub().callsFake(() => messages),
		updateDiracMessage: sinon.stub().resolves(),
	}
	const taskState: any = { waitingCardIds: [] }
	const messenger = new TaskMessenger({
		taskState,
		messageStateHandler,
		postStateToWebview: sinon.stub().resolves(),
		stateManager: {} as any,
		taskId: "task-1",
		getCurrentProviderInfo: sinon.stub(),
	} as any)
	return { messenger, messages }
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
})
