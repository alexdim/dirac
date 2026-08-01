import { CardKind, CardStatus, type DiracMessage, DiracMessageType, type ExtensionState } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { useChatStore } from "../chatStore"

function permissionCardMessage(status: CardStatus, collapsed: boolean): DiracMessage {
	return {
		id: "message-1",
		ts: 1,
		content: {
			type: DiracMessageType.CARD,
			card: {
				id: "card-1",
				kind: CardKind.GENERIC,
				header: "Execute: git add .",
				status,
				body: "git add .",
				renderType: "text",
				requireApproval: true,
				collapsed,
			},
		},
	}
}

describe("useChatStore", () => {
	beforeEach(() => {
		useChatStore.setState({
			diracMessages: [],
			uiActionState: undefined,
			activeVoiceStreamId: undefined,
			isApiRequestActive: false,
			taskStatus: undefined,
			cardCollapsedStates: {},
			cardUserToggledStates: {},
		})
	})

	it("should initialize with empty messages", () => {
		const { result } = renderHook(() => useChatStore())
		expect(result.current.diracMessages).toEqual([])
	})

	it("should set messages", () => {
		const { result } = renderHook(() => useChatStore())
		const messages: DiracMessage[] = [
			{
				id: "message-1",
				ts: 1,
				content: { type: DiracMessageType.MARKDOWN, content: "hello" },
			},
		]

		act(() => {
			result.current.setDiracMessages(messages)
		})

		expect(result.current.diracMessages).toEqual(messages)
	})

	it("applies task fields from a shared extension-state snapshot", () => {
		const messages = [permissionCardMessage(CardStatus.RUNNING, false)]
		const uiActionState = { globalButtons: [], cardButtons: [] } as ExtensionState["uiActionState"]
		const extensionState = {
			diracMessages: messages,
			uiActionState,
			activeVoiceStreamId: "message-1",
			isApiRequestActive: true,
			taskStatus: "streaming_text",
		} as ExtensionState

		useChatStore.getState().applyExtensionState(extensionState)

		expect(useChatStore.getState()).toMatchObject({
			diracMessages: messages,
			uiActionState,
			activeVoiceStreamId: "message-1",
			isApiRequestActive: true,
			taskStatus: "streaming_text",
		})
	})

	it("should track collapsed cards and user toggles", () => {
		const { result } = renderHook(() => useChatStore())

		act(() => {
			result.current.setCardCollapsedState("card-1", true, true)
		})

		expect(result.current.cardCollapsedStates).toEqual({ "card-1": true })
		expect(result.current.cardUserToggledStates).toEqual({ "card-1": true })
	})

	it("should clear collapsed card state", () => {
		const { result } = renderHook(() => useChatStore())

		act(() => {
			result.current.setCardCollapsedState("card-1", true, true)
			result.current.clearCardCollapsedStates()
		})

		expect(result.current.cardCollapsedStates).toEqual({})
		expect(result.current.cardUserToggledStates).toEqual({})
	})

	it("forces a resolved permission card closed even when the user opened it while pending", () => {
		const { setDiracMessages, setCardCollapsedState } = useChatStore.getState()
		setDiracMessages([permissionCardMessage(CardStatus.WAITING_FOR_INPUT, false)])
		setCardCollapsedState("card-1", false, true)

		useChatStore.getState().setDiracMessages([permissionCardMessage(CardStatus.SUCCESS, true)])

		expect(useChatStore.getState().cardCollapsedStates["card-1"]).toBe(true)
		expect(useChatStore.getState().cardUserToggledStates["card-1"]).toBe(false)
	})

	it("preserves a user reopening a permission card after it was resolved", () => {
		const resolvedCard = permissionCardMessage(CardStatus.SUCCESS, true)
		useChatStore.getState().setDiracMessages([resolvedCard])
		useChatStore.getState().setCardCollapsedState("card-1", false, true)

		useChatStore.getState().setDiracMessages([resolvedCard])

		expect(useChatStore.getState().cardCollapsedStates["card-1"]).toBe(false)
		expect(useChatStore.getState().cardUserToggledStates["card-1"]).toBe(true)
	})
})
