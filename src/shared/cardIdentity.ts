import { Card, CardKind, CardStatus } from "./ExtensionMessage"

export enum CardHeader {
	TASK_COMPLETED = "Task Completed",
	LEGACY_TASK_COMPLETION = "Completion Result",
	RESUME_TASK = "Resume Task",
	RESUME_COMPLETED_TASK = "Resume Completed Task",
}

function inferLegacyCardKind(header: string): CardKind {
	switch (header) {
		case CardHeader.TASK_COMPLETED:
		case CardHeader.LEGACY_TASK_COMPLETION:
			return CardKind.TASK_COMPLETION
		case CardHeader.RESUME_TASK:
			return CardKind.RESUME_TASK
		case CardHeader.RESUME_COMPLETED_TASK:
			return CardKind.RESUME_COMPLETED_TASK
		default:
			return CardKind.GENERIC
	}
}

export function getCardKind(card: Card): CardKind {
	return card.kind ?? inferLegacyCardKind(card.header)
}

export function isTaskCompletionCard(card: Card): boolean {
	return getCardKind(card) === CardKind.TASK_COMPLETION
}

export function isSuccessfulTaskCompletionCard(card: Card): boolean {
	return isTaskCompletionCard(card) && card.status === CardStatus.SUCCESS
}

export function isResumePromptCard(card: Card): boolean {
	const kind = getCardKind(card)
	return kind === CardKind.RESUME_TASK || kind === CardKind.RESUME_COMPLETED_TASK
}
