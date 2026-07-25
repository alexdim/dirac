import type { DiracMessage } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { useChatStore } from "../chatStore"

describe("useChatStore", () => {
	beforeEach(() => {
		useChatStore.setState({
			diracMessages: [],
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
		const messages: DiracMessage[] = [{ ts: 1, type: "say", say: "text", text: "hello" }]

		act(() => {
			result.current.setDiracMessages(messages)
		})

		expect(result.current.diracMessages).toEqual(messages)
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
})
