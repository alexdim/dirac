/**
 * Maintains an append-only split between terminal scrollback and the live UI.
 *
 * The static prefix is safe for Ink's <Static>: once a message crosses the
 * watermark it never returns to the dynamic region. Only the mutable suffix stays
 * live; once it finalizes, the complete message is printed into terminal scrollback.
 */

import { useRef } from "react"

export interface TranscriptPartition<T> {
	/** Immutable transcript prefix, printed exactly once by Ink's <Static>. */
	staticPrefix: T[]
	/** Mutable suffix rendered beside the composer. */
	dynamicTail: T[]
}

export function useTranscriptPartition<T>(
	messages: T[],
	isMutable: (message: T) => boolean,
	conversationKey?: string,
): TranscriptPartition<T> {
	const conversationKeyRef = useRef(conversationKey)
	const staticWatermarkRef = useRef(0)
	const staticPrefixRef = useRef<T[]>([])
	const dynamicTailRef = useRef<T[]>([])

	const targetWatermark = calculateTargetWatermark(messages, isMutable)
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
): number {
	const firstMutableIndex = messages.findIndex(isMutable)
	return firstMutableIndex === -1 ? messages.length : firstMutableIndex
}

function sameItems<T>(left: T[], right: T[]): boolean {
	return left.length === right.length && left.every((item, index) => item === right[index])
}
