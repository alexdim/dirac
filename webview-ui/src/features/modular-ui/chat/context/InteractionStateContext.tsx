import React, { createContext, useContext, useMemo } from "react"
import { CardStatus, DiracMessage, DiracMessageType, isFinalStatus, TaskStatus } from "@shared/ExtensionMessage"
import { isBusyTaskStatus } from "@shared/taskStatusProjection"
import { useChatStore } from "@/features/chat/store/chatStore"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
export enum InteractionState {
	IDLE = "idle",
	RUNNING = "running",
	AWAITING_RESPONSE = "awaiting_response",
	COMPLETED = "completed",
}

interface InteractionStateContextType {
	state: InteractionState
	isPlanMode: boolean
}

const InteractionStateContext = createContext<InteractionStateContextType | undefined>(undefined)

export function projectInteractionState(params: {
	messages: readonly DiracMessage[]
	activeVoiceStreamId?: string
	isApiRequestActive?: boolean
	activeCardId?: string
	taskStatus?: TaskStatus
}): InteractionState {
	const { messages, activeVoiceStreamId, isApiRequestActive, activeCardId, taskStatus } = params
	if (taskStatus === TaskStatus.IDLE || messages.length === 0) return InteractionState.IDLE
	if (taskStatus === TaskStatus.COMPLETED) return InteractionState.COMPLETED
	if (taskStatus === TaskStatus.CANCELLED || taskStatus === TaskStatus.AWAITING_USER_INPUT) {
		return InteractionState.AWAITING_RESPONSE
	}

	const activeCardMessage = activeCardId
		? messages.find((message) => message.id === activeCardId && message.content.type === DiracMessageType.CARD)
		: [...messages]
			.reverse()
			.find(
				(message) =>
					message.content.type === DiracMessageType.CARD &&
					message.content.card.status === CardStatus.WAITING_FOR_INPUT,
			)
	if (activeCardMessage?.content.type === DiracMessageType.CARD) {
		const card = activeCardMessage.content.card
		if (
			!isFinalStatus(card.status) &&
			(card.status === CardStatus.WAITING_FOR_INPUT ||
				card.requireApproval ||
				card.requireFeedback ||
				(card.actions?.length ?? 0) > 0)
		) {
			return InteractionState.AWAITING_RESPONSE
		}
	}

	if (isApiRequestActive || activeVoiceStreamId || isBusyTaskStatus(taskStatus)) return InteractionState.RUNNING
	return InteractionState.RUNNING
}


export const InteractionStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { diracMessages: messages, activeVoiceStreamId, isApiRequestActive, taskStatus, uiActionState } = useChatStore()
	const mode = useSettingsStore((state: any) => state.mode)

	const interactionState = useMemo(
		() =>
			projectInteractionState({
				messages,
				activeVoiceStreamId,
				isApiRequestActive,
				activeCardId: uiActionState?.activeCardId,
				taskStatus,
			}),
		[messages, activeVoiceStreamId, isApiRequestActive, uiActionState?.activeCardId, taskStatus],
	)

	const value = useMemo(
		() => ({
			state: interactionState,
			isPlanMode: mode === "plan",
		}),
		[interactionState, mode],
	)

	return <InteractionStateContext.Provider value={value}>{children}</InteractionStateContext.Provider>
}

export const useInteractionState = () => {
	const context = useContext(InteractionStateContext)
	if (context === undefined) {
		throw new Error("useInteractionState must be used within an InteractionStateProvider")
	}
	return context
}
