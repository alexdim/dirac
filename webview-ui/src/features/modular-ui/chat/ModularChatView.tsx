import { Mode } from "@shared/ExtensionMessage"
import { getApiMetrics, getLastApiReqInfo } from "@shared/getApiMetrics"
import React, { useEffect, useMemo } from "react"
import { useMount } from "react-use"
import { useAppStore } from "@/app/store/appStore"
import { useShowNavbar } from "@/context/PlatformContext"
import { useTaskStore } from "@/entities/task/store/taskStore"
import { useChatStore } from "@/features/chat/store/chatStore"
import { normalizeApiConfiguration } from "@/features/settings/components/utils/providerUtils"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { cn } from "@/lib/utils"
import { useThrottledValue } from "@/shared/lib/useThrottledValue"
import { Navbar } from "@/shared/ui/Navbar"
import { ChatLayout } from "./components/ChatLayout"
// Decorators
import { ActionButtonsDecorator } from "./decorators/view/ActionButtonsDecorator"
import { AutoApproveDecorator } from "./decorators/view/AutoApproveDecorator"
import { useChatState } from "./hooks/useChatState"
import { useMessageHandlers } from "./hooks/useMessageHandlers"
import { InteractionState, useInteractionState } from "./context/InteractionStateContext"
import { useScrollBehavior } from "./hooks/useScrollBehavior"
// Sections
import { InputSection } from "./sections/InputSection"
import { GoalSection } from "./sections/GoalSection"
import { MessagesSection } from "./sections/MessagesSection"
import { TaskSection } from "./sections/TaskSection"
import { WelcomeSection } from "./sections/WelcomeSection"
import { ChatSection, ChatViewContext, ChatViewDecorator, ChatViewProps } from "./types"
import { filterVisibleMessages } from "./utils/messageUtils"

export const ModularChatView: React.FC<ChatViewProps> = ({ isHidden, showAnnouncement, hideAnnouncement, showHistoryView }) => {
	const showNavbar = useShowNavbar()
	const version = useAppStore((state) => state.version)
	const messages = useChatStore((state) => state.diracMessages)
	const goal = useChatStore((state) => state.goal)
	const activeVoiceStreamId = useChatStore((state) => state.activeVoiceStreamId)
	const isApiRequestActive = useChatStore((state) => state.isApiRequestActive)
	const taskHistory = useTaskStore((state) => state.taskHistory)
	const apiConfiguration = useSettingsStore((state) => state.apiConfiguration)
	const telemetrySetting = useSettingsStore((state) => state.telemetrySetting)
	const mode = useSettingsStore((state) => state.mode)
	const effectiveMode = goal?.mode ?? mode
	const shouldShowQuickWins = !!taskHistory && taskHistory.length > 0

	const task = useMemo(() => messages.at(0), [messages])
	const streamingActive = isApiRequestActive || !!activeVoiceStreamId
	const renderedMessageSource = useThrottledValue(messages, streamingActive ? 100 : 0)

	const modifiedMessages = useMemo(() => {
		return renderedMessageSource.slice(1)
	}, [renderedMessageSource])

	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])
	const lastApiReqInfo = useMemo(() => getLastApiReqInfo(modifiedMessages), [modifiedMessages])

	const chatState = useChatState(messages)
	const { sendingDisabled, uiActionState, expandedRows, setExpandedRows, textAreaRef } = chatState

	const messageHandlers = useMessageHandlers(chatState)

	const { state: interactionState } = useInteractionState()
	const { selectedModelInfo, selectedModelId, selectedProvider } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, effectiveMode as Mode)
	}, [apiConfiguration, effectiveMode])

	useMount(() => {
		textAreaRef.current?.focus()
	})

	const hasButtons = (uiActionState?.globalButtons.length ?? 0) > 0 || (uiActionState?.cardButtons.length ?? 0) > 0
	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && !sendingDisabled && !hasButtons && document.hasFocus()) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, sendingDisabled, hasButtons, textAreaRef])

	const visibleMessages = useMemo(() => {
		return filterVisibleMessages(modifiedMessages)
	}, [modifiedMessages])

	const renderedMessages = visibleMessages

	const scrollBehavior = useScrollBehavior(messages, visibleMessages, renderedMessages, expandedRows, setExpandedRows)

	const placeholderText = useMemo(() => {
		if (goal?.status === "working" || goal?.status === "waiting") return "Steer this Goal…"
		if (goal?.status === "paused" || goal?.status === "blocked") return "Resume this Goal to continue…"
		if (goal) return "Type a new task…"
		if (!task) return "Type your task here..."
		if (interactionState === InteractionState.RUNNING) return "Send guidance for the next turn without interrupting…"
		return "Type a message..."
	}, [goal, task, interactionState])

	const context = useMemo<ChatViewContext>(
		() => ({
			goal,
			task,
			messages,
			modifiedMessages,
			renderedMessages,
			apiMetrics,
			lastApiReqInfo,
			chatState,
			messageHandlers,
			scrollBehavior,
			isHidden,
			showAnnouncement,
			hideAnnouncement,
			showHistoryView,
			version,
			taskHistory,
			shouldShowQuickWins,
			telemetrySetting,
			selectedModelInfo: {
				...selectedModelInfo,
				selectedModelId,
				selectedProvider,
				mode: effectiveMode,
			},
			placeholderText,
		}),
		[
			goal,
			task,
			messages,
			modifiedMessages,
			renderedMessages,
			apiMetrics,
			lastApiReqInfo,
			chatState,
			messageHandlers,
			scrollBehavior,
			isHidden,
			showAnnouncement,
			hideAnnouncement,
			showHistoryView,
			version,
			taskHistory,
			shouldShowQuickWins,
			telemetrySetting,
			selectedModelInfo,
			selectedModelId,
			selectedProvider,
			effectiveMode,
			placeholderText,
		],
	)

	const sections = useMemo<ChatSection[]>(() => [WelcomeSection, GoalSection, TaskSection, MessagesSection, InputSection], [])

	const decorators = useMemo<ChatViewDecorator[]>(() => [AutoApproveDecorator, ActionButtonsDecorator], [])

	return (
		<ChatLayout isHidden={isHidden}>
			<div className="modular-chat-shell flex flex-col flex-1 overflow-hidden relative">
				<div
					className={cn(
						"modular-chat-shell flex flex-col flex-1 overflow-hidden",
						effectiveMode === "plan" ? "bg-grid-plan" : "",
					)}>
					{showNavbar && <Navbar />}
					<div className="flex-1 flex flex-col overflow-hidden relative">
						{sections.map((section) => (
							<React.Fragment key={section.id}>
								{section.id !== "input" && section.shouldRender(context) && section.render(context)}
							</React.Fragment>
						))}
					</div>

					<div className="flex flex-col gap-2">
						{decorators.map((decorator) => (
							<React.Fragment key={decorator.id}>{decorator.render?.(context)}</React.Fragment>
						))}
					</div>

					<div className="px-4">{InputSection.shouldRender(context) && InputSection.render(context)}</div>
				</div>
			</div>
		</ChatLayout>
	)
}
