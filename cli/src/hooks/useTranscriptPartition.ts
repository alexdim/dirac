/**
 * Maintains an append-only split between terminal scrollback and the live UI.
 *
 * Finalized messages remain in the live suffix while they still contribute rows
 * to the rolling viewport. Once capacity pressure pushes a complete finalized
 * message above the viewport, the watermark advances and Ink prints that message
 * exactly once through <Static>.
 */

import { useRef } from "react"

export interface TranscriptPartition<T> {
	/** Immutable transcript prefix, printed exactly once by Ink's <Static>. */
	staticPrefix: T[]
	/** Uncommitted suffix from which the bounded live viewport is projected. */
	dynamicTail: T[]
}

interface TranscriptRetention<T> {
	rowBudget: number
	estimateRows: (message: T) => number
}

export function useTranscriptPartition<T>(
	messages: T[],
	isMutable: (message: T) => boolean,
	conversationKey?: string,
	retention?: TranscriptRetention<T>,
): TranscriptPartition<T> {
	const conversationKeyRef = useRef(conversationKey)
	const staticWatermarkRef = useRef(0)
	const staticPrefixRef = useRef<T[]>([])
	const dynamicTailRef = useRef<T[]>([])

	const targetWatermark = calculateTargetWatermark(messages, isMutable, retention)
	if (conversationKeyRef.current !== conversationKey) {
		conversationKeyRef.current = conversationKey
		staticWatermarkRef.current = targetWatermark
	} else {
		staticWatermarkRef.current = Math.max(staticWatermarkRef.current, targetWatermark)
	}

	const staticPrefix = messages.slice(0, staticWatermarkRef.current)
	const dynamicTail = messages.slice(staticWatermarkRef.current)

	if (!sameItems(staticPrefix, staticPrefixRef.current)) {
		staticPrefixRef.current = staticPrefix
	}
	if (!sameItems(dynamicTail, dynamicTailRef.current)) {
		dynamicTailRef.current = dynamicTail
	}

	return {
		staticPrefix: staticPrefixRef.current,
		dynamicTail: dynamicTailRef.current,
	}
}

function calculateTargetWatermark<T>(
	messages: T[],
	isMutable: (message: T) => boolean,
	retention?: TranscriptRetention<T>,
): number {
	const firstMutableIndex = messages.findIndex(isMutable)
	const mutableBoundary = firstMutableIndex === -1 ? messages.length : firstMutableIndex
	if (!retention) return mutableBoundary

	const visibleBoundary = calculateVisibleBoundary(messages, retention.rowBudget, retention.estimateRows)
	return Math.min(mutableBoundary, visibleBoundary)
}

export function calculateVisibleBoundary<T>(
	messages: T[],
	rowBudget: number,
	estimateRows: (message: T) => number,
): number {
	if (messages.length === 0) return 0

	let remainingRows = Math.max(1, rowBudget)
	for (let index = messages.length - 1; index >= 0; index--) {
		const messageRows = Math.max(1, estimateRows(messages[index]))
		if (messageRows >= remainingRows) return index
		remainingRows -= messageRows
	}

	return 0
}

function sameItems<T>(left: T[], right: T[]): boolean {
	return left.length === right.length && left.every((item, index) => item === right[index])
}
