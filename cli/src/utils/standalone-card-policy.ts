import { CardStatus, type Card } from "@shared/ExtensionMessage"
import { DiracAskResponse } from "@shared/WebviewMessage"

export enum StandaloneCardDisposition {
	NONE = "none",
	AUTO_APPROVE = "auto_approve",
	FAIL_FOR_FEEDBACK = "fail_for_feedback",
	FAIL_FOR_APPROVAL = "fail_for_approval",
}

interface CardResponseTask {
	submitCardResponse: (
		cardId: string,
		response: DiracAskResponse,
		text?: string,
		images?: string[],
		files?: string[],
		value?: string,
	) => Promise<unknown>
}

interface CardResponseController {
	task?: CardResponseTask
}

export function getStandaloneCardDisposition(
	card: Card,
	yolo: boolean,
	isViewTaskOnly: boolean,
): StandaloneCardDisposition {
	if (card.status !== CardStatus.WAITING_FOR_INPUT || isViewTaskOnly) return StandaloneCardDisposition.NONE
	if (yolo && card.requireApproval) return StandaloneCardDisposition.AUTO_APPROVE
	if (card.requireFeedback) return StandaloneCardDisposition.FAIL_FOR_FEEDBACK
	if (card.requireApproval) return StandaloneCardDisposition.FAIL_FOR_APPROVAL
	return StandaloneCardDisposition.NONE
}

export async function approveCardForPlainTextYolo(controller: CardResponseController, card: Card): Promise<void> {
	const task = controller.task
	if (!task) throw new Error("Cannot approve a card without an active task")
	const primaryActionValue = card.actions?.find((action) => action.primary)?.value
	await task.submitCardResponse(
		card.id,
		DiracAskResponse.APPROVE,
		undefined,
		undefined,
		undefined,
		primaryActionValue,
	)
}
