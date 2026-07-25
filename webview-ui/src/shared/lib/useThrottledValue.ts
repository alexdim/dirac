import { useEffect, useRef, useState } from "react"

/**
 * Returns the latest value at most once per interval, including a trailing update.
 * A zero interval passes values through immediately.
 */
export function useThrottledValue<T>(value: T, interval: number): T {
	const [throttledValue, setThrottledValue] = useState(value)
	const latestValueRef = useRef(value)
	const lastUpdateTimeRef = useRef(0)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		latestValueRef.current = value

		if (interval <= 0) {
			if (timerRef.current) {
				clearTimeout(timerRef.current)
				timerRef.current = null
			}
			lastUpdateTimeRef.current = Date.now()
			setThrottledValue(value)
			return
		}

		if (timerRef.current) return

		const elapsed = Date.now() - lastUpdateTimeRef.current
		const remaining = Math.max(0, interval - elapsed)
		timerRef.current = setTimeout(() => {
			timerRef.current = null
			lastUpdateTimeRef.current = Date.now()
			setThrottledValue(latestValueRef.current)
		}, remaining)
	}, [interval, value])

	useEffect(
		() => () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current)
				timerRef.current = null
			}
		},
		[],
	)

	return interval <= 0 ? value : throttledValue
}
