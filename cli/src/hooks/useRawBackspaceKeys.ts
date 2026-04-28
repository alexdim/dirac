/**
 * Hook to detect Backspace and Delete keys from raw stdin.
 *
 * Ink's useInput hook maps \x7f (the character the backspace key actually sends)
 * to key.name = 'delete' instead of 'backspace', making key.backspace always false.
 * It also collapses both backspace and forward-delete into key.delete = true, so
 * they are indistinguishable from the key object alone.
 *
 * This hook subscribes to raw stdin events (before Ink processes them) to correctly
 * distinguish backspace sequences from forward-delete sequences, and also handles
 * coalesced repeat keypresses (e.g. holding down backspace sends multiple \x7f bytes
 * in a single chunk).
 *
 * Follows the same pattern as useHomeEndKeys.
 */

import { useStdin } from "ink"
import { useCallback, useEffect, useRef } from "react"

import { BACKSPACE_SEQUENCES, DELETE_SEQUENCES } from "../constants/keyboard"

interface UseRawBackspaceKeysOptions {
	onBackspace: (count: number) => void
	onDelete: (count: number) => void
	isActive?: boolean
}

/**
 * Subscribe to raw stdin to detect Backspace and forward-Delete keys.
 * Processes longest sequences first to avoid double-counting (e.g. \x1b\x7f
 * contains \x7f, so we must match and strip the longer sequence first).
 */
export function useRawBackspaceKeys({ onBackspace, onDelete, isActive = true }: UseRawBackspaceKeysOptions): void {
	// Use refs to avoid stale closure issues
	const onBackspaceRef = useRef(onBackspace)
	const onDeleteRef = useRef(onDelete)
	onBackspaceRef.current = onBackspace
	onDeleteRef.current = onDelete

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { internal_eventEmitter } = useStdin() as any

	const handleInput = useCallback((data: Buffer | string) => {
		let s = typeof data === "string" ? data : data.toString()

		// Count backspace sequences — process longest sequences first to avoid
		// double-counting shorter sequences that appear inside longer ones
		// (e.g. \x7f is a suffix of \x1b\x7f).
		const sortedBackspaceSeqs = [...BACKSPACE_SEQUENCES].sort((a, b) => b.length - a.length)
		let backspaceCount = 0
		for (const seq of sortedBackspaceSeqs) {
			if (s.includes(seq)) {
				const count = s.split(seq).length - 1
				backspaceCount += count
				s = s.split(seq).join("")
			}
		}

		if (backspaceCount > 0) {
			onBackspaceRef.current(backspaceCount)
		}

		// Count forward-delete sequences (e.g. \x1b[3~)
		let deleteCount = 0
		for (const seq of DELETE_SEQUENCES) {
			if (s.includes(seq)) {
				const count = s.split(seq).length - 1
				deleteCount += count
				s = s.split(seq).join("")
			}
		}

		if (deleteCount > 0) {
			onDeleteRef.current(deleteCount)
		}
	}, [])

	useEffect(() => {
		if (!isActive || !internal_eventEmitter) {
			return
		}

		internal_eventEmitter.on("input", handleInput)
		return () => {
			internal_eventEmitter.removeListener("input", handleInput)
		}
	}, [isActive, internal_eventEmitter, handleInput])
}
