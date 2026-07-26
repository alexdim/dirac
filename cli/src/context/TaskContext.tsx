/**
 * React Context for task state management in CLI
 * Provides access to ExtensionState and task controller
 */

import type { ExtensionState } from "@shared/ExtensionMessage"
import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react"
import { EmptyRequest } from "@shared/proto/dirac/common"
import { subscribeToState } from "@/core/controller/state/subscribeToState"
import { getRequestRegistry } from "@/core/controller/grpc-handler"

let taskContextSubscriptionCounter = 0

interface TaskContextType {
	state: Partial<ExtensionState>
	controller: any
	isComplete: boolean
	setIsComplete: (complete: boolean) => void
	lastError: string | null
	setLastError: (error: string | null) => void
	clearState: () => void
}

const TaskContext = createContext<TaskContextType | undefined>(undefined)

interface TaskContextProviderProps {
	controller: any
	children: ReactNode
}

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

	// Subscribe to controller state updates
	useEffect(() => {
		let disposed = false
		const requestId = `cli-task-context-${++taskContextSubscriptionCounter}`
		const receiveStateUpdate = async ({ stateJson }: { stateJson: string }) => {
			try {
				const newState = JSON.parse(stateJson) as ExtensionState
				if (disposed) return
				// Preserve the visible transcript across a transient empty snapshot, but
				// still accept status/buttons/model changes carried by that snapshot.
				const hadMessages = (stateRef.current.diracMessages?.length ?? 0) > 0
				const hasMessages = (newState.diracMessages?.length ?? 0) > 0
				const previousTaskId = stateRef.current.currentTaskItem?.id
				const nextTaskId = newState.currentTaskItem?.id
				const preserveTranscript = hadMessages && !hasMessages && (!nextTaskId || nextTaskId === previousTaskId)
				setState(preserveTranscript ? { ...newState, diracMessages: stateRef.current.diracMessages } : newState)
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

/**
 * Hook to access task context
 */
export const useTaskContext = (): TaskContextType => {
	const context = useContext(TaskContext)
	if (!context) {
		throw new Error("useTaskContext must be used within TaskContextProvider")
	}
	return context
}

/**
 * Hook to access task state only
 */
export const useTaskState = (): Partial<ExtensionState> => {
	const { state } = useTaskContext()
	return state
}

/**
 * Hook to access controller
 */
export const useTaskController = () => {
	const { controller } = useTaskContext()
	return controller
}
