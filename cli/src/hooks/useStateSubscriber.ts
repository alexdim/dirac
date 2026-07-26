/**
 * Custom hook to subscribe to controller state updates
 * Handles the diff/merge logic for streaming text and message tracking
 */

import { useRef } from "react"
import { useTaskContext } from "../context/TaskContext"
import { getSpinnerActivity } from "../utils/spinner-activity"

export const useIsSpinnerActive = (): { isActive: boolean; startTime?: number } => {
	const { state } = useTaskContext()
	const activeStartTimeRef = useRef<number | undefined>(undefined)
	const activity = getSpinnerActivity(state)

	if (!activity.isActive) {
		activeStartTimeRef.current = undefined
		return activity
	}

	if (activeStartTimeRef.current === undefined) {
		activeStartTimeRef.current = activity.startTime ?? Date.now()
	}

	return { isActive: true, startTime: activeStartTimeRef.current }
}
