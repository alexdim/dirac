---
component_id: 2.1.2
component_name: CLI Subcommands & Runtime Context Providers
---

# CLI Subcommands & Runtime Context Providers

## Component Description

Executes CLI subcommands for task, authentication, configuration, history, and Kanban operations while providing React context providers for task state and standard input.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/context/TaskContext.tsx (lines 33-142)
```
export const TaskContextProvider: React.FC<TaskContextProviderProps> = ({ controller, children }) => {
	const [state, setState] = useState<Partial<ExtensionState>>(
		() =>
			({
				diracMessages: [],
				currentTaskItem: null,
			}) as unknown as Partial<ExtensionState>,
	)
	const [isComplete, setIsComplete] = useState(false)
	const [lastError, setLastError] = useState<string | null>(null)

	// Use ref to track latest state for partial message callback
	const stateRef = useRef(state)
	stateRef.current = state
	const presentationRef = useRef(createPresentationState())

	// Subscribe to controller state updates
	useEffect(() => {
		let disposed = false
		const requestId = `cli-task-context-${++taskContextSubscriptionCounter}`
		const receiveStateUpdate = async ({
			stateJson,
			presentationJson,
		}: {
			stateJson: string
			presentationJson?: string
		}) => {
			try {
				const update = JSON.parse(stateJson) as Partial<ExtensionState>
				let presentationChanged = update.diracMessages !== undefined
				if (disposed) return
				if (update.diracMessages !== undefined) {
					presentationRef.current = createPresentationState(
						update.diracMessages,
						update.presentationSurfaceId,
						update.presentationOffset,
					)
				}
				if (presentationJson) {
					const applied = applyPresentationBatch(
						presentationRef.current,
						JSON.parse(presentationJson) as PresentationBatch,
					)
					presentationChanged ||= applied.result === "applied"
					if (applied.result === "gap") {
						const fullState = (await controller.getStateToPostToWebview()) as ExtensionState
						presentationRef.current = createPresentationState(
							fullState.diracMessages,
							fullState.presentationSurfaceId,
							fullState.presentationOffset,
						)
						Object.assign(update, fullState)
						presentationChanged = true
					}
				}
				const nextState: Partial<ExtensionState> = {
					...stateRef.current,
					...update,
					diracMessages: presentationChanged
						? [...presentationRef.current.messages]
						: (stateRef.current.diracMessages ?? presentationRef.current.messages),
					presentationSurfaceId: presentationRef.current.surfaceId,
					presentationOffset: presentationRef.current.offset,
					activeVoiceStreamId: update.activeVoiceStreamId,
				}
				stateRef.current = nextState
				setState(nextState)
			} catch (error) {
				if (!disposed) setLastError(error instanceof Error ? error.message : String(error))
			}
		}

		void subscribeToState(controller, EmptyRequest.create(), receiveStateUpdate, requestId).then(
			() => {
				if (disposed) getRequestRegistry().cancelRequest(requestId)
			},
			(error) => {
				if (!disposed) setLastError(error instanceof Error ? error.message : String(error))
			},
		)

		return () => {
			disposed = true
			getRequestRegistry().cancelRequest(requestId)
		}
	}, [controller])

	// Force clear state (bypasses the empty messages check for intentional clears like /clear)
	const clearState = () => {
		const clearedState = {
			diracMessages: [],
			currentTaskItem: null,
		} as unknown as Partial<ExtensionState>
		presentationRef.current = createPresentationState()
		stateRef.current = clearedState
		setState(clearedState)
	}

	const value: TaskContextType = {
		state,
		controller,
		isComplete,
		setIsComplete,
		lastError,
		setLastError,
		clearState,
	}

	return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}
```


## Source Files:

- `cli/src/commands/auth.ts`
- `cli/src/commands/config.ts`
- `cli/src/commands/history.ts`
- `cli/src/commands/kanban.ts`
- `cli/src/commands/resume.ts`
- `cli/src/commands/task.ts`
- `cli/src/commands/tools.ts`
- `cli/src/commands/welcome.ts`
- `cli/src/context/StdinContext.tsx`
- `cli/src/context/TaskContext.tsx`

