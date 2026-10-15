---
component_id: 16
component_name: Webview UI Components
---

# Webview UI Components

## Component Description

Provides React components for the webview interface, including the chat store, modular chat views, history view, settings panels, and shared UI primitives.

---

## Key References:

### /Users/highlands/pools/Development/dirac/webview-ui/src/features/chat/store/chatStore.ts (lines 17-45)
```
interface ChatState {
	diracMessages: DiracMessage[]
	messageIndexById: Map<string, number>
	presentationSurfaceId?: string
	presentationOffset: number
	presentationRevision: number
	presentationAppends: Map<string, { revision: number; chunks: string[] }>
	visibleMessageIds: string[]
	visibleMessageIdSet: Set<string>
	apiMetrics: ApiMetrics
	lastApiReqInfo?: DiracApiReqInfo
	latestRequestStatusId?: string
	taskMessage?: DiracMessage
	lastMessage?: DiracMessage
	secondLastMessage?: DiracMessage
	goal?: NonNullable<ExtensionState["goal"]>
	uiActionState?: ExtensionState["uiActionState"]
	activeVoiceStreamId?: string
	isApiRequestActive?: boolean
	taskStatus?: TaskStatus
	cardCollapsedStates: Record<string, boolean>
	cardUserToggledStates: Record<string, boolean>

	applyExtensionState: (state: Partial<ExtensionState>) => void
	applyPresentationBatch: (batch: PresentationBatch) => PresentationApplyResult
	setDiracMessages: (messages: DiracMessage[]) => void
	setCardCollapsedState: (cardId: string, collapsed: boolean, userToggled?: boolean) => void
	clearCardCollapsedStates: () => void
}
```

### /Users/highlands/pools/Development/dirac/webview-ui/src/features/modular-ui/chat/ModularChatView.tsx (lines 29-172)
```
export const ModularChatView: React.FC<ChatViewProps> = ({ isHidden, showAnnouncement, hideAnnouncement, showHistoryView }) => {
	const showNavbar = useShowNavbar()
	const version = useAppStore((state) => state.version)
	const { messages, task, renderedMessageIds, apiMetrics, lastApiReqInfo } = useChatStore(
		useShallow((state) => ({
			messages: state.diracMessages,
			task: state.taskMessage,
			renderedMessageIds: state.visibleMessageIds,
			apiMetrics: state.apiMetrics,
			lastApiReqInfo: state.lastApiReqInfo,
		})),
	)
	const goal = useChatStore((state) => state.goal)
	const taskHistory = useTaskStore((state) => state.taskHistory)
	const apiConfiguration = useSettingsStore((state) => state.apiConfiguration)
	const telemetrySetting = useSettingsStore((state) => state.telemetrySetting)
	const mode = useSettingsStore((state) => state.mode)
	const effectiveMode = goal?.mode ?? mode
	const shouldShowQuickWins = !!taskHistory && taskHistory.length > 0

	const chatState = useChatState()
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

	const scrollBehavior = useScrollBehavior(messages, renderedMessageIds, renderedMessageIds, expandedRows, setExpandedRows)

	const placeholderText = useMemo(() => {
		if (goal?.followUpActive) return "Steer this follow-up…"
		if (goal?.status === "working") return "Steer this Goal…"
		if (goal?.status === "waiting") return "Steer this Goal while requests await a response…"
		if (goal?.status === "paused") return "Ask a follow-up (Goal stays paused)…"
		if (goal?.status === "blocked") return "Ask a follow-up (Goal stays blocked)…"
		if (goal?.status === "achieved" || goal?.status === "stopped") return "Ask a follow-up…"
		if (!task) return "Type your task here..."
		if (interactionState === InteractionState.RUNNING) return "Send guidance for the next turn without interrupting…"
		return "Type a message..."
	}, [goal, task, interactionState])

	const context = useMemo<ChatViewContext>(
		() => ({
			goal,
			task,
			renderedMessageIds,
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
			renderedMessageIds,
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
```

### /Users/highlands/pools/Development/dirac/webview-ui/src/features/settings/components/SettingsView/SettingsView.tsx (lines 113-234)
```
const SettingsView = ({ onDone, targetSection }: SettingsViewProps) => {
	const version = useSettingsStore((state) => state.version)
	const environment = useSettingsStore((state) => state.environment)
	const initialTarget = resolveSettingsTarget(targetSection)
	const [activeTab, setActiveTab] = useState<SettingsTabID>(initialTarget.tab)
	const [focusTarget, setFocusTarget] = useState(initialTarget.focusId)

	const selectTarget = useCallback((target?: string) => {
		const resolved = resolveSettingsTarget(target)
		setActiveTab(resolved.tab)
		setFocusTarget(resolved.focusId)
	}, [])
	useEffect(() => selectTarget(targetSection), [selectTarget, targetSection])
	useEffect(() => {
		if (!focusTarget) return
		requestAnimationFrame(() => {
			const element = document.getElementById(focusTarget)
			if (!element) return
			element.scrollIntoView({ behavior: "smooth", block: "center" })
			element.classList.add("settings-target-highlight")
			window.setTimeout(() => element.classList.remove("settings-target-highlight"), 1200)
			setFocusTarget(undefined)
		})
	}, [activeTab, focusTarget])

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			if (message.type !== "grpc_response") return
			const grpcMessage = message.grpc_response?.message
			if (grpcMessage?.key === "scrollToSettings" && grpcMessage.value) selectTarget(grpcMessage.value)
		},
		[selectTarget],
	)
	useEvent("message", handleMessage)

	const handleResetState = useCallback(async (resetGlobalState?: boolean) => {
		try {
			await StateServiceClient.resetState(ResetStateRequest.create({ global: resetGlobalState }))
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}, [])

	const renderSectionHeader = useCallback((tabId: string) => {
		const tab = SETTINGS_TABS.find((candidate) => candidate.id === tabId)
		if (!tab) return null
		const presentation = SETTINGS_DESTINATIONS[tab.id]
		return (
			<SectionHeader description={presentation.question}>
				<div className="flex items-center gap-2">
					<tab.icon className="w-4" />
					<div>{presentation.label}</div>
				</div>
			</SectionHeader>
		)
	}, [])

	const ActiveContent = useMemo(() => {
		const Component = TAB_CONTENT_MAP[activeTab]
		const props: any = { renderSectionHeader }
		if (activeTab === "general") {
			if (IS_DEV) props.onResetState = handleResetState
			props.version = version
		}
		return <Component {...props} />
	}, [activeTab, handleResetState, renderSectionHeader, version])

	return (
		<Tab>
			<ViewHeader environment={environment} onDone={onDone} title="Settings" />
			<div className="flex flex-1 overflow-hidden">
				<TabList
					aria-label="Settings destinations"
					aria-orientation="vertical"
					className="settings-tab-list shrink-0 flex flex-col overflow-y-auto border-r border-sidebar-background"
					onValueChange={(value) => setActiveTab(value as SettingsTabID)}
					value={activeTab}>
					{SETTINGS_TABS.map((tab) => {
						const presentation = SETTINGS_DESTINATIONS[tab.id]
						return (
							<Tooltip key={tab.id}>
								<TooltipTrigger asChild>
									<TabTrigger
										aria-controls={`settings-panel-${tab.id}`}
										aria-label={presentation.label}
										className={cn(
											"settings-tab-trigger w-full whitespace-nowrap overflow-hidden h-12 box-border flex items-center border-l-2 border-transparent text-left text-foreground opacity-70 bg-transparent hover:bg-list-hover px-4 cursor-pointer gap-2",
											activeTab === tab.id && "opacity-100 border-l-foreground bg-selection",
										)}
										data-testid={`tab-${tab.id}`}
										id={`settings-tab-${tab.id}`}
										value={tab.id}>
										<tab.icon aria-hidden="true" className="settings-tab-icon w-4 h-4" />
										<span className="settings-tab-label">{presentation.label}</span>
										<span aria-hidden="true" className="settings-tab-compact-label">
											{presentation.compactLabel}
										</span>
									</TabTrigger>
								</TooltipTrigger>
								<TooltipContent
									className="settings-nav-tooltip max-w-xs"
									showArrow={false}
									side="right"
									sideOffset={6}>
									{presentation.webviewTooltip}
								</TooltipContent>
							</Tooltip>
						)
					})}
				</TabList>
				<TabContent
					aria-labelledby={`settings-tab-${activeTab}`}
					className="flex-1 overflow-auto"
					id={`settings-panel-${activeTab}`}
					role="tabpanel">
					{ActiveContent}
				</TabContent>
			</div>
		</Tab>
	)
}
```

### /Users/highlands/pools/Development/dirac/webview-ui/src/features/modular-ui/ModularCard.tsx (lines 17-71)
```
export const ModularCard: React.FC<ModularCardProps> = ({ card, isActive, onAction }) => {
	const storedCollapsed = useChatStore((state) => state.cardCollapsedStates[card.id])
	const userToggled = useChatStore((state) => state.cardUserToggledStates[card.id] ?? false)
	const setCardCollapsedState = useChatStore((state) => state.setCardCollapsedState)
	const terminalAutoCollapse = isFinalStatus(card.status) && !card.do_not_auto_collapse && !userToggled
	const protocolOrAutomaticState = card.collapsed ?? (terminalAutoCollapse ? true : undefined)
	const isCollapsed = userToggled
		? (storedCollapsed ?? initialCollapsedState(card))
		: (protocolOrAutomaticState ?? storedCollapsed ?? initialCollapsedState(card))
	const { status, body, autoScroll } = card
	const bodyId = `card-body-${card.id}`

	// Persist protocol/default state before paint so virtualization remounts cannot
	// restore an obsolete disclosure value. A user choice remains authoritative
	// until the task changes.
	useLayoutEffect(() => {
		if (userToggled || protocolOrAutomaticState === undefined) return
		if (storedCollapsed !== protocolOrAutomaticState) {
			setCardCollapsedState(card.id, protocolOrAutomaticState, false)
		}
	}, [card.id, protocolOrAutomaticState, setCardCollapsedState, storedCollapsed, userToggled])

	const scrollRef = useAutoScroll({
		dependency: body,
		enabled: autoScroll ?? status === CardStatus.RUNNING,
	})

	const toggleCollapsed = () => {
		setCardCollapsedState(card.id, !isCollapsed, true)
	}

	return (
		<div
			className={cn(
				"modular-card my-px flex flex-col overflow-hidden",
				isCollapsed
					? "bg-transparent"
					: "rounded-md border border-foreground/10 bg-foreground/[0.025] shadow-[0_1px_2px_color-mix(in_srgb,var(--vscode-widget-shadow)_18%,transparent)]",
			)}>
			<ModularCardHeader
				card={card}
				contentId={bodyId}
				isCollapsed={isCollapsed}
				onAction={onAction}
				onToggleCollapse={toggleCollapsed}
			/>

			{!isCollapsed && (
				<div id={bodyId}>
					<ModularCardBody card={card} isActive={isActive} onAction={onAction} scrollRef={scrollRef} />
				</div>
			)}
		</div>
	)
}
```


## Source Files:

- `webview-ui/src/App.stories.tsx`
- `webview-ui/src/app/App.tsx`
- `webview-ui/src/app/Providers.tsx`
- `webview-ui/src/app/store/appStore.ts`
- `webview-ui/src/config/StorybookDecorator.tsx`
- `webview-ui/src/config/platform.config.ts`
- `webview-ui/src/context/DiracAuthContext.tsx`
- `webview-ui/src/entities/task/store/taskStore.ts`
- `webview-ui/src/entities/user/store/userStore.ts`
- `webview-ui/src/features/banners/hooks/useBannerAction.ts`
- `webview-ui/src/features/chat/components/ChatView/ChatView.tsx`
- `webview-ui/src/features/chat/store/chatStore.ts`
- `webview-ui/src/features/dirac-rules/components/DiracRulesToggleModal.tsx`
- `webview-ui/src/features/dirac-rules/components/HookRow.tsx`
- `webview-ui/src/features/dirac-rules/components/NewRuleRow.tsx`
- `webview-ui/src/features/dirac-rules/components/RuleRow.tsx`
- `webview-ui/src/features/dirac-rules/components/RulesToggleList.tsx`
- `webview-ui/src/features/history/components/HistoryView/HistoryView.tsx`
- `webview-ui/src/features/history/components/HistoryViewItem.tsx`
- `webview-ui/src/features/modular-ui/ApiStatusOverlay.tsx`
- `webview-ui/src/features/modular-ui/CheckpointMarker.tsx`
- `webview-ui/src/features/modular-ui/ModularCard.tsx`
- `webview-ui/src/features/modular-ui/ModularDiffView.tsx`
- `webview-ui/src/features/modular-ui/ModularMarkdown.stories.tsx`
- `webview-ui/src/features/modular-ui/ModularMarkdown.tsx`
- `webview-ui/src/features/modular-ui/ReasoningTimeline.tsx`
- `webview-ui/src/features/modular-ui/chat/ModularChatTextArea.tsx`
- `webview-ui/src/features/modular-ui/chat/ModularChatView.tsx`
- `webview-ui/src/features/modular-ui/chat/components/ActionButtons.tsx`
- `webview-ui/src/features/modular-ui/chat/components/AutoApprove/AutoApproveBar.tsx`
- `webview-ui/src/features/modular-ui/chat/components/AutoApprove/AutoApproveMenuItem.tsx`
- `webview-ui/src/features/modular-ui/chat/components/AutoApprove/AutoApproveModal.tsx`
- `webview-ui/src/features/modular-ui/chat/components/AutoApprove/AutoApproveSettingsAPI.ts`
- `webview-ui/src/features/modular-ui/chat/components/AutoApprove/types.ts`
- `webview-ui/src/features/modular-ui/chat/components/ChatLayout.tsx`
- `webview-ui/src/features/modular-ui/chat/components/ChatRow.tsx`
- `webview-ui/src/features/modular-ui/chat/components/ContextMenu.tsx`
- `webview-ui/src/features/modular-ui/chat/components/GoalHeader/GoalHeader.tsx`
- `webview-ui/src/features/modular-ui/chat/components/HistoryPreview.tsx`
- `webview-ui/src/features/modular-ui/chat/components/InputPrimitive.tsx`
- `webview-ui/src/features/modular-ui/chat/components/MessageRow.tsx`
- `webview-ui/src/features/modular-ui/chat/components/MessagesArea.tsx`
- `webview-ui/src/features/modular-ui/chat/components/ModularWelcomeSection.tsx`
- `webview-ui/src/features/modular-ui/chat/components/SlashCommandMenu.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/CheckpointError.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/ContextWindow.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/ContextWindowSummary.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/Highlights.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/TaskHeader.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/buttons/CopyTaskButton.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/buttons/DeleteTaskButton.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/buttons/OpenDiskConversationHistoryButton.tsx`
- `webview-ui/src/features/modular-ui/chat/components/TaskHeader/getCostLabel.ts`
- `webview-ui/src/features/modular-ui/chat/components/TaskStatusIndicator.tsx`
- `webview-ui/src/features/modular-ui/chat/components/VirtuosoItemRenderer.tsx`
- `webview-ui/src/features/modular-ui/chat/context/InteractionStateContext.tsx`
- `webview-ui/src/features/modular-ui/chat/decorators/ActionDecorator.tsx`
- `webview-ui/src/features/modular-ui/chat/decorators/HighlightDecorator.tsx`
- `webview-ui/src/features/modular-ui/chat/decorators/OverlayDecorator.tsx`
- `webview-ui/src/features/modular-ui/chat/decorators/view/ActionButtonsDecorator.tsx`
- `webview-ui/src/features/modular-ui/chat/decorators/view/AutoApproveDecorator.tsx`
- `webview-ui/src/features/modular-ui/chat/hooks/useChatState.ts`
- `webview-ui/src/features/modular-ui/chat/hooks/useMessageHandlers.ts`
- `webview-ui/src/features/modular-ui/chat/hooks/useModularInput.ts`
- `webview-ui/src/features/modular-ui/chat/hooks/useScrollBehavior.ts`
- `webview-ui/src/features/modular-ui/chat/sections/GoalSection.tsx`
- `webview-ui/src/features/modular-ui/chat/sections/InputSection.tsx`
- `webview-ui/src/features/modular-ui/chat/sections/MessagesSection.tsx`
- `webview-ui/src/features/modular-ui/chat/sections/TaskSection.tsx`
- `webview-ui/src/features/modular-ui/chat/sections/WelcomeSection.tsx`
- `webview-ui/src/features/modular-ui/chat/traits/useFileHandlingTrait.ts`
- `webview-ui/src/features/modular-ui/chat/traits/useMentionTrait.ts`
- `webview-ui/src/features/modular-ui/chat/traits/useModeTrait.ts`
- `webview-ui/src/features/modular-ui/chat/traits/useSlashCommandTrait.ts`
- `webview-ui/src/features/modular-ui/chat/types.ts`
- `webview-ui/src/features/modular-ui/chat/types/chatRowTypes.ts`
- `webview-ui/src/features/modular-ui/chat/types/chatTypes.ts`
- `webview-ui/src/features/modular-ui/chat/utils/messageUtils.ts`
- `webview-ui/src/features/modular-ui/chat/utils/text-utils.ts`
- `webview-ui/src/features/modular-ui/components/CardActions.tsx`
- `webview-ui/src/features/modular-ui/components/CardContent.tsx`
- `webview-ui/src/features/modular-ui/components/CardStatusIcon.tsx`
- `webview-ui/src/features/modular-ui/components/IncrementalText.tsx`
- `webview-ui/src/features/modular-ui/components/MarkdownRow.tsx`
- `webview-ui/src/features/modular-ui/components/ModularCardBody.tsx`
- `webview-ui/src/features/modular-ui/components/ModularCardHeader.tsx`
- `webview-ui/src/features/modular-ui/components/QuoteButton.tsx`
- `webview-ui/src/features/modular-ui/components/SubagentAvatar.tsx`
- `webview-ui/src/features/modular-ui/components/TaskFeedbackButtons.tsx`
- `webview-ui/src/features/modular-ui/components/ThinkingRow.tsx`
- `webview-ui/src/features/modular-ui/components/UserMessageContent.tsx`
- `webview-ui/src/features/modular-ui/decorators/AskQuestionDecorator.tsx`
- `webview-ui/src/features/modular-ui/decorators/BugReportDecorator.tsx`
- `webview-ui/src/features/modular-ui/decorators/CompletionDecorator.tsx`
- `webview-ui/src/features/modular-ui/decorators/DiffDecorator.tsx`
- `webview-ui/src/features/modular-ui/decorators/HookDecorator.tsx`
- `webview-ui/src/features/modular-ui/decorators/SearchDecorator.tsx`
- `webview-ui/src/features/modular-ui/decorators/TerminalDecorator.tsx`
- `webview-ui/src/features/modular-ui/decorators/types.ts`
- `webview-ui/src/features/modular-ui/hooks/useQuoteLogic.ts`
- `webview-ui/src/features/modular-ui/types.ts`
- `webview-ui/src/features/modular-ui/utils/newTaskCard.ts`
- `webview-ui/src/features/settings/components/ApiOptions.tsx`
- `webview-ui/src/features/settings/components/AutoCondenseContextLimitSetting.tsx`
- `webview-ui/src/features/settings/components/BasetenModelPicker.tsx`
- `webview-ui/src/features/settings/components/FeaturedModelCard.tsx`
- `webview-ui/src/features/settings/components/GroqModelPicker.tsx`
- `webview-ui/src/features/settings/components/HuggingFaceModelPicker.tsx`
- `webview-ui/src/features/settings/components/InferenceSpeedSelector.tsx`
- `webview-ui/src/features/settings/components/ModelDescriptionMarkdown.tsx`
- `webview-ui/src/features/settings/components/OpenRouterModelPicker.tsx`
- `webview-ui/src/features/settings/components/OpenRouterRoutingControls.tsx`
- `webview-ui/src/features/settings/components/ReasoningEffortSelector.tsx`
- `webview-ui/src/features/settings/components/RequestyModelPicker.tsx`
- `webview-ui/src/features/settings/components/SettingsSlider.tsx`
- `webview-ui/src/features/settings/components/SettingsView/SettingsView.tsx`
- `webview-ui/src/features/settings/components/ThinkingBudgetSlider.tsx`
- `webview-ui/src/features/settings/components/UseCustomPromptCheckbox.tsx`
- `webview-ui/src/features/settings/components/UtilityModelSelection.tsx`
- `webview-ui/src/features/settings/components/VercelModelPicker.tsx`
- `webview-ui/src/features/settings/components/common/ApiKeyField.tsx`
- `webview-ui/src/features/settings/components/common/BaseUrlField.tsx`
- `webview-ui/src/features/settings/components/common/DebouncedTextField.tsx`
- `webview-ui/src/features/settings/components/common/ErrorMessage.tsx`
- `webview-ui/src/features/settings/components/common/ModelAutocomplete.tsx`
- `webview-ui/src/features/settings/components/common/ModelInfoView.tsx`
- `webview-ui/src/features/settings/components/common/ModelSelector.tsx`
- `webview-ui/src/features/settings/components/common/RemotelyConfiguredInputWrapper.tsx`
- `webview-ui/src/features/settings/components/providers/AihubmixProvider.tsx`
- `webview-ui/src/features/settings/components/providers/AnthropicProvider.tsx`
- `webview-ui/src/features/settings/components/providers/BasetenProvider.tsx`
- `webview-ui/src/features/settings/components/providers/BedrockProvider.tsx`
- `webview-ui/src/features/settings/components/providers/CerebrasProvider.tsx`
- `webview-ui/src/features/settings/components/providers/ClaudeCodeProvider.tsx`
- `webview-ui/src/features/settings/components/providers/DeepSeekProvider.tsx`
- `webview-ui/src/features/settings/components/providers/DifyProvider.tsx`
- `webview-ui/src/features/settings/components/providers/DoubaoProvider.tsx`
- `webview-ui/src/features/settings/components/providers/FireworksProvider.tsx`
- `webview-ui/src/features/settings/components/providers/GeminiProvider.tsx`
- `webview-ui/src/features/settings/components/providers/GithubCopilotProvider.tsx`
- `webview-ui/src/features/settings/components/providers/GroqProvider.tsx`
- `webview-ui/src/features/settings/components/providers/HuaweiCloudMaasProvider.tsx`
- `webview-ui/src/features/settings/components/providers/HuggingFaceProvider.tsx`
- `webview-ui/src/features/settings/components/providers/LMStudioProvider.tsx`
- `webview-ui/src/features/settings/components/providers/LiteLlmProvider.tsx`
- `webview-ui/src/features/settings/components/providers/MiniMaxProvider.tsx`
- `webview-ui/src/features/settings/components/providers/MistralProvider.tsx`
- `webview-ui/src/features/settings/components/providers/MoonshotProvider.tsx`
- `webview-ui/src/features/settings/components/providers/NebiusProvider.tsx`
- `webview-ui/src/features/settings/components/providers/NousresearchProvider.tsx`
- `webview-ui/src/features/settings/components/providers/OpenAICompatible.tsx`
- `webview-ui/src/features/settings/components/providers/OpenAINative.tsx`
- `webview-ui/src/features/settings/components/providers/OpenAiCodexProvider.tsx`
- `webview-ui/src/features/settings/components/providers/OpenRouterProvider.tsx`
- `webview-ui/src/features/settings/components/providers/QwenCodeProvider.tsx`
- `webview-ui/src/features/settings/components/providers/QwenProvider.tsx`
- `webview-ui/src/features/settings/components/providers/RequestyProvider.tsx`
- `webview-ui/src/features/settings/components/providers/SambanovaProvider.tsx`
- `webview-ui/src/features/settings/components/providers/TogetherProvider.tsx`
- `webview-ui/src/features/settings/components/providers/UnbiasedProvider.tsx`
- `webview-ui/src/features/settings/components/providers/VSCodeLmProvider.tsx`
- `webview-ui/src/features/settings/components/providers/VercelAIGatewayProvider.tsx`
- `webview-ui/src/features/settings/components/providers/VertexProvider.tsx`
- `webview-ui/src/features/settings/components/providers/WandbProvider.tsx`
- `webview-ui/src/features/settings/components/providers/XaiProvider.tsx`
- `webview-ui/src/features/settings/components/providers/ZAiProvider.tsx`
- `webview-ui/src/features/settings/components/providers/openai-codex/OpenAiCodexAccountCard.tsx`
- `webview-ui/src/features/settings/components/providers/openai-codex/OpenAiCodexActivity.tsx`
- `webview-ui/src/features/settings/components/providers/openai-codex/OpenAiCodexLimitRow.tsx`
- `webview-ui/src/features/settings/components/providers/openai-codex/OpenAiCodexProvider.stories.tsx`
- `webview-ui/src/features/settings/components/providers/openai-codex/OpenAiCodexSignIn.tsx`
- `webview-ui/src/features/settings/components/providers/openai-codex/OpenAiCodexUsagePanel.tsx`
- `webview-ui/src/features/settings/components/providers/openai-codex/formatOpenAiCodexUsage.ts`
- `webview-ui/src/features/settings/components/sections/AboutSection.tsx`
- `webview-ui/src/features/settings/components/sections/ApiConfigurationSection.tsx`
- `webview-ui/src/features/settings/components/sections/ApprovalsSettingsSection.tsx`
- `webview-ui/src/features/settings/components/sections/BrowserSettingsSection.tsx`
- `webview-ui/src/features/settings/components/sections/DebugSection.tsx`
- `webview-ui/src/features/settings/components/sections/FeatureSettingsSection.tsx`
- `webview-ui/src/features/settings/components/sections/GeneralSettingsSection.tsx`
- `webview-ui/src/features/settings/components/sections/ResponsesContextSection.tsx`
- `webview-ui/src/features/settings/components/sections/RunningTasksSection.tsx`
- `webview-ui/src/features/settings/components/sections/TerminalSettingsSection.tsx`
- `webview-ui/src/features/settings/components/sections/ToolTogglePanel.tsx`
- `webview-ui/src/features/settings/components/sections/ToolsSettingsSection.tsx`
- `webview-ui/src/features/settings/components/sections/UserApprovedCommandsSection.tsx`
- `webview-ui/src/features/settings/components/sections/UtilityModelSection.tsx`
- `webview-ui/src/features/settings/components/utils/providerUtils.ts`
- `webview-ui/src/features/settings/components/utils/settingsHandlers.ts`
- `webview-ui/src/features/settings/components/utils/useApiConfigurationHandlers.ts`
- `webview-ui/src/features/settings/components/utils/useDebouncedInput.ts`
- `webview-ui/src/features/settings/store/modelsStore.ts`
- `webview-ui/src/features/settings/store/settingsStore.ts`
- `webview-ui/src/features/worktrees/components/CreateWorktreeModal.tsx`
- `webview-ui/src/features/worktrees/components/DeleteWorktreeModal.tsx`
- `webview-ui/src/features/worktrees/components/WorktreesView.tsx`
- `webview-ui/src/lib/utils.ts`
- `webview-ui/src/setupTests.ts`
- `webview-ui/src/shared/api/grpc-client-base.ts`
- `webview-ui/src/shared/api/grpc-client.ts`
- `webview-ui/src/shared/api/vscode.ts`
- `webview-ui/src/shared/hooks/useAutoApproveActions.ts`
- `webview-ui/src/shared/hooks/useAutoApproveAll.ts`
- `webview-ui/src/shared/hooks/useAutoScroll.ts`
- `webview-ui/src/shared/hooks/useMenuAnnouncement.ts`
- `webview-ui/src/shared/hooks/useRelinquishControl.ts`
- `webview-ui/src/shared/lib/bannerUtils.tsx`
- `webview-ui/src/shared/lib/context-mentions.ts`
- `webview-ui/src/shared/lib/environmentColors.ts`
- `webview-ui/src/shared/lib/format.ts`
- `webview-ui/src/shared/lib/getConfiguredProviders.ts`
- `webview-ui/src/shared/lib/getLanguageFromPath.ts`
- `webview-ui/src/shared/lib/hooks.ts`
- `webview-ui/src/shared/lib/platformUtils.ts`
- `webview-ui/src/shared/lib/slash-commands.ts`
- `webview-ui/src/shared/lib/useDebounceEffect.ts`
- `webview-ui/src/shared/lib/useThrottledValue.ts`
- `webview-ui/src/shared/lib/validate.ts`
- `webview-ui/src/shared/lib/vscStyles.ts`
- `webview-ui/src/shared/ui/AlertDialog.tsx`
- `webview-ui/src/shared/ui/BannerCarousel.tsx`
- `webview-ui/src/shared/ui/BrowserSettingsMenu.tsx`
- `webview-ui/src/shared/ui/CopyButton.tsx`
- `webview-ui/src/shared/ui/Demo.tsx`
- `webview-ui/src/shared/ui/LightMarkdown.tsx`
- `webview-ui/src/shared/ui/MarkdownBlock.tsx`
- `webview-ui/src/shared/ui/MermaidBlock.tsx`
- `webview-ui/src/shared/ui/Navbar.tsx`
- `webview-ui/src/shared/ui/PopupModalContainer.tsx`
- `webview-ui/src/shared/ui/QuotedMessagePreview.tsx`
- `webview-ui/src/shared/ui/ReleaseNotesModal.tsx`
- `webview-ui/src/shared/ui/ScreenReaderAnnounce.tsx`
- `webview-ui/src/shared/ui/SuccessButton.tsx`
- `webview-ui/src/shared/ui/Tab.tsx`
- `webview-ui/src/shared/ui/TabButton.tsx`
- `webview-ui/src/shared/ui/TelemetryBanner.tsx`
- `webview-ui/src/shared/ui/Thumbnails.tsx`
- `webview-ui/src/shared/ui/VSCodeButtonLink.tsx`
- `webview-ui/src/shared/ui/WhatsNewItems.tsx`
- `webview-ui/src/shared/ui/WhatsNewModal.tsx`
- `webview-ui/src/shared/ui/alert.tsx`
- `webview-ui/src/shared/ui/badge.stories.tsx`
- `webview-ui/src/shared/ui/badge.tsx`
- `webview-ui/src/shared/ui/button.stories.tsx`
- `webview-ui/src/shared/ui/button.tsx`
- `webview-ui/src/shared/ui/dialog.stories.tsx`
- `webview-ui/src/shared/ui/dialog.tsx`
- `webview-ui/src/shared/ui/hooks/useOpenRouterKeyInfo.ts`
- `webview-ui/src/shared/ui/hover-card.tsx`
- `webview-ui/src/shared/ui/input.tsx`
- `webview-ui/src/shared/ui/item.tsx`
- `webview-ui/src/shared/ui/label.tsx`
- `webview-ui/src/shared/ui/popover.tsx`
- `webview-ui/src/shared/ui/progress.tsx`
- `webview-ui/src/shared/ui/select.stories.tsx`
- `webview-ui/src/shared/ui/select.tsx`
- `webview-ui/src/shared/ui/separator.tsx`
- `webview-ui/src/shared/ui/slider.tsx`
- `webview-ui/src/shared/ui/switch.tsx`
- `webview-ui/src/shared/ui/tooltip.tsx`
- `webview-ui/vite.config.ts`

