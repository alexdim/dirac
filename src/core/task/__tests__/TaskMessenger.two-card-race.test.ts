import assert from "node:assert/strict"
import { CardStatus, TaskStatus } from "@shared/ExtensionMessage"
import { DiracAskResponse } from "@shared/WebviewMessage"
import { describe, it } from "mocha"
import pWaitFor from "p-wait-for"
import sinon from "sinon"
import { submitCardResponse } from "../TaskUserInput"
import { TaskMessenger } from "../TaskMessenger"

describe("T-CARD-RACE U23", () => {
	it("keeps card A unchanged while a response for card B resolves B", async () => {
		const messages: any[] = []
		const taskState: any = { waitingCardIds: [] }
		const messenger = new TaskMessenger({
			taskState,
			messageStateHandler: {
				addToDiracMessages: async (message: any) => messages.push(message),
				findMessageIndexById: (id: string) => messages.findIndex((message) => message.id === id),
				getDiracMessages: () => messages,
				updateDiracMessage: sinon.stub().resolves(),
				flushPendingWrites: sinon.stub().resolves(),
			},
			postStateToWebview: sinon.stub().resolves(),
			stateManager: { getGlobalSettingsKey: sinon.stub().returns(false) },
			taskId: "two-card-race",
			getCurrentProviderInfo: sinon.stub(),
		} as any)

		const cardA = await messenger.createCard({ header: "A", requireApproval: true })
		const cardB = await messenger.createCard({ header: "B", requireApproval: true })
		const interactionA = cardA.waitForInteraction()
		await pWaitFor(() => taskState.status === TaskStatus.AWAITING_USER_INPUT)

		await submitCardResponse(
			{ taskState },
			{ cardId: cardB.id, response: DiracAskResponse.YES },
		)

		assert.equal(messages[0].content.card.status, CardStatus.WAITING_FOR_INPUT)
		const interactionB = cardB.waitForInteraction()
		const bResolved = await Promise.race([
			interactionB.then(() => true, () => false),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
		])
		taskState.abort = true
		await Promise.allSettled([interactionA, interactionB])
		assert.equal(bResolved, true)
	})
})
