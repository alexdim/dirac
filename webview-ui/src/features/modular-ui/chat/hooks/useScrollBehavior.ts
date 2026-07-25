import { CardStatus, DiracMessage } from "@shared/ExtensionMessage"
import { useCallback, useEffect, useRef, useState } from "react"
import { VirtuosoHandle } from "react-virtuoso"
import { CHAT_CONSTANTS } from "../constants"
import { ScrollBehavior } from "../types/chatTypes"

export function useScrollBehavior(
	messages: DiracMessage[],
	visibleMessages: DiracMessage[],
	renderedMessages: DiracMessage[],
	expandedRows: Record<string, boolean>,
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
): ScrollBehavior {
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const isFollowingRef = useRef(true)
	const isAtBottomRef = useRef(false)
	const scrollRafIdRef = useRef(0)
	const messageScrollRafIdRef = useRef(0)
	const listHeightRafIdRef = useRef(0)
	const scrollIntentRafIdRef = useRef(0)
	const lastListHeightRef = useRef(0)
	const scrollbarPointerRef = useRef(false)
	const touchYRef = useRef<number | null>(null)
	const messagesRef = useRef(messages)
	messagesRef.current = messages
	const visibleMessagesRef = useRef(visibleMessages)
	visibleMessagesRef.current = visibleMessages
	const renderedMessagesRef = useRef(renderedMessages)
	renderedMessagesRef.current = renderedMessages
	const expandedRowsRef = useRef(expandedRows)
	expandedRowsRef.current = expandedRows

	const [showScrollToBottom, setShowScrollToBottom] = useState(false)

	const stopFollowing = useCallback(() => {
		isFollowingRef.current = false
		if (!isAtBottomRef.current) {
			setShowScrollToBottom(true)
		}
	}, [])

	const startFollowing = useCallback(() => {
		isFollowingRef.current = true
		setShowScrollToBottom(false)
	}, [])

	const resumeFollowingIfAtBottom = useCallback(
		(scroller: HTMLElement) => {
			cancelAnimationFrame(scrollIntentRafIdRef.current)
			scrollIntentRafIdRef.current = requestAnimationFrame(() => {
				const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
				if (distanceFromBottom <= CHAT_CONSTANTS.AT_BOTTOM_THRESHOLD) {
					startFollowing()
				}
			})
		},
		[startFollowing],
	)

	const scrollToBottom = useCallback(
		(behavior: "auto" | "smooth") => {
			startFollowing()
			cancelAnimationFrame(scrollRafIdRef.current)
			scrollRafIdRef.current = requestAnimationFrame(() => {
				virtuosoRef.current?.scrollToIndex({
					index: "LAST",
					align: "end",
					behavior,
				})
			})
		},
		[startFollowing],
	)

	const scrollToBottomAuto = useCallback(() => {
		scrollToBottom("auto")
	}, [scrollToBottom])

	const scrollToBottomSmooth = useCallback(() => {
		const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
		scrollToBottom(prefersReducedMotion ? "auto" : "smooth")
	}, [scrollToBottom])

	const scrollToTop = useCallback(() => {
		stopFollowing()
		cancelAnimationFrame(scrollRafIdRef.current)
		scrollRafIdRef.current = requestAnimationFrame(() => {
			const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
			virtuosoRef.current?.scrollToIndex({
				index: 0,
				align: "start",
				behavior: prefersReducedMotion ? "auto" : "smooth",
			})
		})
	}, [stopFollowing])

	const scrollToMessage = useCallback(
		(messageIndex: number) => {
			const msgs = messagesRef.current
			const rendered = renderedMessagesRef.current
			const targetMessage = msgs[messageIndex]
			if (!targetMessage) return

			const visMsgs = visibleMessagesRef.current
			const visibleIndex = visMsgs.findIndex((msg) => msg.id === targetMessage.id)
			if (visibleIndex === -1) return

			const renderedIndex = rendered.findIndex((msg) => msg.id === targetMessage.id)
			if (renderedIndex === -1) return

			stopFollowing()
			cancelAnimationFrame(messageScrollRafIdRef.current)
			messageScrollRafIdRef.current = requestAnimationFrame(() => {
				const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
				virtuosoRef.current?.scrollToIndex({
					index: renderedIndex,
					align: "start",
					behavior: prefersReducedMotion ? "auto" : "smooth",
				})
			})
		},
		[stopFollowing],
	)

	const toggleRowExpansion = useCallback(
		(id: string) => {
			const currentExpandedRows = expandedRowsRef.current
			const currentRenderedMessages = renderedMessagesRef.current
			const isCollapsing = currentExpandedRows[id] ?? false
			const lastMessage = currentRenderedMessages.at(-1)
			const isLast = lastMessage?.id === id
			const secondToLastMessage = currentRenderedMessages.at(-2)
			const isSecondToLast = secondToLastMessage?.id === id

			const isLastCollapsedApiReq =
				isLast && lastMessage?.content.type === "api_status" && !currentExpandedRows[lastMessage.id]

			setExpandedRows((prev) => ({
				...prev,
				[id]: !prev[id],
			}))

			if (!isCollapsing) {
				stopFollowing()
			}
			if (isCollapsing && isAtBottomRef.current) {
				scrollToBottomAuto()
				return
			}
			if (isCollapsing && (isLast || isSecondToLast)) {
				if (isSecondToLast && !isLastCollapsedApiReq) return
				scrollToBottomAuto()
			}
		},
		[scrollToBottomAuto, setExpandedRows, stopFollowing],
	)

	useEffect(() => {
		if (!messages?.length) {
			setShowScrollToBottom(false)
		}
	}, [messages.length])

	// Scroll to bottom when a card requires user input (approval buttons appear)
	const lastCardStatusRef = useRef<string | undefined>()
	useEffect(() => {
		const lastMessage = renderedMessages.at(-1)
		if (!lastMessage) return
		const currentStatus = lastMessage.content.type === "card" ? lastMessage.content.card.status : undefined
		if (currentStatus === CardStatus.WAITING_FOR_INPUT && lastCardStatusRef.current !== CardStatus.WAITING_FOR_INPUT) {
			scrollToBottomAuto()
		}
		lastCardStatusRef.current = currentStatus
	}, [renderedMessages, scrollToBottomAuto])

	const handleAtBottomStateChange = useCallback((isAtBottom: boolean) => {
		isAtBottomRef.current = isAtBottom
		if (isAtBottom) {
			isFollowingRef.current = true
			setShowScrollToBottom(false)
			return
		}
		if (!isFollowingRef.current) {
			setShowScrollToBottom(true)
		}
	}, [])

	const handleListHeightChanged = useCallback((height: number) => {
		const listGrew = height > lastListHeightRef.current
		lastListHeightRef.current = height
		if (!listGrew || !isFollowingRef.current) return

		cancelAnimationFrame(listHeightRafIdRef.current)
		listHeightRafIdRef.current = requestAnimationFrame(() => {
			virtuosoRef.current?.autoscrollToBottom()
		})
	}, [])

	const handleScrollWheel = useCallback(
		(event: React.WheelEvent) => {
			if (event.deltaY >= 0) return
			stopFollowing()
			resumeFollowingIfAtBottom(event.currentTarget as HTMLElement)
		},
		[resumeFollowingIfAtBottom, stopFollowing],
	)

	const handleScrollKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			const scrollsUp =
				event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" || (event.key === " " && event.shiftKey)
			if (!scrollsUp) return

			stopFollowing()
			resumeFollowingIfAtBottom(event.currentTarget as HTMLElement)
		},
		[resumeFollowingIfAtBottom, stopFollowing],
	)

	const handleScrollPointerDown = useCallback(
		(event: React.PointerEvent) => {
			if (event.button === 1) {
				stopFollowing()
				return
			}

			const scroller = event.currentTarget as HTMLElement
			const scrollbarWidth = Math.max(12, scroller.offsetWidth - scroller.clientWidth)
			const scrollbarLeft = scroller.getBoundingClientRect().right - scrollbarWidth
			scrollbarPointerRef.current = event.clientX >= scrollbarLeft
			if (scrollbarPointerRef.current) stopFollowing()
		},
		[stopFollowing],
	)

	const handleScrollPointerUp = useCallback(
		(event: React.PointerEvent) => {
			if (!scrollbarPointerRef.current) return
			scrollbarPointerRef.current = false
			resumeFollowingIfAtBottom(event.currentTarget as HTMLElement)
		},
		[resumeFollowingIfAtBottom],
	)

	const handleScrollTouchStart = useCallback((event: React.TouchEvent) => {
		touchYRef.current = event.touches[0]?.clientY ?? null
	}, [])

	const handleScrollTouchMove = useCallback(
		(event: React.TouchEvent) => {
			const currentY = event.touches[0]?.clientY
			const previousY = touchYRef.current
			touchYRef.current = currentY ?? null
			if (currentY !== undefined && previousY !== null && currentY > previousY) {
				stopFollowing()
			}
		},
		[stopFollowing],
	)

	const handleScrollTouchEnd = useCallback(
		(event: React.TouchEvent) => {
			touchYRef.current = null
			resumeFollowingIfAtBottom(event.currentTarget as HTMLElement)
		},
		[resumeFollowingIfAtBottom],
	)

	const followOutput = useCallback((): "auto" | false => (isFollowingRef.current ? "auto" : false), [])

	const taskId = messages.at(0)?.id
	// biome-ignore lint/correctness/useExhaustiveDependencies: task identity intentionally resets all scroll state.
	useEffect(() => {
		isFollowingRef.current = true
		isAtBottomRef.current = false
		lastListHeightRef.current = 0
		lastCardStatusRef.current = undefined
		scrollbarPointerRef.current = false
		touchYRef.current = null
		setShowScrollToBottom(false)
		return () => {
			cancelAnimationFrame(scrollRafIdRef.current)
			cancelAnimationFrame(messageScrollRafIdRef.current)
			cancelAnimationFrame(listHeightRafIdRef.current)
			cancelAnimationFrame(scrollIntentRafIdRef.current)
		}
	}, [taskId])

	return {
		virtuosoRef,
		isFollowingRef,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		scrollToTop,
		scrollToMessage,
		toggleRowExpansion,
		showScrollToBottom,
		isAtBottomRef,
		handleAtBottomStateChange,
		handleListHeightChanged,
		handleScrollKeyDown,
		handleScrollPointerDown,
		handleScrollPointerUp,
		handleScrollTouchEnd,
		handleScrollTouchMove,
		handleScrollTouchStart,
		handleScrollWheel,
		followOutput,
	}
}
