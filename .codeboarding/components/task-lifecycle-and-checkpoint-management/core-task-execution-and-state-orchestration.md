---
component_id: 10.1
component_name: Core Task Execution & State Orchestration
---

# Core Task Execution & State Orchestration

## Component Description

Orchestrates core task execution, API conversation loops, message state persistence, and checkpoint controller commands.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/task/ApiConversationManager.ts (lines 17-508)
```
export class ApiConversationManager {
	constructor(private dependencies: ApiConversationManagerDependencies) { }

	setApi(api: ApiConversationManagerDependencies["api"]): void {
		this.dependencies.api = api
	}

	private getOperationalApi(): ApiConversationManagerDependencies["api"] {
		return this.dependencies.getRequestRuntime()?.api ?? this.dependencies.api
	}

	public async scheduleProviderConversationCompaction(
		previousConversationHistoryDeletedRange: [number, number] | undefined,
		conversationHistoryDeletedRange: [number, number],
	): Promise<void> {
		const pendingCompaction = { previousConversationHistoryDeletedRange, conversationHistoryDeletedRange }
		this.dependencies.taskState.pendingApiConversationCompaction = pendingCompaction
		const providerState = this.dependencies.messageStateHandler.getApiConversationProviderState()
		await this.dependencies.messageStateHandler.overwriteApiConversationProviderState({
			...providerState,
			pendingCompaction,
		})
	}

	public calculatePreCompactDeletedRange(apiConversationHistory: DiracStorageMessage[]): [number, number] {
		const newDeletedRange = this.dependencies.contextManager.getNextTruncationRange(
			apiConversationHistory,
			this.dependencies.taskState.conversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation on error
		)

		return newDeletedRange || [0, 0]
	}

	public async handleContextWindowExceededError(): Promise<void> {
		const apiConversationHistory = this.dependencies.messageStateHandler.getApiConversationHistory()

		// Run PreCompact hook before truncation
		const hooksEnabled = getHooksEnabledSafe(this.dependencies.getWorkingConfiguration().settings.hooksEnabled)
		if (hooksEnabled) {
			try {
				// Calculate what the new deleted range will be
				const deletedRange = this.calculatePreCompactDeletedRange(apiConversationHistory)

				// Execute hook - throws HookCancellationError if cancelled
				await executePreCompactHookWithCleanup({
					taskId: this.dependencies.taskId,
					ulid: this.dependencies.ulid,
					modelContext: getTaskHookModelContext(
						this.getOperationalApi(),
						this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration(),
					),
					apiConversationHistory,
					conversationHistoryDeletedRange: this.dependencies.taskState.conversationHistoryDeletedRange,
					contextManager: this.dependencies.contextManager,
					diracMessages: this.dependencies.messageStateHandler.getDiracMessages(),
					messageStateHandler: this.dependencies.messageStateHandler,
					compactionStrategy: "standard-truncation-lastquarter",
					deletedRange,
					messenger: this.dependencies.taskMessenger,
					setActiveHookExecution: this.dependencies.setActiveHookExecution.bind(this.dependencies),
					clearActiveHookExecution: this.dependencies.clearActiveHookExecution.bind(this.dependencies),
					postStateToWebview: this.dependencies.postStateToWebview.bind(this.dependencies),
					taskState: this.dependencies.taskState,
					cancelTask: this.dependencies.cancelTask.bind(this.dependencies),
					hooksEnabled,
				})
			} catch (error) {
				// If hook was cancelled, re-throw to stop compaction
				if (error instanceof HookCancellationError) {
					throw error
				}

				// Graceful degradation: Log error but continue with truncation
				Logger.error("[PreCompact] Hook execution failed:", error)
			}
		}

		// Proceed with standard truncation
		const previousConversationHistoryDeletedRange = this.dependencies.taskState.conversationHistoryDeletedRange
		const newDeletedRange = this.dependencies.contextManager.getNextTruncationRange(
			apiConversationHistory,
			previousConversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation
		)

		this.dependencies.taskState.conversationHistoryDeletedRange = newDeletedRange
		if (newDeletedRange) {
			await this.scheduleProviderConversationCompaction(previousConversationHistoryDeletedRange, newDeletedRange)
		}

		await this.dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory()
		this.dependencies.onContextCompacted?.()
	}

	public async determineContextCompaction(previousApiReqIndex: number): Promise<boolean> {
		const useAutoCondense = this.dependencies.getRequestRuntime()?.workingConfiguration.settings.useAutoCondense ??
			this.dependencies.getWorkingConfiguration().settings.useAutoCondense
		if (!useAutoCondense) return false

		if (this.dependencies.taskState.skipNextAutoCondenseCheck) {
			this.dependencies.taskState.skipNextAutoCondenseCheck = false
			return false
		}

		const providerId = this.dependencies.getCurrentProviderInfo().providerId
		const configuredLimit = getAutoCondenseContextLimit(
			(this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration()).settings.autoCondenseContextLimits,
			providerId,
		)
		const shouldCompact = this.dependencies.contextManager.shouldCompactContextWindow(
			this.dependencies.messageStateHandler.getDiracMessages(),
			this.getOperationalApi(),
			previousApiReqIndex,
			configuredLimit,
		)
		if (!shouldCompact || !this.dependencies.taskState.conversationHistoryDeletedRange) {
			return shouldCompact
		}

		const apiHistory = this.dependencies.messageStateHandler.getApiConversationHistory()
		const activeMessageCount = apiHistory.length - this.dependencies.taskState.conversationHistoryDeletedRange[1] - 1

		// The next user message has not been appended yet, so an already-condensed
		// conversation has zero or two active messages at this point.
		return activeMessageCount > 2
	}
	private isCompatibleCheckpoint(
		checkpoint: ApiConversationCheckpoint | undefined,
		providerId: string,
		modelId: string,
		historyLength: number,
	): checkpoint is ApiConversationCheckpoint {
		return (
			checkpoint?.providerId === providerId &&
			checkpoint.modelId === modelId &&
			checkpoint.compactedThroughHistoryIndex >= 0 &&
			checkpoint.compactedThroughHistoryIndex < historyLength
		)
	}

	private hasCompatibleAssistantAfterBoundary(
		history: DiracStorageMessage[],
		boundary: number,
		providerId: string,
		modelId: string,
	): boolean {
		return history
			.slice(boundary + 1)
			.some(
				(message) =>
					message.role === "assistant" &&
					message.modelInfo?.providerId === providerId &&
					message.modelInfo.modelId === modelId &&
					message.id !== undefined,
			)
	}

	public async prepareProviderConversationDispatch(params: {
		systemPrompt: string
		tools: DiracTool[]
		truncatedMessages: DiracStorageMessage[]
		providerId: string
		modelId: string
	}): Promise<{ messages: DiracStorageMessage[]; options: ApiConversationRequestOptions }> {
		if (this.dependencies.taskState.abort) throw new Error("Task instance aborted")

		const fullHistory = this.dependencies.messageStateHandler.getApiConversationHistory()
		let providerState = this.dependencies.messageStateHandler.getApiConversationProviderState()
		let checkpoint = this.isCompatibleCheckpoint(
			providerState.checkpoint,
			params.providerId,
			params.modelId,
			fullHistory.length,
		)
			? providerState.checkpoint
			: undefined

		let dispatchMessages = params.truncatedMessages

		const pendingCompaction = this.dependencies.taskState.pendingApiConversationCompaction ?? providerState.pendingCompaction
		if (pendingCompaction) this.dependencies.taskState.pendingApiConversationCompaction = pendingCompaction
		if (pendingCompaction) {
			const currentDeletedRange = this.dependencies.taskState.conversationHistoryDeletedRange
			const targetDeletedRange = pendingCompaction.conversationHistoryDeletedRange
			if (
				!currentDeletedRange ||
				currentDeletedRange[0] !== targetDeletedRange[0] ||
				currentDeletedRange[1] !== targetDeletedRange[1]
			) {
				this.dependencies.taskState.conversationHistoryDeletedRange = targetDeletedRange
				dispatchMessages = this.dependencies.contextManager.getTruncatedMessages(
					fullHistory,
					targetDeletedRange,
				) as DiracStorageMessage[]
				await this.dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory()
			}
			const boundary = fullHistory.length - 1
			const api = this.getOperationalApi()
			if (api.compactConversation) {
				const messages = checkpoint
					? fullHistory.slice(checkpoint.compactedThroughHistoryIndex + 1)
					: (this.dependencies.contextManager.getTruncatedMessages(
						fullHistory,
						pendingCompaction.previousConversationHistoryDeletedRange,
					) as DiracStorageMessage[])
				try {
					const result = await api.compactConversation({
						systemPrompt: params.systemPrompt,
						messages: messages.map(removeProviderBoundaryMetadataFromMessage),
						tools: params.tools,
						checkpoint,
					})
					if (this.dependencies.taskState.abort) throw new Error("Task instance aborted")
					checkpoint = {
						providerId: params.providerId,
						modelId: params.modelId,
						compactedThroughHistoryIndex: boundary,
						input: result.input,
					}
					providerState = {
						...providerState,
						checkpoint,
						continuationReset: {
							providerId: params.providerId,
							modelId: params.modelId,
							compactedThroughHistoryIndex: boundary,
						},
						pendingCompaction: undefined,
					}
					await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
					this.dependencies.taskState.pendingApiConversationCompaction = undefined
				} catch (error) {
					if (this.dependencies.taskState.abort) throw error
					Logger.error(
						"Provider-native conversation compaction failed; using the plaintext condensed history without opaque state preservation:",
						error,
					)
					checkpoint = undefined
					providerState = {
						...providerState,
						checkpoint: undefined,
						continuationReset: {
							providerId: params.providerId,
							modelId: params.modelId,
							compactedThroughHistoryIndex: boundary,
						},
						pendingCompaction: undefined,
					}
					await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
					this.dependencies.taskState.pendingApiConversationCompaction = undefined
				}
			} else {
				Logger.warn(
					"Provider-native conversation compaction is unavailable; using the plaintext condensed history without opaque state preservation.",
				)
				checkpoint = undefined
				providerState = {
					...providerState,
					checkpoint: undefined,
					continuationReset: {
						providerId: params.providerId,
						modelId: params.modelId,
						compactedThroughHistoryIndex: boundary,
					},
					pendingCompaction: undefined,
				}
				await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
				this.dependencies.taskState.pendingApiConversationCompaction = undefined
			}
		}

		const continuationReset = providerState.continuationReset
		const resetIsCompatible =
			continuationReset?.providerId === params.providerId && continuationReset.modelId === params.modelId
		let breakProviderContinuation = resetIsCompatible
		if (
			resetIsCompatible &&
			this.hasCompatibleAssistantAfterBoundary(
				fullHistory,
				continuationReset.compactedThroughHistoryIndex,
				params.providerId,
				params.modelId,
			)
		) {
			providerState = { ...providerState, continuationReset: undefined }
			await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
			breakProviderContinuation = false
		}

		if (providerState.checkpoint && !checkpoint) {
			providerState = { ...providerState, checkpoint: undefined }
			await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(providerState)
		}

		if (this.dependencies.taskState.abort) throw new Error("Task instance aborted")

		const enableNativeWebSearch =
			this.getOperationalApi().supportsNativeWebSearch?.() === true &&
			this.dependencies.taskState.activeSkillIds.includes(NATIVE_WEB_SEARCH_SKILL_NAME)

		return {
			messages: checkpoint ? fullHistory.slice(checkpoint.compactedThroughHistoryIndex + 1) : dispatchMessages,
			options: { checkpoint, breakProviderContinuation, enableNativeWebSearch },
		}
	}

	public async prepareApiRequest(params: {
		userContent: DiracContent[]
		shouldCompact?: boolean
		includeFileDetails: boolean
		useCompactPrompt: boolean
		previousApiReqIndex: number
		directResponseText?: string
		popover?: boolean
		isFirstRequest: boolean
		providerId: string
		modelId: string
		mode: string
		requestId: string
		afterUserContentPersisted?: () => Promise<void>
	}): Promise<{
		userContent: DiracContent[]
		lastApiReqIndex: number
		isDirectResponse?: boolean
		directResponseText?: string
		didConsumeUserContent: boolean
	}> {
		let nextUserContent = params.userContent

		// 1. Run User Prompt Submit Hook
		const hookResult = await this.dependencies.runUserPromptSubmitHook(
			nextUserContent,
			params.isFirstRequest ? "initial_task" : "feedback",
		)
		if (hookResult.cancel) {
			return {
				userContent: nextUserContent,
				lastApiReqIndex: params.previousApiReqIndex,
				isDirectResponse: true,
				directResponseText: hookResult.errorMessage,
				didConsumeUserContent: false,
			}
		}

		let parsedUserContent: DiracContent[]
		let environmentDetails: string
		let diracrulesError: boolean
		let isDirectResponse = false
		let directResponseText = params.directResponseText
		let directActions: SlashCommandDirectAction[] | undefined

		if (params.shouldCompact) {
			parsedUserContent = [...nextUserContent]
			environmentDetails = ""
			diracrulesError = false
			this.dependencies.taskState.lastAutoCondenseTriggerIndex = params.previousApiReqIndex
			this.dependencies.taskState.pendingCondenseSource = "automatic"
		} else {
			const [
				loadedUserContent,
				loadedEnvironmentDetails,
				loadedDiracrulesError,
				availableSkills,
				loadedIsDirectResponse,
				loadedDirectResponseText,
				loadedDirectActions,
			] = await this.dependencies.loadContext(nextUserContent, params.includeFileDetails, params.useCompactPrompt)
			parsedUserContent = loadedUserContent
			environmentDetails = loadedEnvironmentDetails
			diracrulesError = loadedDiracrulesError
			isDirectResponse = loadedIsDirectResponse
			directResponseText = loadedDirectResponseText ?? params.directResponseText
			directActions = loadedDirectActions
			this.dependencies.taskState.availableSkills = availableSkills
		}

		const skillIds = [
			...new Set(
				(directActions ?? []).flatMap((action) => (action.type === "activateSkill" ? [action.skillId] : [])),
			),
		]
		for (const skillId of skillIds) {
			await this.dependencies.activateSkill(skillId)
		}

		if (directActions?.some((action) => action.type === "condenseConversation")) {
			const continuation = await this.dependencies.runLocalConversationCompaction("user")
			if (!continuation) {
				return {
					userContent: parsedUserContent,
					lastApiReqIndex: params.previousApiReqIndex,
					isDirectResponse: true,
					didConsumeUserContent: true,
				}
			}
			parsedUserContent.unshift({ type: "text", text: continuation })
			const pinnedContext = this.dependencies.getPinnedContext?.()
			if (pinnedContext) parsedUserContent.splice(1, 0, { type: "text", text: pinnedContext })
		}

		if (isDirectResponse) {
			return {
				userContent: directResponseText ? [{ type: "text", text: directResponseText }] : parsedUserContent,
				lastApiReqIndex: -1,
				isDirectResponse: true,
				directResponseText,
				didConsumeUserContent: true,
			}
		}

		// error handling if the user uses the /newrule command & their .diracrules is a file, for file read operations didnt work properly
		if (diracrulesError === true) {
			const card = await this.dependencies.taskMessenger.createCard({
				header: "Rule Error",
				body: "Issue with processing the /newrule command. Double check that, if '.diracrules' already exists, it's a directory and not a file. Otherwise there was an issue referencing this file/directory.",
				status: CardStatus.ERROR,
			})
			await card.finalize(CardStatus.ERROR)
		}

		// Replace userContent with parsed content that includes file details and command instructions.
		const userContent = parsedUserContent

		// add environment details as its own text block, separate from tool results
		// do not add environment details to the message which we are compacting the context window
		if (environmentDetails) {
			userContent.push({ type: "text", text: environmentDetails })
		}

		if (params.shouldCompact) {
			const pinnedContext = this.dependencies.getPinnedContext?.()
			if (pinnedContext) userContent.push({ type: "text", text: pinnedContext })
			userContent.push({ type: "text", text: autoCondensePrompt() })
		}

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		const apiReqId = `api-req-${Date.now()}`
		await this.dependencies.taskMessenger.upsertApiStatus({
			id: apiReqId,
			request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
		})

		telemetryService.captureConversationTurnEvent(
			this.dependencies.ulid,
			params.providerId,
			params.modelId,
			"user",
			params.mode as Mode,
			undefined,
			this.dependencies.taskState.useNativeToolCalls,
		)

		// Capture task initialization timing telemetry for the first API request
		if (params.isFirstRequest) {
			const durationMs = Math.round(performance.now() - this.dependencies.taskInitializationStartTime)
			telemetryService.captureTaskInitialization(
				this.dependencies.ulid,
				this.dependencies.taskId,
				durationMs,
				(this.dependencies.getRequestRuntime()?.workingConfiguration ?? this.dependencies.getWorkingConfiguration()).settings.enableCheckpointsSetting,
			)
		}

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
		const lastApiReqIndex = this.dependencies.messageStateHandler.findMessageIndexById(apiReqId)
		if (lastApiReqIndex === -1) throw new Error(`API status ${apiReqId} not found`)
		await this.dependencies.messageStateHandler.patchApiStatusById(apiReqId, {
			request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
		})

		await this.dependencies.postStateToWebview()

		await this.dependencies.messageStateHandler.addToApiConversationHistory({
			role: "user",
			content: userContent,
			ts: Date.now(),
		})
		const modeNotice = this.dependencies.taskState.pendingModeNotice
		if (
			!params.shouldCompact &&
			modeNotice?.mode === params.mode &&
			modeNotice.includedInRequestId === params.requestId
		) {
			this.dependencies.taskState.pendingModeNotice = undefined
		}
		await params.afterUserContentPersisted?.()

		return { userContent, lastApiReqIndex, directResponseText, didConsumeUserContent: true }
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/TaskMessenger.ts (lines 34-500)
```
export class TaskMessenger implements ITaskMessenger {
	private activeVoiceStream?: ITextStreamHandle
	private lastMessageId = 0

	constructor(private dependencies: TaskMessengerDependencies) {}

	private postPresentationToWebview(): Promise<void> {
		return (this.dependencies.postPresentationToWebview ?? this.dependencies.postStateToWebview)()
	}

	public setApi(api: ApiHandler) {
		this.dependencies.api = api
	}

	public generateId(): string {
		return `${Date.now()}-${++this.lastMessageId}`
	}

	async streamText(type: "markdown" | "reasoning"): Promise<ITextStreamHandle> {
		// Auto-close any active stream
		if (this.activeVoiceStream) {
			await this.activeVoiceStream.close()
		}

		const id = this.generateId()
		const ts = Date.now()
		const isReasoning = type === "reasoning"

		const message: DiracMessage = {
			id,
			ts,
			content: {
				type: DiracMessageType.MARKDOWN,
				content: "",
				isReasoning,
				role: "assistant",
			},
		}
		this.dependencies.taskState.attachVoiceStream(id)
		await this.dependencies.messageStateHandler.addToDiracMessages(message)
		await this.postPresentationToWebview()

		const handle: ITextStreamHandle = {
			id,
			append: async (chunk: string) => {
				await this.dependencies.messageStateHandler.appendMarkdownById(id, chunk)
				await this.postPresentationToWebview()
			},
			setImages: async (images: string[]) => {
				await this.dependencies.messageStateHandler.patchMarkdownById(id, {
					images,
				})
				await this.postPresentationToWebview()
			},
			setFiles: async (files: string[]) => {
				await this.dependencies.messageStateHandler.patchMarkdownById(id, {
					files,
				})
				await this.postPresentationToWebview()
			},
			close: async () => {
				if (this.dependencies.taskState.activeVoiceStreamId === id) {
					const current = this.dependencies.messageStateHandler.getMessageById(id)
					if (current?.content.type === DiracMessageType.MARKDOWN) {
						await this.dependencies.messageStateHandler.patchMessageById(id, {
							content: { ...current.content },
						})
					}
					this.dependencies.taskState.detachVoiceStream(id)
					await this.postPresentationToWebview()
				}

				if (this.activeVoiceStream === handle) {
					this.activeVoiceStream = undefined
				}
			},
		}

		this.activeVoiceStream = handle
		return handle
	}

	private scheduleStatePublication(): void {
		void this.postPresentationToWebview().catch((error) => {
			Logger.error("Failed to publish card state:", error)
		})
	}

	async createCard(params: TaskCardParams): Promise<TaskCardHandle> {
		if (this.activeVoiceStream) {
			await this.activeVoiceStream.close()
		}

		const id = this.generateId()
		const ts = Date.now()
		const creationTime = Date.now()
		const status =
			params.status ||
			(params.requireApproval || params.requireFeedback ? CardStatus.WAITING_FOR_INPUT : CardStatus.RUNNING)
		const card: Card = {
			id,
			kind: params.kind ?? CardKind.GENERIC,
			header: params.header,
			toolName: params.toolName,
			icon: params.icon,
			status,
			renderType: params.renderType || "text",
			body: params.body || "",
			rawInput: params.rawInput,
			rawOutput: params.rawOutput,
			diffs: params.diffs,
			locations: params.locations,
			requireApproval: params.requireApproval,
			requireFeedback: params.requireFeedback,
			feedbackPlaceholder: params.feedbackPlaceholder,
			actions: params.actions,
			autoScroll: params.autoScroll,
			collapsed: params.collapsed,
			maxHeight: params.maxHeight,
			cleanupStrategy: params.cleanupStrategy,
			do_not_auto_collapse: params.do_not_auto_collapse,
			startTime: creationTime,
			...(isFinalStatus(status) ? { endTime: creationTime } : {}),
			outcome: params.outcome,
		}
		if (isFinalStatus(status) && card.requireApproval) card.collapsed = true
		const message: DiracMessage = {
			id,
			ts,
			content: { type: DiracMessageType.CARD, card },
		}

		await this.dependencies.messageStateHandler.addToDiracMessages(message)
		this.scheduleStatePublication()
		if (isFinalStatus(status)) await this.dependencies.messageStateHandler.flushPendingWrites()

		const getCard = (): Readonly<Card> => {
			const index = this.dependencies.messageStateHandler.findMessageIndexByCardId(id)
			if (index === -1) throw new Error(`Card with id ${id} not found`)
			const current = this.dependencies.messageStateHandler.getDiracMessages()[index]
			if (current.content.type !== DiracMessageType.CARD) throw new Error(`Message with id ${id} is not a card`)
			return current.content.card
		}
		const getCardMessageTimestamp = (): number => {
			const index = this.dependencies.messageStateHandler.findMessageIndexByCardId(id)
			if (index === -1) throw new Error(`Card with id ${id} not found`)
			return this.dependencies.messageStateHandler.getDiracMessages()[index].ts
		}
		const autoApprovedInteraction = () => ({
			response: DiracAskResponse.APPROVE,
			action: DiracAskResponse.APPROVE,
			value: DiracAskResponse.APPROVE,
			askTs: getCardMessageTimestamp(),
		})
		const removeWaitingCard = () => {
			this.dependencies.taskState.waitingCardIds = this.dependencies.taskState.waitingCardIds.filter(
				(cardId) => cardId !== id,
			)
		}
		const updateCard = async (patch: Partial<Card>, doNotAutoCollapse?: boolean): Promise<Readonly<Card>> => {
			const current = getCard()
			const requestedStatus = patch.status
			if (isFinalStatus(current.status) && requestedStatus !== undefined && requestedStatus !== current.status) {
				throw new Error(`Card ${id} is already terminal with status ${current.status}`)
			}
			const recordedPatch: Partial<Omit<Card, "id">> = { ...patch }
			const nextStatus = recordedPatch.status ?? current.status
			if (isFinalStatus(nextStatus)) {
				recordedPatch.endTime ??= current.endTime ?? Date.now()
				if (recordedPatch.requireApproval ?? current.requireApproval) recordedPatch.collapsed = true
			}
			if (doNotAutoCollapse) recordedPatch.do_not_auto_collapse = true
			const updated = await this.dependencies.messageStateHandler.patchCardById(id, recordedPatch)
			if (isFinalStatus(updated.status)) removeWaitingCard()
			this.scheduleStatePublication()
			return updated
		}

		const handle: TaskCardHandle = {
			id,
			getCard,
			update: async (patch: Partial<Card>) => {
				const updated = await updateCard(patch)
				if (isFinalStatus(updated.status)) await this.dependencies.messageStateHandler.flushPendingWrites()
			},
			appendBody: async (chunk: string) => {
				await this.dependencies.messageStateHandler.appendCardBodyById(id, chunk)
				this.scheduleStatePublication()
			},
			finalize: async (status: CardStatus, doNotAutoCollapse?: boolean) => {
				if (!isFinalStatus(status)) throw new Error(`Card ${id} cannot finalize with nonterminal status ${status}`)
				await updateCard({ status }, doNotAutoCollapse)
				await this.dependencies.messageStateHandler.flushPendingWrites()
			},
			waitForInteraction: async () => {
				if (params.isAutoApproved?.() === true) return autoApprovedInteraction()
				const card = getCard()
				const isAsk = !!(card.requireApproval || card.requireFeedback)
				const isFinal = isFinalStatus(card.status)

				if (isAsk && !isFinal) {
					let previousStatus: TaskStatus | undefined

					try {
						if (!this.dependencies.taskState.waitingCardIds.includes(id)) {
							this.dependencies.taskState.waitingCardIds.push(id)
						}
						await this.dependencies.messageStateHandler.flushPendingWrites()
						await this.postPresentationToWebview()
						await pWaitFor(
							() =>
								this.dependencies.taskState.lastWaitingCardId === id ||
								this.dependencies.taskState.abort ||
								isFinalStatus(getCard().status) ||
								params.isAutoApproved?.() === true,
							{ interval: 100 },
						)
						if (this.dependencies.taskState.abort) {
							throw new Error("Task aborted while waiting for card interaction")
						}
						if (isFinalStatus(getCard().status)) {
							throw new Error(`Card ${id} became terminal while waiting for interaction`)
						}
						if (params.isAutoApproved?.() === true) return autoApprovedInteraction()

						const index = this.dependencies.messageStateHandler.findMessageIndexByCardId(id)
						if (index === -1) throw new Error(`Card with id ${id} not found`)
						const activeMessage = this.dependencies.messageStateHandler.getDiracMessages()[index]
						const messageTs = activeMessage.ts
						// Registration exposes this card to clients before setup finishes. Keep any
						// response already submitted for it, including an immediate FIFO handoff.
						if (this.dependencies.taskState.askResponseCardId !== id) {
							clearAskResponse(this.dependencies.taskState)
						}
						this.dependencies.taskState.lastMessageTs = messageTs

						previousStatus = this.dependencies.taskState.status
						await this.runNotificationHook({
							event: "user_attention",
							source: "card_interaction",
							message: card.header,
							waitingForUserInput: true,
						})

						this.dependencies.taskState.status = TaskStatus.AWAITING_USER_INPUT
						this.dependencies.messageStateHandler.publishCardInteractionReady(id)

						await pWaitFor(
							() => {
								const response = this.dependencies.taskState.askResponse
								return !!(
									response !== undefined ||
									this.dependencies.taskState.lastMessageTs !== messageTs ||
									this.dependencies.taskState.abort ||
									isFinalStatus(getCard().status) ||
									params.isAutoApproved?.()
								)
							},
							{ interval: 100 },
						)

						if (this.dependencies.taskState.abort) {
							throw new Error("Task aborted while waiting for card interaction")
						}
						if (isFinalStatus(getCard().status)) {
							throw new Error(`Card ${id} became terminal while waiting for interaction`)
						}

						if (this.dependencies.taskState.lastMessageTs !== messageTs) {
							throw new Error("Current card interaction promise was ignored")
						}

						const autoApproved =
							this.dependencies.taskState.askResponse === undefined && params.isAutoApproved?.() === true
						const response = autoApproved ? DiracAskResponse.APPROVE : this.dependencies.taskState.askResponse!
						const result = {
							response,
							action: autoApproved
								? DiracAskResponse.APPROVE
								: this.dependencies.taskState.askResponseAction || response,
							value: autoApproved ? DiracAskResponse.APPROVE : this.dependencies.taskState.askResponseValue,

							text: this.dependencies.taskState.askResponseText,
							images: this.dependencies.taskState.askResponseImages,
							files: this.dependencies.taskState.askResponseFiles,
							userEdits: this.dependencies.taskState.askResponseUserEdits,
							askTs: messageTs,
						}
						clearAskResponse(this.dependencies.taskState)

						// If the user sent a chat message instead of responding to the card,
						// this signals the tool should be skipped. Throw a typed error so the
						// coordinator can handle it cleanly.
						const responseText = result.text as string | undefined
						const responseImages = result.images as string[] | undefined
						const responseFiles = result.files as string[] | undefined
						const hasUserMessageContent =
							!!responseText || (responseImages?.length ?? 0) > 0 || (responseFiles?.length ?? 0) > 0
						if (result.response === DiracAskResponse.MESSAGE && hasUserMessageContent) {
							// Echo the user's message in the chat UI
							await this.upsertText(responseText ?? "", false, responseImages, responseFiles, "user")
							const { ToolSkippedByUserMessage } = await import("./tools/types/ToolSkippedByUserMessage")
							throw new ToolSkippedByUserMessage(responseText ?? "", responseImages, responseFiles)
						}

						return result
					} finally {
						if (this.dependencies.taskState.askResponseCardId === id) {
							clearAskResponse(this.dependencies.taskState)
						}
						if (!this.dependencies.taskState.abort && previousStatus !== undefined) {
							this.dependencies.taskState.status = previousStatus
						}
						removeWaitingCard()
						await this.postPresentationToWebview()
					}
				}

				throw new Error(`Card ${id} is not in a state that requires interaction`)
			},
		}

		return handle
	}

	async createCheckpoint(): Promise<ICardHandle> {
		if (this.activeVoiceStream) {
			await this.activeVoiceStream.close()
		}

		const id = this.generateId()
		const ts = Date.now()

		const message: DiracMessage = {
			id,
			ts,
			content: { type: DiracMessageType.CHECKPOINT },
		}

		await this.dependencies.messageStateHandler.addToDiracMessages(message)
		await this.postPresentationToWebview()

		const handle: ICardHandle = {
			id,
			update: async () => {
				throw new Error("Cannot update a checkpoint message")
			},
			appendBody: async () => {
				throw new Error("Cannot append body to a checkpoint message")
			},
			finalize: async () => {
				throw new Error("Cannot finalize a checkpoint message")
			},
			waitForInteraction: async () => {
				throw new Error("Checkpoint messages do not support interaction")
			},
		}

		return handle
	}

	async upsertApiStatus(status: DiracApiReqInfo): Promise<void> {
		const id = status.id || "api-status"
		const index = this.dependencies.messageStateHandler.findMessageIndexById(id)

		if (index !== -1) {
			await this.dependencies.messageStateHandler.patchApiStatusById(id, status)
			await this.postPresentationToWebview()
		} else {
			const message: DiracMessage = {
				id,
				ts: Date.now(),
				content: { type: DiracMessageType.API_STATUS, status },
			}
			await this.dependencies.messageStateHandler.addToDiracMessages(message)
			await this.postPresentationToWebview()
		}
	}

	async upsertText(
		text: string,
		isReasoning?: boolean,
		images?: string[],
		files?: string[],
		role: "user" | "assistant" = "assistant",
		agentIdentity?: { id: number; name: string },
	): Promise<void> {
		if (this.activeVoiceStream) {
			await this.activeVoiceStream.close()
		}

		// If this is a reasoning block and we already have an active stream, update it instead of creating a new message
		const activeVoiceStreamId = this.dependencies.taskState.activeVoiceStreamId
		if (isReasoning && activeVoiceStreamId) {
			const message = this.dependencies.messageStateHandler.getMessageById(activeVoiceStreamId)
			if (message?.content.type === DiracMessageType.MARKDOWN && message.content.isReasoning) {
				if (text.startsWith(message.content.content)) {
					const suffix = text.slice(message.content.content.length)
					if (suffix) await this.dependencies.messageStateHandler.appendMarkdownById(activeVoiceStreamId, suffix)
				} else if (text !== message.content.content) {
					const index = this.dependencies.messageStateHandler.findMessageIndexById(activeVoiceStreamId)
					await this.dependencies.messageStateHandler.updateDiracMessage(index, {
						content: { ...message.content, content: text },
					})
				}
				await this.postPresentationToWebview()
				return
			}
		}

		const id = this.generateId()
		const message: DiracMessage = {
			id,
			ts: Date.now(),
			content: {
				type: DiracMessageType.MARKDOWN,
				content: text,
				isReasoning,
				images,
				files,
				role,
				agentId: agentIdentity?.id,
				agentName: agentIdentity?.name,
			},
		}

		if (isReasoning) {
			this.dependencies.taskState.attachVoiceStream(id)
		}

		await this.dependencies.messageStateHandler.addToDiracMessages(message)
		await this.postPresentationToWebview()
	}

	async runNotificationHook(notification: {
		event: string
		source: string
		message: string
		waitingForUserInput: boolean
	}): Promise<void> {
		const hooksEnabled = getHooksEnabledSafe(this.dependencies.getWorkingConfiguration().settings.hooksEnabled)
		if (!hooksEnabled) {
			return
		}

		try {
			await executeHook({
				hookName: "Notification",
				hookInput: {
					notification,
				},
				isCancellable: false,
				messenger: this,

				messageStateHandler: this.dependencies.messageStateHandler,
				taskId: this.dependencies.taskId,
				hooksEnabled,
				model: getTaskHookModelContext(
					this.dependencies.getRequestRuntime?.()?.api ?? this.dependencies.api!,
					this.dependencies.getWorkingConfiguration(),
				),
			})
		} catch (error) {
			Logger.error("[Notification Hook] Failed (non-fatal):", error)
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/task/message-state.ts (lines 76-1005)
```
export class MessageStateHandler extends EventEmitter<MessageStateHandlerEvents> {
	private workspaceRootPath?: string
	private apiConversationHistory: DiracStorageMessage[] = []
	private apiConversationProviderState: ApiConversationProviderState = {}
	private diracMessages: DiracMessage[] = []
	private taskIsFavorited: boolean
	private checkpointTracker: CheckpointTracker | undefined
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private taskId: string
	private ulid: string
	private taskState: TaskState
	private apiMetrics = getApiMetrics([])
	private metricContributionByMessageId = new Map<string, ReturnType<typeof getApiMetrics>>()
	private lastRelevantMessageId?: string
	private lastApiStatusMessageId?: string
	private lastModelInfo?: DiracStorageMessage["modelInfo"]

	// Mutex to prevent concurrent state modifications (RC-4)
	// Protects against data loss from race conditions when multiple
	// operations try to modify message state simultaneously
	// This follows the same pattern as Task.stateMutex for consistency
	private stateMutex = new Mutex()
	private persistenceMutex = new Mutex()

	private messageIndexById = new Map<string, number>()
	private cardMessageIndexById = new Map<string, number>()
	private pendingTextAppendsByMessageId = new Map<string, string[]>()
	private presentationOffset = -1
	private presentationStateGeneration = 0
	private apiHistoryOffset = -1
	private pendingPresentationOperations: PresentationOperation[] = []
	private pendingPresentationPersistenceBytes = 0
	private pendingPresentationPublications: PresentationOperation[] = []
	private pendingPresentationPublicationBytes = 0
	private presentationPublicationGapThroughOffset?: number
	private pendingApiConversationOperations: ApiConversationOperation[] = []
	private pendingApiConversationBytes = 0
	private uiFlushTimeout?: ReturnType<typeof setTimeout>
	private uiFlushDeadline?: number
	private apiHistoryFlushScheduled = false
	private persistenceRetired = false

	private recordPresentationOperation(operation: PresentationOperation): void {
		if (this.persistenceRetired) return
		const recordedOperation = structuredClone(operation)
		const operationBytes = Buffer.byteLength(JSON.stringify(recordedOperation), "utf8")
		this.pendingPresentationOperations.push(recordedOperation)
		this.pendingPresentationPersistenceBytes += operationBytes
		this.pendingPresentationPublications.push(recordedOperation)
		this.pendingPresentationPublicationBytes += operationBytes
		if (this.pendingPresentationPublicationBytes <= MAX_PENDING_PRESENTATION_PUBLICATION_BYTES) return
		this.pendingPresentationPublications = []
		this.pendingPresentationPublicationBytes = 0
		this.presentationPublicationGapThroughOffset = operation.offset
	}

	private recordApiConversationOperation(operation: ApiConversationOperation): void {
		if (this.persistenceRetired) return
		const recordedOperation = structuredClone(operation)
		this.pendingApiConversationOperations.push(recordedOperation)
		this.pendingApiConversationBytes += Buffer.byteLength(JSON.stringify(recordedOperation), "utf8")
	}

	private bufferPresentationAppend(messageId: string, text: string): void {
		const chunks = this.pendingTextAppendsByMessageId.get(messageId)
		if (chunks) chunks.push(text)
		else this.pendingTextAppendsByMessageId.set(messageId, [text])
	}

	private materializePresentationAppends(message: DiracMessage): boolean {
		const chunks = this.pendingTextAppendsByMessageId.get(message.id)
		if (!chunks) return false
		const appendedText = chunks.join("")
		if (message.content.type === DiracMessageType.MARKDOWN) {
			message.content.content += appendedText
		} else if (message.content.type === DiracMessageType.CARD) {
			message.content.card.body = `${message.content.card.body ?? ""}${appendedText}`
		} else {
			throw new Error(`Presentation append buffer refers to non-text message ${message.id}`)
		}
		this.pendingTextAppendsByMessageId.delete(message.id)
		return true
	}

	private materializeAllPresentationAppends(): void {
		for (const messageId of this.pendingTextAppendsByMessageId.keys()) {
			const index = this.requireMessageIndex(messageId)
			this.materializePresentationAppends(this.diracMessages[index])
		}
	}

	private async flushIfPersistenceBatchIsFull(): Promise<void> {
		if (
			this.pendingPresentationPersistenceBytes <= MAX_PENDING_PRESENTATION_PUBLICATION_BYTES &&
			this.pendingApiConversationBytes <= MAX_PENDING_PRESENTATION_PUBLICATION_BYTES
		)
			return
		await this.flushPendingWrites()
	}

	getPendingPresentationOperations(): PresentationOperation[] {
		return this.pendingPresentationPublications.slice()
	}

	hasPresentationPublicationGap(): boolean {
		return this.presentationPublicationGapThroughOffset !== undefined
	}

	acknowledgePresentationOperations(throughOffset: number): void {
		this.pendingPresentationPublications = this.pendingPresentationPublications.filter(
			(operation) => operation.offset > throughOffset,
		)
		this.pendingPresentationPublicationBytes = this.pendingPresentationPublications.reduce(
			(total, operation) => total + Buffer.byteLength(JSON.stringify(operation), "utf8"),
			0,
		)
		if (
			this.presentationPublicationGapThroughOffset !== undefined &&
			this.presentationPublicationGapThroughOffset <= throughOffset
		) {
			this.presentationPublicationGapThroughOffset = undefined
		}
	}

	hasPendingPresentationOperations(): boolean {
		return this.pendingPresentationPublications.length > 0
	}
	constructor(params: MessageStateHandlerParams) {
		super()
		this.taskId = params.taskId
		this.ulid = params.ulid
		this.taskState = params.taskState
		this.taskIsFavorited = params.taskIsFavorited ?? false
		this.workspaceRootPath = params.workspaceRootPath
		this.updateTaskHistory = params.updateTaskHistory
	}

	/**
	 * Emit a diracMessagesChanged event with the change details
	 */
	private emitDiracMessagesChanged(change: DiracMessageChange): void {
		this.emit("diracMessagesChanged", change)
	}

	/** Announce an armed FIFO interaction without mutating or persisting its card. */
	publishCardInteractionReady(cardId: string): void {
		const index = this.requireCardMessageIndex(cardId)
		this.emit("cardInteractionReady", this.diracMessages[index])
	}

	setCheckpointTracker(tracker: CheckpointTracker | undefined) {
		this.checkpointTracker = tracker
	}

	/**
	 * Execute function with exclusive lock on message state
	 * Use this for ANY state modification to prevent race conditions
	 * This follows the same pattern as Task.withStateLock for consistency
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	async capturePresentationSnapshot(): Promise<PresentationSnapshot> {
		return this.withStateLock(() => {
			this.materializeAllPresentationAppends()
			return {
				messages: structuredClone(this.diracMessages),
				offset: this.presentationOffset,
				generation: this.presentationStateGeneration,
			}
		})
	}

	/** Schedules a bounded UI snapshot flush without delaying live webview updates. */
	private scheduleUiFlush(): void {
		if (this.persistenceRetired) return
		const now = performance.now()
		this.uiFlushDeadline ??= now + UI_MESSAGES_FLUSH_MAX_DELAY_MS
		const delay = Math.min(UI_MESSAGES_FLUSH_DEBOUNCE_MS, Math.max(0, this.uiFlushDeadline - now))
		if (this.uiFlushTimeout) clearTimeout(this.uiFlushTimeout)
		this.uiFlushTimeout = setTimeout(() => {
			this.uiFlushTimeout = undefined
			this.uiFlushDeadline = undefined
			void this.flushPendingWrites().catch((error) => Logger.error("Failed to flush pending UI messages:", error))
		}, delay)
	}

	/** Keeps API-history persistence at its existing same-turn cadence. */
	private scheduleApiHistoryFlush(): void {
		if (this.persistenceRetired || this.apiHistoryFlushScheduled) return
		this.apiHistoryFlushScheduled = true
		queueMicrotask(() => {
			this.apiHistoryFlushScheduled = false
			void this.flushPendingWrites().catch((error) => Logger.error("Failed to flush pending API history:", error))
		})
	}

	private cancelScheduledUiFlush(): void {
		if (this.uiFlushTimeout) clearTimeout(this.uiFlushTimeout)
		this.uiFlushTimeout = undefined
		this.uiFlushDeadline = undefined
	}

	/** Prevents this task instance from writing after a same-ID replacement takes ownership. */
	async retirePersistence(): Promise<void> {
		this.persistenceRetired = true
		this.cancelScheduledUiFlush()
		this.apiHistoryFlushScheduled = false
		await this.persistenceMutex.withLock(() =>
			this.withStateLock(() => {
				this.pendingPresentationOperations = []
				this.pendingPresentationPersistenceBytes = 0
				this.pendingPresentationPublications = []
				this.pendingPresentationPublicationBytes = 0
				this.presentationPublicationGapThroughOffset = undefined
				this.pendingApiConversationOperations = []
				this.pendingApiConversationBytes = 0
			}),
		)
	}

	/** Captures pending records under the state lock, then appends them without blocking mutations. */
	private async persistPendingOperations(): Promise<void> {
		if (this.persistenceRetired) return
		const pending = await this.withStateLock(() => {
			const hasPendingApiConversation = this.pendingApiConversationOperations.length > 0
			const captured = {
				presentation: this.pendingPresentationOperations.splice(0),
				apiConversation: this.pendingApiConversationOperations.splice(0),
				apiConversationSnapshot: hasPendingApiConversation ? structuredClone(this.apiConversationHistory) : undefined,
				presentationBytes: this.pendingPresentationPersistenceBytes,
				apiConversationBytes: this.pendingApiConversationBytes,
			}
			this.pendingPresentationPersistenceBytes = 0
			this.pendingApiConversationBytes = 0
			return captured
		})

		let firstError: unknown
		try {
			await appendPresentationOperations(this.taskId, pending.presentation)
		} catch (error) {
			firstError = error
			await this.withStateLock(() => {
				this.pendingPresentationOperations.unshift(...pending.presentation)
				this.pendingPresentationPersistenceBytes += pending.presentationBytes
			})
		}
		try {
			await appendApiConversationOperations(this.taskId, pending.apiConversation, pending.apiConversationSnapshot)
		} catch (error) {
			firstError ??= error
			await this.withStateLock(() => {
				this.pendingApiConversationOperations.unshift(...pending.apiConversation)
				this.pendingApiConversationBytes += pending.apiConversationBytes
			})
		}
		if (firstError) throw firstError
		await this.createBaselinesWhenTailIsLarge()
	}

	private async createBaselinesWhenTailIsLarge(): Promise<void> {
		if (this.persistenceRetired) return
		const taskDirectory = await ensureTaskDirectoryExists(this.taskId)
		const presentationTailPath = `${taskDirectory}/${GlobalFileNames.uiMessageOperations}`
		const apiTailPath = `${taskDirectory}/${GlobalFileNames.apiConversationHistoryOperations}`
		const [presentationNeedsBaseline, apiNeedsBaseline] = await Promise.all([
			operationLogExceedsBaselineThreshold(presentationTailPath),
			operationLogExceedsBaselineThreshold(apiTailPath),
		])
		if (this.persistenceRetired || (!presentationNeedsBaseline && !apiNeedsBaseline)) return

		await this.withStateLock(async () => {
			if (this.persistenceRetired) return
			if (presentationNeedsBaseline && this.pendingPresentationOperations.length === 0) {
				this.materializeAllPresentationAppends()
				await createPresentationBaseline(this.taskId, this.diracMessages, this.presentationOffset)
			}
			if (apiNeedsBaseline && this.pendingApiConversationOperations.length === 0) {
				await createApiConversationBaseline(this.taskId, this.apiConversationHistory, this.apiHistoryOffset)
			}
		})
	}

	/**
	 * Flush any pending dirty writes to disk without holding the message-state lock during I/O.
	 * Safe to call at any time — no-op if nothing is dirty or this handler has been retired.
	 */
	async flushPendingWrites(): Promise<void> {
		this.cancelScheduledUiFlush()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(() => this.persistPendingOperations())
	}

	/**
	 * Flush task history to disk. Should be called at turn boundaries
	 * (end of API request cycle, after resume, after restore).
	 */
	async flushTaskHistory(): Promise<void> {
		await this.flushPendingWrites()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(() => this.updateTaskHistoryInternal())
	}

	getApiConversationHistory(): DiracStorageMessage[] {
		return this.apiConversationHistory
	}

	setApiConversationHistory(newHistory: DiracStorageMessage[], lastOffset = -1): void {
		this.apiConversationHistory = newHistory.map(removeUserInputMarkersFromMessage)
		this.apiHistoryOffset = lastOffset
		this.pendingApiConversationOperations = []
		this.pendingApiConversationBytes = 0
		this.lastModelInfo = findLastModelInfo(this.apiConversationHistory)
	}

	getApiConversationProviderState(): ApiConversationProviderState {
		return this.apiConversationProviderState
	}

	setApiConversationProviderState(state: ApiConversationProviderState): void {
		this.apiConversationProviderState = state
	}

	async overwriteApiConversationProviderState(state: ApiConversationProviderState): Promise<void> {
		await this.flushPendingWrites()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(async () => {
			if (this.persistenceRetired) return
			await this.withStateLock(async () => {
				this.apiConversationProviderState = state
				await saveApiConversationProviderState(this.taskId, state)
			})
		})
	}

	getDiracMessages(): DiracMessage[] {
		this.materializeAllPresentationAppends()
		return this.diracMessages
	}

	setDiracMessages(newMessages: DiracMessage[], lastOffset = -1) {
		const previousMessages = this.diracMessages
		this.diracMessages = newMessages
		this.presentationOffset = lastOffset
		this.pendingTextAppendsByMessageId.clear()
		this.pendingPresentationOperations = []
		this.pendingPresentationPersistenceBytes = 0
		this.pendingPresentationPublications = []
		this.pendingPresentationPublicationBytes = 0
		this.presentationPublicationGapThroughOffset = undefined
		this.presentationStateGeneration++
		this.rebuildMessageIndexes()
		this.rebuildHistoryProjection()
		this.emitDiracMessagesChanged({
			type: "set",
			messages: this.diracMessages,
			previousMessages,
		})
	}

	private rebuildMessageIndexes(): void {
		this.messageIndexById.clear()
		this.cardMessageIndexById.clear()
		this.lastApiStatusMessageId = undefined
		for (let index = 0; index < this.diracMessages.length; index++) {
			const message = this.diracMessages[index]
			this.messageIndexById.set(message.id, index)
			if (message.content.type === DiracMessageType.CARD) {
				this.cardMessageIndexById.set(message.content.card.id, index)
			}
			if (message.content.type === DiracMessageType.API_STATUS) this.lastApiStatusMessageId = message.id
		}
	}

	private updateLatestApiStatusAfterMutation(message: DiracMessage, wasApiStatus: boolean): void {
		if (message.content.type === DiracMessageType.API_STATUS) {
			const currentIndex = this.lastApiStatusMessageId ? (this.messageIndexById.get(this.lastApiStatusMessageId) ?? -1) : -1
			const messageIndex = this.messageIndexById.get(message.id) ?? -1
			if (messageIndex >= currentIndex) this.lastApiStatusMessageId = message.id
			return
		}
		if (wasApiStatus && message.id === this.lastApiStatusMessageId) this.findLastApiStatusMessageId()
	}

	private findLastApiStatusMessageId(): void {
		this.lastApiStatusMessageId = undefined
		for (let index = this.diracMessages.length - 1; index >= 0; index--) {
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.API_STATUS) continue
			this.lastApiStatusMessageId = message.id
			return
		}
	}

	private rebuildHistoryProjection(): void {
		this.apiMetrics = getApiMetrics(this.diracMessages)
		this.metricContributionByMessageId.clear()
		this.lastRelevantMessageId = undefined
		for (const message of this.diracMessages) {
			this.metricContributionByMessageId.set(message.id, getApiMetrics([message]))
			if (isTaskHistoryRelevantMessage(message)) this.lastRelevantMessageId = message.id
		}
	}

	private updateHistoryProjection(
		message: DiracMessage | undefined,
		replaced?: {
			id: string
			metrics: ReturnType<typeof getApiMetrics>
			wasRelevant: boolean
		},
		reusePreviousMetrics = false,
	): void {
		if (replaced) {
			addApiMetrics(this.apiMetrics, replaced.metrics, -1)
			this.metricContributionByMessageId.delete(replaced.id)
		}
		if (message) {
			const metrics = reusePreviousMetrics && replaced ? replaced.metrics : getApiMetrics([message])
			this.metricContributionByMessageId.set(message.id, metrics)
			addApiMetrics(this.apiMetrics, metrics, 1)
		}

		const messageIsRelevant = message ? isTaskHistoryRelevantMessage(message) : false
		if (messageIsRelevant) {
			const currentLastIndex = this.lastRelevantMessageId
				? (this.messageIndexById.get(this.lastRelevantMessageId) ?? -1)
				: -1
			const messageIndex = this.messageIndexById.get(message!.id) ?? -1
			if (messageIndex >= currentLastIndex) this.lastRelevantMessageId = message!.id
			return
		}
		if (replaced?.wasRelevant && replaced.id === this.lastRelevantMessageId) this.findLastRelevantMessageId()
	}

	private historyProjectionBeforeMutation(message: DiracMessage): {
		id: string
		metrics: ReturnType<typeof getApiMetrics>
		wasRelevant: boolean
	} {
		return {
			id: message.id,
			metrics: this.metricContributionByMessageId.get(message.id) ?? getApiMetrics([message]),
			wasRelevant: isTaskHistoryRelevantMessage(message),
		}
	}

	private findLastRelevantMessageId(): void {
		this.lastRelevantMessageId = undefined
		for (let index = this.diracMessages.length - 1; index >= 0; index--) {
			if (!isTaskHistoryRelevantMessage(this.diracMessages[index])) continue
			this.lastRelevantMessageId = this.diracMessages[index].id
			return
		}
	}

	/**
	 * Update task history with current state.
	 * This can be slow due to folder size calculation, so it should be called
	 * outside of the stateMutex lock when possible.
	 */
	private async updateTaskHistoryInternal(): Promise<void> {
		if (this.persistenceRetired) return
		try {
			const taskMessage = this.diracMessages[0]
			if (!taskMessage) return
			const lastRelevantMessage =
				(this.lastRelevantMessageId ? this.getMessageById(this.lastRelevantMessageId) : undefined) ?? taskMessage
			const apiMetrics = this.apiMetrics
			const taskDirectory = await ensureTaskDirectoryExists(this.taskId)
			const taskDirectorySize = await getFolderSize.loose(taskDirectory)

			const cwd = await getCwd(getDesktopDir())
			const shadowGitConfigWorkTree = await this.checkpointTracker?.getShadowGitConfigWorkTree()
			if (this.persistenceRetired) return

			await this.updateTaskHistory({
				id: this.taskId,
				ulid: this.ulid,
				ts: lastRelevantMessage.ts,
				task: taskMessage.content.type === "markdown" ? taskMessage.content.content : "",
				tokensIn: apiMetrics.totalTokensIn + this.taskState.utilityPermissionInputTokens,
				tokensOut: apiMetrics.totalTokensOut + this.taskState.utilityPermissionOutputTokens,
				cacheWrites:
					this.taskState.utilityPermissionCacheWriteTokens === 0
						? apiMetrics.totalCacheWrites
						: (apiMetrics.totalCacheWrites ?? 0) + this.taskState.utilityPermissionCacheWriteTokens,
				cacheReads:
					this.taskState.utilityPermissionCacheReadTokens === 0
						? apiMetrics.totalCacheReads
						: (apiMetrics.totalCacheReads ?? 0) + this.taskState.utilityPermissionCacheReadTokens,
				totalCost: apiMetrics.totalCost + this.taskState.utilityPermissionCost,
				size: taskDirectorySize,
				shadowGitConfigWorkTree,
				cwdOnTaskInitialization: cwd,
				conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
				isFavorited: this.taskIsFavorited,
				workspaceRootPath: this.workspaceRootPath,
				checkpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
				modelId: this.lastModelInfo?.modelId,
			})
		} catch (error) {
			Logger.error("Failed to update task history:", error)
			throw error
		}
	}

	/**
	 * Save dirac messages and update task history (public API with mutex protection)
	 * This is the main entry point for saving message state from external callers
	 */
	async saveDiracMessagesAndUpdateHistory(): Promise<void> {
		await this.flushPendingWrites()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(() => this.updateTaskHistoryInternal())
	}

	async addToApiConversationHistory(message: DiracStorageMessage) {
		await this.withStateLock(async () => {
			const storedMessage = removeUserInputMarkersFromMessage(message)
			this.apiConversationHistory.push(storedMessage)
			if (storedMessage.modelInfo) this.lastModelInfo = storedMessage.modelInfo
			this.recordApiConversationOperation({
				offset: ++this.apiHistoryOffset,
				type: "append_message",
				message: structuredClone(storedMessage),
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleApiHistoryFlush()
	}

	async appendToLastApiConversationUserMessage(contentBlock: DiracUserContent): Promise<DiracStorageMessage> {
		const sanitizedContentBlock = removeUserInputMarkersFromContent(contentBlock) as DiracUserContent
		const message = await this.withStateLock(() => {
			const lastMessage = this.apiConversationHistory.at(-1)
			if (!lastMessage || lastMessage.role !== "user") {
				throw new Error("Cannot append content without a final user API conversation message")
			}
			if (typeof lastMessage.content === "string") {
				lastMessage.content = [{ type: "text", text: lastMessage.content }, sanitizedContentBlock]
			} else {
				lastMessage.content.push(sanitizedContentBlock)
			}
			this.recordApiConversationOperation({
				offset: ++this.apiHistoryOffset,
				type: "append_user_content",
				content: structuredClone(sanitizedContentBlock),
			})
			return lastMessage
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleApiHistoryFlush()
		return message
	}

	async overwriteApiConversationHistory(newHistory: DiracStorageMessage[]): Promise<void> {
		await this.flushPendingWrites()
		await this.withStateLock(() => {
			this.apiConversationHistory = newHistory.map(removeUserInputMarkersFromMessage)
			this.lastModelInfo = findLastModelInfo(this.apiConversationHistory)
			this.recordApiConversationOperation({
				offset: ++this.apiHistoryOffset,
				type: "reset",
				messages: this.apiConversationHistory,
			})
		})
		await this.flushPendingWrites()
	}

	async recordDeliveredSteeringMessageIds(messageIds: readonly string[]): Promise<void> {
		await this.flushPendingWrites()
		if (this.persistenceRetired) return
		await this.persistenceMutex.withLock(async () => {
			if (this.persistenceRetired) return
			await this.withStateLock(async () => {
				const deliveredIds = new Set(this.apiConversationProviderState.deliveredSteeringMessageIds ?? [])
				for (const messageId of messageIds) deliveredIds.add(messageId)
				this.apiConversationProviderState = {
					...this.apiConversationProviderState,
					deliveredSteeringMessageIds: [...deliveredIds],
				}
				await saveApiConversationProviderState(this.taskId, this.apiConversationProviderState)
			})
		})
	}

	/**
	 * Add a new message to diracMessages array with proper index tracking
	 * CRITICAL: This entire operation must be atomic to prevent race conditions (RC-4)
	 * The conversationHistoryIndex must be set correctly based on the current state,
	 * and the message must be added and saved without any interleaving operations
	 */
	async addToDiracMessages(message: DiracMessage) {
		await this.withStateLock(async () => {
			if (this.messageIndexById.has(message.id)) throw new Error(`Message with id ${message.id} already exists`)
			if (message.content.type === DiracMessageType.CARD && this.cardMessageIndexById.has(message.content.card.id)) {
				throw new Error(`Card with id ${message.content.card.id} already exists`)
			}
			message.conversationHistoryIndex = this.apiConversationHistory.length - 1
			message.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange
			const index = this.diracMessages.length
			this.diracMessages.push(message)
			this.messageIndexById.set(message.id, index)
			if (message.content.type === DiracMessageType.CARD) {
				this.cardMessageIndexById.set(message.content.card.id, index)
			}
			if (message.content.type === DiracMessageType.API_STATUS) this.lastApiStatusMessageId = message.id
			this.updateHistoryProjection(message)
			this.emitDiracMessagesChanged({
				type: "add",
				messages: this.diracMessages,
				index,
				message,
			})
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "create",
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	/**
	 * Replace the entire diracMessages array with new messages
	 * Protected by mutex to prevent concurrent modifications (RC-4)
	 */
	async overwriteDiracMessages(newMessages: DiracMessage[]) {
		await this.flushPendingWrites()
		await this.withStateLock(() => {
			const previousMessages = this.diracMessages
			this.pendingTextAppendsByMessageId.clear()
			this.diracMessages = newMessages
			this.rebuildMessageIndexes()
			this.rebuildHistoryProjection()
			this.emitDiracMessagesChanged({
				type: "set",
				messages: this.diracMessages,
				previousMessages,
			})
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "reset",
				messages: newMessages,
			})
		})
		await this.flushPendingWrites()
	}

	/**
	 * Find the index of a message by its ID
	 */
	findMessageIndexById(id: string): number {
		return this.messageIndexById.get(id) ?? -1
	}

	getMessageById(id: string): DiracMessage | undefined {
		const index = this.messageIndexById.get(id)
		if (index === undefined) return undefined
		const message = this.diracMessages[index]
		this.materializePresentationAppends(message)
		return message
	}

	getLatestApiStatusMessage(): DiracMessage | undefined {
		return this.lastApiStatusMessageId ? this.getMessageById(this.lastApiStatusMessageId) : undefined
	}

	getPresentationOffset(): number {
		return this.presentationOffset
	}

	getPresentationStateGeneration(): number {
		return this.presentationStateGeneration
	}

	/**
	 * Find the index of a message containing a card with the specified ID
	 */
	findMessageIndexByCardId(cardId: string): number {
		return this.cardMessageIndexById.get(cardId) ?? -1
	}

	async patchCardById(cardId: string, patch: Partial<Omit<Card, "id">>): Promise<Readonly<Card>> {
		const updatedCard = await this.withStateLock(() => {
			const index = this.requireCardMessageIndex(cardId)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.CARD) throw new Error(`Message with card id ${cardId} is not a card`)
			this.materializePresentationAppends(message)
			const before = this.historyProjectionBeforeMutation(message)
			Object.assign(message.content.card, patch)
			this.updateHistoryProjection(message, before, patch.header === undefined && patch.body === undefined && patch.rawOutput === undefined)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_card",
				id: message.id,
				patch,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
			return message.content.card
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
		return updatedCard
	}

	async appendCardBodyById(cardId: string, text: string): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireCardMessageIndex(cardId)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.CARD) throw new Error(`Message with card id ${cardId} is not a card`)
			this.bufferPresentationAppend(message.id, text)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "append_card_body",
				id: message.id,
				text,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	async appendMarkdownById(id: string, text: string): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireMessageIndex(id)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.MARKDOWN) throw new Error(`Message with id ${id} is not markdown`)
			this.bufferPresentationAppend(id, text)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "append_markdown",
				id,
				text,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
				appendedText: text,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	async patchMarkdownById(
		id: string,
		patch: Partial<Omit<Extract<DiracMessage["content"], { type: DiracMessageType.MARKDOWN }>, "type" | "content">>,
	): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireMessageIndex(id)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.MARKDOWN) throw new Error(`Message with id ${id} is not markdown`)
			this.materializePresentationAppends(message)
			const before = this.historyProjectionBeforeMutation(message)
			Object.assign(message.content, patch)
			this.updateHistoryProjection(message, before, true)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_markdown",
				id,
				patch,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	async patchApiStatusById(
		id: string,
		patch: Partial<DiracApiReqInfo>,
		deletions: (keyof DiracApiReqInfo)[] = [],
	): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireMessageIndex(id)
			const message = this.diracMessages[index]
			if (message.content.type !== DiracMessageType.API_STATUS)
				throw new Error(`Message with id ${id} is not an API status`)
			const before = this.historyProjectionBeforeMutation(message)
			Object.assign(message.content.status, patch)
			for (const key of deletions) delete message.content.status[key]
			this.updateHistoryProjection(message, before)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_api_status",
				id,
				patch,
				...(deletions.length > 0 ? { deletions } : {}),
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	private requireMessageIndex(id: string): number {
		const index = this.messageIndexById.get(id)
		if (index === undefined) throw new Error(`Message with id ${id} not found`)
		return index
	}

	private requireCardMessageIndex(cardId: string): number {
		const index = this.cardMessageIndexById.get(cardId)
		if (index === undefined) throw new Error(`Card with id ${cardId} not found`)
		return index
	}
	/**
	 * Update a specific message in the diracMessages array
	 * The entire operation (validate, update, save) is atomic to prevent races (RC-4)
	 */
	async updateDiracMessage(index: number, updates: Partial<Omit<DiracMessage, "id">>): Promise<void> {
		await this.withStateLock(() => {
			if (index < 0 || index >= this.diracMessages.length) {
				throw new Error(`Invalid message index: ${index}`)
			}

			const message = this.diracMessages[index]
			this.materializePresentationAppends(message)
			const before = this.historyProjectionBeforeMutation(message)
			const wasApiStatus = message.content.type === DiracMessageType.API_STATUS
			Object.assign(message, updates)
			this.updateLatestApiStatusAfterMutation(message, wasApiStatus)
			this.updateHistoryProjection(message, before, updates.content === undefined)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_message",
				id: message.id,
				patch: updates,
			})

			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	async patchMessageById(id: string, patch: Partial<Omit<DiracMessage, "id">>): Promise<void> {
		await this.withStateLock(() => {
			const index = this.requireMessageIndex(id)
			const message = this.diracMessages[index]
			this.materializePresentationAppends(message)
			const before = this.historyProjectionBeforeMutation(message)
			const wasApiStatus = message.content.type === DiracMessageType.API_STATUS
			Object.assign(message, patch)
			this.updateLatestApiStatusAfterMutation(message, wasApiStatus)
			this.updateHistoryProjection(message, before, patch.content === undefined)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "patch_message",
				id,
				patch,
			})
			this.emitDiracMessagesChanged({
				type: "update",
				messages: this.diracMessages,
				index,
				message,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}

	/**
	 * Delete a specific message from the diracMessages array
	 * The entire operation (validate, delete, save) is atomic to prevent races (RC-4)
	 */
	async deleteDiracMessage(index: number): Promise<void> {
		await this.withStateLock(() => {
			if (index < 0 || index >= this.diracMessages.length) {
				throw new Error(`Invalid message index: ${index}`)
			}

			const previousMessage = this.diracMessages[index]
			this.materializePresentationAppends(previousMessage)
			const before = this.historyProjectionBeforeMutation(previousMessage)
			this.diracMessages.splice(index, 1)
			this.pendingTextAppendsByMessageId.delete(previousMessage.id)
			this.rebuildMessageIndexes()
			this.updateHistoryProjection(undefined, before)
			this.recordPresentationOperation({
				offset: ++this.presentationOffset,
				type: "delete",
				id: previousMessage.id,
			})

			this.emitDiracMessagesChanged({
				type: "delete",
				messages: this.diracMessages,
				index,
				previousMessage,
			})
		})
		await this.flushIfPersistenceBatchIsFull()
		this.scheduleUiFlush()
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/checkpoints/checkpointDiff.ts (lines 4-12)
```
export async function checkpointDiff(controller: Controller, request: Int64Request): Promise<Empty> {
	if (request.value && controller.task) {
		const message = controller.task.messageStateHandler.getDiracMessages().find((m) => m.ts === request.value)
		if (message) {
			await controller.task.checkpointManager?.presentMultifileDiff?.(message.id, false)
		}
	}
	return Empty.create()
}
```

### /Users/highlands/pools/Development/dirac/src/core/controller/checkpoints/checkpointRestore.ts (lines 10-37)
```
export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	await controller.cancelTask() // we cannot alter message history say if the task is active, as it could be in the middle of editing a file or running a command, which expect the ask to be responded to rather than being superseded by a new message eg add deleted_api_reqs

	if (request.number) {
		// wait for messages to be loaded
		await pWaitFor(() => controller.task?.stateView.isInitialized === true, {
			timeout: 3_000,
		}).catch((error) => {
			Logger.log("Failed to init new Dirac instance to restore checkpoint", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to restore checkpoint",
			})
			throw error
		})

		// NOTE: cancelTask awaits abortTask, which awaits diffViewProvider.revertChanges, which reverts any edited files, allowing us to reset to a checkpoint rather than running into a state where the revertChanges function is called alongside or after the checkpoint reset
		const message = controller.task?.messageStateHandler.getDiracMessages().find((m) => m.ts === request.number)
		if (message) {
			await controller.task?.checkpointManager?.restoreCheckpoint(
				message.id,
				request.restoreType as DiracCheckpointRestore,
				request.offset,
			)
		}
	}
	return Empty.create({})
}
```


## Source Files:

- `src/core/api/conversation.ts`
- `src/core/controller/checkpoints/checkpointDiff.ts`
- `src/core/controller/checkpoints/checkpointRestore.ts`
- `src/core/controller/checkpoints/getCwdHash.ts`
- `src/core/controller/checkpoints/subscribeToCheckpoints.ts`
- `src/core/task/ApiConversationManager.ts`
- `src/core/task/LifecycleManager.ts`
- `src/core/task/TaskMessenger.ts`
- `src/core/task/TaskRequestLoop.ts`
- `src/core/task/ToolExecutor.ts`
- `src/core/task/index.ts`
- `src/core/task/message-state.ts`
- `src/core/task/multifile-diff.ts`
- `src/core/task/response/AssistantMessagePresenter.ts`
- `src/core/task/tools/adapters/traits/OrchestrationTraitBuilder.ts`
- `src/core/task/tools/types/TaskConfig.ts`

