import "should"
import { TaskStatus, UIActionButtonType } from "@shared/ExtensionMessage"
import { TaskState } from "../TaskState"
import { projectUIActionState } from "./ui-projector"

describe("projectUIActionState", () => {
	it("shows only Start New Task for a completed task", () => {
		const state = new TaskState()
		state.status = TaskStatus.COMPLETED

		const uiState = projectUIActionState(state, [], 3)

		uiState.globalButtons.should.deepEqual([
			{
				label: "Start New Task",
				action: UIActionButtonType.NEW_TASK,
				primary: true,
			},
		])
		uiState.cardButtons.should.deepEqual([])
	})

	it("keeps Resume for a cancelled task", () => {
		const state = new TaskState()
		state.status = TaskStatus.CANCELLED

		const uiState = projectUIActionState(state, [], 3)

		uiState.globalButtons.should.deepEqual([
			{
				label: "Resume",
				action: UIActionButtonType.APPROVE,
				primary: true,
			},
		])
	})

	it("enables steering input while a task is busy", () => {
		const state = new TaskState()
		state.status = TaskStatus.EXECUTING_TOOL

		projectUIActionState(state, [], 3).sendingDisabled.should.equal(false)
	})

	it("disables sending during cancellation and active card interaction", () => {
		const cancelling = new TaskState()
		cancelling.status = TaskStatus.CANCELLING
		projectUIActionState(cancelling, [], 3).sendingDisabled.should.equal(true)

		const awaitingCard = new TaskState()
		awaitingCard.status = TaskStatus.AWAITING_USER_INPUT
		awaitingCard.waitingCardIds = ["card-1"]
		projectUIActionState(awaitingCard, [], 3).sendingDisabled.should.equal(true)
	})

})
