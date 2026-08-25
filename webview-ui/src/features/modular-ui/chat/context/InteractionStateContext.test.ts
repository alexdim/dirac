import { CardKind, CardStatus, DiracMessageType, TaskStatus } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { InteractionState, projectInteractionState } from "./InteractionStateContext"

function markdownMessage(id: string) {
	return {
		id,
		ts: 1,
		content: { type: DiracMessageType.MARKDOWN, content: "message" },
	}
}

function cardMessage(status: CardStatus) {
	return {
		id: "card-message",
		ts: 2,
		content: {
			type: DiracMessageType.CARD,
			card: {
				id: "card",
				kind: CardKind.GENERIC,
				header: "Question",
				status,
				renderType: "text" as const,
				requireFeedback: true,
			},
		},
	}
}

describe("projectInteractionState", () => {
	it("prioritizes a waiting card over a busy transport flag", () => {
		expect(
			projectInteractionState({
				messages: [markdownMessage("task"), cardMessage(CardStatus.WAITING_FOR_INPUT), markdownMessage("trailing")],
				activeCardId: "card-message",
				isApiRequestActive: true,
				taskStatus: TaskStatus.EXECUTING_TOOL,
			}),
		).toBe(InteractionState.AWAITING_RESPONSE)
	})

	it("keeps authoritative completion despite trailing markdown", () => {
		expect(
			projectInteractionState({
				messages: [markdownMessage("task"), markdownMessage("trailing")],
				isApiRequestActive: true,
				taskStatus: TaskStatus.COMPLETED,
			}),
		).toBe(InteractionState.COMPLETED)
	})

	it("does not treat a terminal active card as an outstanding response", () => {
		expect(
			projectInteractionState({
				messages: [markdownMessage("task"), cardMessage(CardStatus.SUCCESS)],
				activeCardId: "card-message",
				taskStatus: TaskStatus.EXECUTING_TOOL,
			}),
		).toBe(InteractionState.RUNNING)
	})
})
