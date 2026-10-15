---
component_id: 2.5
component_name: Interactive Terminal UI Hooks
---

# Interactive Terminal UI Hooks

## Component Description

Supplies custom React hooks for chat message timelines, input handling, terminal dimensions, scrollable lists, and footer git status in the Ink UI.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/hooks/useTerminalSize.ts (lines 95-97)
```
export function useTerminalSize(): TerminalSizeSnapshot {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
```

### /Users/highlands/pools/Development/dirac/cli/src/hooks/useScrollableList.ts (lines 78-80)
```
export function useScrollableList(itemCount: number, selectedIndex: number, maxRows: number): ScrollableListResult {
	return useMemo(() => calculateScrollableList(itemCount, selectedIndex, maxRows), [itemCount, selectedIndex, maxRows])
}
```

### /Users/highlands/pools/Development/dirac/cli/src/hooks/useChatFooterStatus.ts (lines 33-141)
```
export function useChatFooterStatus({ ctrl, mode, taskState }: UseChatFooterStatusProps): ChatFooterStatus {
	const provider = useMemo(() => {
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const stateManagerValue = StateManager.get().getGlobalSettingsKey(providerKey) as string
		if (stateManagerValue) {
			return stateManagerValue
		}
		const configValue = (taskState.apiConfiguration as any)?.[providerKey] as string | undefined
		if (configValue !== undefined) {
			return configValue
		}
		return (StateManager.get().getGlobalSettingsKey(providerKey) as string) || ""
	}, [mode, taskState.apiConfiguration])

	const modelId = useMemo(() => {
		if (!provider) return ""
		const modelKey = getProviderModelIdKey(provider as ApiProvider, mode)
		const stateManagerValue = StateManager.get().getGlobalSettingsKey(modelKey) as string
		if (stateManagerValue) {
			return stateManagerValue
		}
		const configValue = (taskState.apiConfiguration as any)?.[modelKey] as string | undefined
		if (configValue !== undefined) {
			return configValue
		}
		return (
			(StateManager.get().getGlobalSettingsKey(modelKey) as string) ||
			getProviderDefaultModelId(provider as ApiProvider) ||
			""
		)
	}, [mode, provider, taskState.apiConfiguration])

	const inferenceSpeed = useMemo(() => {
		const inferenceSpeedKey = mode === "act" ? "actModeInferenceSpeed" : "planModeInferenceSpeed"
		const configValue = (taskState.apiConfiguration as any)?.[inferenceSpeedKey]
		if (configValue !== undefined) return configValue
		return StateManager.get().getGlobalSettingsKey(inferenceSpeedKey) ?? "default"
	}, [mode, taskState.apiConfiguration])
	const fastModeEnabled =
		inferenceSpeed === "fast" &&
		!!provider &&
		!!modelId &&
		modelSupportsInferenceSpeed(provider as ApiProvider, modelId)

	const workspacePath = useMemo(() => {
		const root = ctrl?.getWorkspaceManagerSync?.()?.getPrimaryRoot?.()
		return root?.path ?? process.cwd()
	}, [ctrl])

	const [gitBranch, setGitBranch] = useState<string | null>(null)
	const [gitDiffStats, setGitDiffStats] = useState<GitDiffStats | null>(null)

	useEffect(() => {
		setGitBranch(getGitBranch(workspacePath))
		setGitDiffStats(getGitDiffStats(workspacePath))
	}, [workspacePath])

	const lastMsg = (taskState.diracMessages || [])[(taskState.diracMessages || []).length - 1]
	useEffect(() => {
		setGitBranch(getGitBranch(workspacePath))
		setGitDiffStats(getGitDiffStats(workspacePath))
	}, [taskState.diracMessages?.length, taskState.activeVoiceStreamId, lastMsg?.id, workspacePath])

	const metrics = getApiMetrics(taskState.diracMessages || [])
	const lastApiReqTotalTokens = useMemo(
		() => getLastApiReqTotalTokens(taskState.diracMessages || []),
		[taskState.diracMessages],
	)
	const contextWindowSize = useMemo(() => {
		const messages = taskState.diracMessages || []
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index]
			if (message.content.type === DiracMessageType.API_STATUS && message.content.status.contextWindow) {
				return message.content.status.contextWindow
			}
		}

		const modelInfoKey = getProviderModelInfoKey(provider as ApiProvider, mode)
		if (modelInfoKey) {
			const stateManagerModelInfo = StateManager.get().getGlobalSettingsKey(modelInfoKey) as ModelInfo | undefined
			if (stateManagerModelInfo?.contextWindow) return stateManagerModelInfo.contextWindow
			const configModelInfo = (taskState.apiConfiguration as Record<string, unknown> | undefined)?.[modelInfoKey] as
				| ModelInfo
				| undefined
			if (configModelInfo?.contextWindow) return configModelInfo.contextWindow
		}

		const providerData = providerModels[provider]
		if (providerData && modelId in providerData.models) {
			const modelInfo = providerData.models[modelId] as ModelInfo
			if (modelInfo?.contextWindow) return modelInfo.contextWindow
		}
		return DEFAULT_CONTEXT_WINDOW
	}, [provider, modelId, mode, taskState.apiConfiguration, taskState.diracMessages])

	return {
		provider,
		modelId,
		fastModeEnabled,
		lastApiReqTotalTokens,
		contextWindowSize,
		totalCost: metrics.totalCost,
		cacheHitRate: metrics.cacheHitRate,
		workspacePath,
		gitBranch,
		gitDiffStats,
		taskStatus: taskState.taskStatus ?? TaskStatus.IDLE,
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/hooks/useChatInputHandler.ts (lines 102-490)
```
export function useChatInputHandler({
	workspacePath,
	textInputRef,
	cursorPosRef,
	setTextInput,
	setCursorPos,
	activePanel,
	setActivePanel,
	handleAskShortcuts,
	handleKeyboardSequence,
	handleCtrlShortcut,
	insertTextAtCursor,
	toggleMode,
	toggleAutoApproveAll,
	enableFastMode,
	toggleQuietMode,
	handleSubmit,
	handleExit,
	clearViewAndResetTask,
	filteredCommands,
	selectedSlashIndex,
	setSelectedSlashIndex,
	slashMenuDismissed,
	setSlashMenuDismissed,
	fileResults,
	selectedIndex,
	setSelectedIndex,
	setFileResults,
	getHistoryItems,
	historyIndex,
	setHistoryIndex,
	savedInput,
	setSavedInput,
	isSpinnerActive,
	isProcessing,
	yolo,
	uiActionState,
	pendingAsk,
	handleButtonAction,
	isYoloSuppressed,
	lastPasteTimeRef,
	activePasteNumRef,
	activePasteLinesRef,
	activePasteStartPosRef,
	pasteCounterRef,
	pasteUpdateTimeoutRef,
	setPastedTexts,
	PASTE_COLLAPSE_THRESHOLD,
	PASTE_CHUNK_WINDOW_MS,
	PASTE_UPDATE_DEBOUNCE_MS,
	mode,
	isEmptyConversation,
	scrollableCardMaxOffset,
	cardScrollOffset,
	setCardScrollOffset,
	goalStatus,
	handleGoalControl,
	toggleGoalDetails,
	disarmGoalStopConfirmation,
}: UseChatInputHandlerProps) {
	useInput((input, key) => {
		if (isMouseEscapeSequence(input) || isTerminalResponseSequence(input, key)) return
		if (activePanel) {
			disarmGoalStopConfirmation()
			return
		}

		const currentTextInput = textInputRef.current
		const currentCursorPos = cursorPosRef.current
		const currentMentionInfo = extractMentionQuery(currentTextInput, currentCursorPos)
		const currentSlashInfo = extractSlashQuery(currentTextInput, currentCursorPos)
		const localSlashCommandContext = {
			mode,
			setActivePanel,
			resetInputLine: () => {
				setTextInput("")
				setCursorPos(0)
			},
			clearViewAndResetTask,
			handleExit,
			enableFastMode,
			toggleQuietMode,
		}

		const goalShortcut = getGoalKeyboardShortcut(input, key, goalStatus)
		if (goalShortcut === "details") {
			toggleGoalDetails()
			return
		}
		if (goalShortcut) {
			handleGoalControl(goalShortcut)
			return
		}
		disarmGoalStopConfirmation()

		if (handleAskShortcuts(input, key, currentTextInput)) return
		if (handleKeyboardSequence(input)) return

		if (key.meta) {
			if (key.leftArrow) {
				setCursorPos(findWordStart(currentTextInput, currentCursorPos))
				return
			}
			if (key.rightArrow) {
				setCursorPos(findWordEnd(currentTextInput, currentCursorPos))
				return
			}
		}

		const inSlashMenu = currentSlashInfo.inSlashMode && filteredCommands.length > 0 && !slashMenuDismissed
		const inFileMenu = currentMentionInfo.inMentionMode && fileResults.length > 0 && !inSlashMenu

		if (inSlashMenu) {
			if (key.upArrow) {
				setSelectedSlashIndex((i) => Math.max(0, i - 1))
				return
			}
			if (key.downArrow) {
				setSelectedSlashIndex((i) => Math.min(filteredCommands.length - 1, i + 1))
				return
			}
			if (key.tab || key.return) {
				const cmd = filteredCommands[selectedSlashIndex]
				if (cmd) {
					const wasLocalCommand = executeLocalSlashCommand(cmd.name, localSlashCommandContext)

					if (wasLocalCommand) {
						setSelectedSlashIndex(0)
						setSlashMenuDismissed(true)
						return
					}

					const insertion = insertSlashCommand(
						currentTextInput,
						currentSlashInfo.slashIndex,
						cmd.name,
						currentCursorPos,
					)
					setTextInput(insertion.text)
					setCursorPos(insertion.cursorPosition)
					setSelectedSlashIndex(0)
				}
				return
			}
			if (key.escape) {
				setSlashMenuDismissed(true)
				setSelectedSlashIndex(0)
				return
			}
		}

		if (inFileMenu) {
			if (key.upArrow) {
				setSelectedIndex((i) => Math.max(0, i - 1))
				return
			}
			if (key.downArrow) {
				setSelectedIndex((i) => Math.min(fileResults.length - 1, i + 1))
				return
			}
			if (key.tab || key.return) {
				const file = fileResults[selectedIndex]
				if (file) {
					const insertion = insertMention(currentTextInput, currentMentionInfo.atIndex, file.path, currentCursorPos)
					setTextInput(insertion.text)
					setCursorPos(insertion.cursorPosition)
					setFileResults([])
					setSelectedIndex(0)
				}
				return
			}
			if (key.escape) {
				setFileResults([])
				setSelectedIndex(0)
				return
			}
		}

		if (key.shift && key.downArrow) {
			insertTextAtCursor("\n")
			return
		}

		if (key.upArrow && !inSlashMenu && !inFileMenu && scrollableCardMaxOffset > 0) {
			setCardScrollOffset(Math.min(cardScrollOffset + 1, scrollableCardMaxOffset))
			return
		}
		if (key.downArrow && !inSlashMenu && !inFileMenu && cardScrollOffset > 0) {
			setCardScrollOffset(Math.max(cardScrollOffset - 1, 0))
			return
		}

		if (key.upArrow && !inSlashMenu && !inFileMenu && isEmptyConversation) {
			const historyItems = getHistoryItems()
			if (historyItems.length > 0) {
				const canNavigate =
					currentTextInput === "" ||
					(historyIndex >= 0 && historyIndex < historyItems.length && currentTextInput === historyItems[historyIndex])
				if (canNavigate) {
					if (historyIndex === -1) setSavedInput(currentTextInput)
					const newIndex = Math.min(historyIndex + 1, historyItems.length - 1)
					if (newIndex !== historyIndex) {
						setHistoryIndex(newIndex)
						const historyText = historyItems[newIndex]
						setTextInput(historyText)
						setCursorPos(historyText.length)
					}
					return
				}
			}
		}

		if (key.downArrow && !inSlashMenu && !inFileMenu && isEmptyConversation) {
			const historyItems = getHistoryItems()
			if (historyIndex >= 0) {
				const canNavigate = historyIndex < historyItems.length && currentTextInput === historyItems[historyIndex]
				if (canNavigate) {
					const newIndex = historyIndex - 1
					if (newIndex >= 0) {
						setHistoryIndex(newIndex)
						const historyText = historyItems[newIndex]
						setTextInput(historyText)
						setCursorPos(historyText.length)
					} else {
						setHistoryIndex(-1)
						setTextInput(savedInput)
						setCursorPos(savedInput.length)
					}
					return
				}
			}
		}

		const currentUiActionState = uiActionState || {}
		const globalButtons = getVisibleGlobalActionButtons(currentUiActionState.globalButtons || [])
		const buttons = [...globalButtons, ...(currentUiActionState.cardButtons || [])]

		if (
			buttons.length > 0 &&
			!isProcessing &&
			currentTextInput === "" &&
			(!pendingAsk || !isYoloSuppressed(yolo, pendingAsk))
		) {
			const num = Number.parseInt(input, 10)
			if (!Number.isNaN(num) && num >= 1 && num <= buttons.length) {
				handleButtonAction(buttons[num - 1].action, true, buttons[num - 1].value)
				return
			}
		}

		const card = pendingAsk?.content?.type === DiracMessageType.CARD ? pendingAsk.content.card : null
		if (currentTextInput === "" && !isProcessing) {
			if (card?.actions && card.actions.length > 0) {
				const num = Number.parseInt(input, 10)
				if (!Number.isNaN(num) && num >= 1 && num <= card.actions.length) {
					handleButtonAction(UIActionButtonType.UTILITY, false, card.actions[num - 1].value)
					return
				}
			}
		}

		if (key.ctrl && (input === "v" || input === "\u0016")) {
			// Try to read image from clipboard in the background.
			// We don't return here so that the terminal can still perform its default paste behavior for text.
			void (async () => {
				// Only attempt if not in an SSH session to avoid unnecessary tool calls that will fail anyway
				if (!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY)) {
					const imagePath = await readImageFromClipboard()
					if (imagePath) {
						// Clipboard images are absolute temporary files. `@/…` is reserved
						// for workspace-relative mentions, so insert a standalone quoted path.
						insertTextAtCursor(`"${imagePath}" `)
					}
				}
			})()
		}

		if (key.ctrl && input && handleCtrlShortcut(input)) return

		if (input && input.length > PASTE_COLLAPSE_THRESHOLD) {
			const now = Date.now()
			const timeSinceLastPaste = now - lastPasteTimeRef.current
			lastPasteTimeRef.current = now

			if (timeSinceLastPaste < PASTE_CHUNK_WINDOW_MS && activePasteNumRef.current > 0) {
				const pasteNum = activePasteNumRef.current
				const chunkLines = input.match(/[\r\n]/g)?.length || 0
				activePasteLinesRef.current += chunkLines

				setPastedTexts((prev) => {
					const next = new Map(prev)
					next.set(pasteNum, (next.get(pasteNum) || "") + input)
					return next
				})

				if (pasteUpdateTimeoutRef.current) clearTimeout(pasteUpdateTimeoutRef.current)
				pasteUpdateTimeoutRef.current = setTimeout(() => {
					const newPlaceholder = `[Pasted text #${pasteNum} +${activePasteLinesRef.current} lines]`
					const pattern = new RegExp(`\\[Pasted text #${pasteNum} \\+\\d+ lines\\]`)
					const latestText = textInputRef.current
					const match = pattern.exec(latestText)
					if (!match) return

					const oldPlaceholderEnd = match.index + match[0].length
					const cursorWasAfterPlaceholder = cursorPosRef.current === oldPlaceholderEnd
					setTextInput((text) => text.replace(pattern, newPlaceholder))
					if (cursorWasAfterPlaceholder) {
						setCursorPos(match.index + newPlaceholder.length)
					}
				}, PASTE_UPDATE_DEBOUNCE_MS)
				return
			}

			pasteCounterRef.current += 1
			const pasteNum = pasteCounterRef.current
			activePasteNumRef.current = pasteNum
			activePasteStartPosRef.current = currentCursorPos
			const extraLines = input.match(/[\r\n]/g)?.length || 0
			activePasteLinesRef.current = extraLines
			const placeholder = `[Pasted text #${pasteNum} +${extraLines} lines]`
			setPastedTexts((prev) => {
				const next = new Map(prev)
				next.set(pasteNum, input)
				return next
			})
			const newText = currentTextInput.slice(0, currentCursorPos) + placeholder + currentTextInput.slice(currentCursorPos)
			setTextInput(newText)
			setCursorPos(currentCursorPos + placeholder.length)
			return
		}

		if (key.return && (key.shift || key.meta || input === "\n")) {
			insertTextAtCursor("\n")
			return
		}
		if (key.shift && key.tab) {
			toggleAutoApproveAll()
			return
		}
		if (key.tab && !currentMentionInfo.inMentionMode && !currentSlashInfo.inSlashMode) {
			toggleMode()
			return
		}
		if (
			key.return &&
			!key.shift &&
			!key.meta &&
			input !== "\n" &&
			!currentMentionInfo.inMentionMode &&
			(!isSpinnerActive || goalStatus !== undefined) &&
			!isProcessing
		) {
			if (executeStandaloneLocalSlashCommand(currentTextInput, localSlashCommandContext)) {
				setSelectedSlashIndex(0)
				setSlashMenuDismissed(true)
				return
			}
			if (currentSlashInfo.inSlashMode) return
			const { prompt: currentPrompt, imagePaths: currentImagePaths } = parseImagesFromInput(currentTextInput, workspacePath)
			if (currentPrompt.trim() || currentImagePaths.length > 0) {
				handleSubmit(currentPrompt.trim(), currentImagePaths)
			}
			return
		}

		if (key.leftArrow && !inSlashMenu && !inFileMenu) {
			setCursorPos((pos) => Math.max(0, pos - 1))
			return
		}
		if (key.rightArrow && !inSlashMenu && !inFileMenu) {
			setCursorPos((pos) => Math.min(currentTextInput.length, pos + 1))
			return
		}
		if (key.upArrow && !inSlashMenu && !inFileMenu) {
			setCursorPos(moveCursorUp(currentTextInput, currentCursorPos))
			return
		}
		if (key.downArrow && !inSlashMenu && !inFileMenu) {
			setCursorPos(moveCursorDown(currentTextInput, currentCursorPos))
			return
		}

		if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.tab) {
			if (cardScrollOffset > 0) setCardScrollOffset(0)

			insertTextAtCursor(input)
		}
	})
}
```


## Source Files:

- `cli/src/hooks/useChatFooterStatus.ts`
- `cli/src/hooks/useChatInputHandler.ts`
- `cli/src/hooks/useChatMessages.ts`
- `cli/src/hooks/useChatTask.ts`
- `cli/src/hooks/useChatTimeline.ts`
- `cli/src/hooks/useComposer.ts`
- `cli/src/hooks/useHomeEndKeys.ts`
- `cli/src/hooks/useOcaAuth.ts`
- `cli/src/hooks/useRawBackspaceKeys.ts`
- `cli/src/hooks/useScrollableList.ts`
- `cli/src/hooks/useTerminalSize.ts`
- `cli/src/hooks/useTextInput.ts`
- `cli/src/hooks/useTranscriptPartition.ts`

