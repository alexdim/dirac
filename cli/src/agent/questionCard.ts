import {
    CardStatus,
    type DiracMessage,
    DiracMessageType,
} from "@shared/ExtensionMessage";
import { isQuestionResponseCard, ResponseCardHeader } from "@shared/responseTool";

/** Identify cards created by the follow-up-question flow without classifying generic feedback cards. */
export function isFollowupQuestionCard(message: DiracMessage): boolean {
	if (message.content.type !== DiracMessageType.CARD) return false;

	const { card } = message.content;
	if (card.status !== CardStatus.WAITING_FOR_INPUT) return false;
	if (!card.requireFeedback || card.requireApproval) return false;

	return isQuestionResponseCard(card) || card.header.startsWith(`${ResponseCardHeader.QUESTION}:`);
}
