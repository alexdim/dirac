import {
	type Card,
	type DiracMessage,
	DiracMessageType,
	type ExtensionState,
	isFinalStatus,
	type TaskStatus,
} from "@shared/ExtensionMessage"

import { EmptyRequest } from "@shared/proto/dirac/common"
import { create } from "zustand"
import { StateServiceClient } from "@/shared/api/grpc-client"

interface ChatState {
	diracMessages: DiracMessage[]
	uiActionState?: ExtensionState["uiActionState"]
	activeVoiceStreamId?: string
	isApiRequestActive?: boolean
	taskStatus?: TaskStatus
	cardCollapsedStates: Record<string, boolean>
	cardUserToggledStates: Record<string, boolean>

	// Actions
	setDiracMessages: (messages: DiracMessage[]) => void
	setCardCollapsedState: (cardId: string, collapsed: boolean, userToggled?: boolean) => void
	clearCardCollapsedStates: () => void

	// Hydration
	hydrate: () => () => void
}

function cardsById(messages: DiracMessage[]): Map<string, Card> {
	const cards = new Map<string, Card>()
	for (const message of messages) {
		if (message.content.type === DiracMessageType.CARD) {
			cards.set(message.content.card.id, message.content.card)
		}
	}
	return cards
}

function synchronizeResolvedCardCollapse(state: ChatState, messages: DiracMessage[]): Partial<ChatState> {
	const previousCards = cardsById(state.diracMessages)
	const collapsedCardIds = messages.flatMap((message) => {
		if (message.content.type !== DiracMessageType.CARD) return []

		const card = message.content.card
		const previousCard = previousCards.get(card.id)
		const permissionWasResolved =
			card.requireApproval === true &&
			card.collapsed === true &&
			isFinalStatus(card.status) &&
			(previousCard === undefined || !isFinalStatus(previousCard.status))

		return permissionWasResolved ? [card.id] : []
	})

	if (collapsedCardIds.length === 0) return { diracMessages: messages }

	const cardCollapsedStates = { ...state.cardCollapsedStates }
	const cardUserToggledStates = { ...state.cardUserToggledStates }
	for (const cardId of collapsedCardIds) {
		cardCollapsedStates[cardId] = true
		cardUserToggledStates[cardId] = false
	}
	return { diracMessages: messages, cardCollapsedStates, cardUserToggledStates }
}

export const useChatStore = create<ChatState>((set) => ({
	diracMessages: [],
	uiActionState: undefined,
	activeVoiceStreamId: undefined,
	isApiRequestActive: false,
	taskStatus: undefined,
	cardCollapsedStates: {},
	cardUserToggledStates: {},

	setDiracMessages: (messages) => set((state) => synchronizeResolvedCardCollapse(state, messages)),
	setCardCollapsedState: (cardId, collapsed, userToggled = false) =>
		set((state) => ({
			cardCollapsedStates: { ...state.cardCollapsedStates, [cardId]: collapsed },
			cardUserToggledStates: { ...state.cardUserToggledStates, [cardId]: userToggled },
		})),
	clearCardCollapsedStates: () => set({ cardCollapsedStates: {}, cardUserToggledStates: {} }),

	hydrate: () => {
		const cleanup = StateServiceClient.subscribeToState({} as EmptyRequest, {
			onResponse: (state) => {
				if (!state.stateJson) return
				const parsedState = JSON.parse(state.stateJson) as ExtensionState

				if (parsedState.diracMessages) {
					set((state) => ({
						...synchronizeResolvedCardCollapse(state, parsedState.diracMessages),
						uiActionState: parsedState.uiActionState,
						activeVoiceStreamId: parsedState.activeVoiceStreamId,
						isApiRequestActive: parsedState.isApiRequestActive,
						taskStatus: parsedState.taskStatus,
					}))
				}
			},
			onError: (error) => {
				console.error("Error in chatStore state subscription:", error)
			},
			onComplete: () => {},
		})
		return cleanup
	},
}))
