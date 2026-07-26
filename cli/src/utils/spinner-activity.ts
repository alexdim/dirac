import { CardStatus, DiracMessageType, type DiracMessage, type ExtensionState } from "@shared/ExtensionMessage"

export interface SpinnerActivity {
	isActive: boolean
	startTime?: number
}

export function getSpinnerActivity(state: Partial<ExtensionState>): SpinnerActivity {
	const messages = state.diracMessages || []
	if (messages.length === 0) return { isActive: false }

	let lastRealMessage: DiracMessage | undefined
	let lastApiStatusTime: number | undefined
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (message.content.type === DiracMessageType.API_STATUS) {
			lastApiStatusTime ??= message.ts
			continue
		}
		lastRealMessage = message
		break
	}

	if (lastRealMessage?.content.type === DiracMessageType.CARD) {
		const card = lastRealMessage.content.card
		if (card.requireApproval || card.requireFeedback) return { isActive: false }
		if (
			card.status === CardStatus.RUNNING ||
			card.status === CardStatus.BUILDING ||
			card.status === CardStatus.PENDING
		) {
			return { isActive: true, startTime: lastRealMessage.ts }
		}
	}

	if (lastRealMessage && state.activeVoiceStreamId === lastRealMessage.id) {
		return { isActive: true, startTime: lastRealMessage.ts }
	}

	if (state.isApiRequestActive) {
		return { isActive: true, startTime: lastApiStatusTime ?? lastRealMessage?.ts }
	}

	return { isActive: false }
}
