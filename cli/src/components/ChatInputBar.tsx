import { theme } from "../constants/theme"
import React, { useMemo } from "react"
import { Box, Text } from "ink"
import { HighlightedInput } from "./HighlightedInput"
import { createInputViewport } from "../utils/input-viewport"

interface ChatInputBarProps {
	borderColor: string
	inputPrompt?: string
	textInput: string
	cursorPos: number
	availableCommands: string[]
	show?: boolean
	terminalColumns?: number
	terminalRows?: number
}

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
	borderColor,
	inputPrompt,
	textInput,
	cursorPos,
	availableCommands,
	show = true,
	terminalColumns,
	terminalRows,
}) => {
	const MAX_INPUT_LINES = 10
	const BORDER_OVERHEAD = 4 // border chars + padding

	const maxInputHeight = Math.max(1, Math.min(MAX_INPUT_LINES, Math.floor((terminalRows ?? 24) / 2) - 2))

	const contentWidth = Math.max(1, (terminalColumns ?? 80) - BORDER_OVERHEAD)

	/**
	 * Front-clip text so its wrapped visual line count fits within maxInputHeight.
	 * Returns the clipped text and how many characters were removed from the front.
	 */
	const viewport = useMemo(() => {
		return createInputViewport(textInput, cursorPos, contentWidth, maxInputHeight)
	}, [textInput, cursorPos, contentWidth, maxInputHeight])
	if (!show) return null

	return (
		<Box flexDirection="column" width="100%">
			<Box
				borderColor={borderColor}
				borderStyle="round"
				flexDirection="row"
				justifyContent="space-between"
				paddingLeft={1}
				paddingRight={1}
				maxHeight={maxInputHeight + 2}
				overflow="hidden"
				width="100%">
				<Box>
					{viewport.hasHiddenBefore && (
						<Text color={theme.muted} dimColor>
							↑ 
						</Text>
					)}
					{inputPrompt && (
						<Text color={borderColor} bold>
							{inputPrompt}{" "}
						</Text>
					)}
					<HighlightedInput
						availableCommands={availableCommands}
						cursorPos={viewport.cursorPosition}
						text={viewport.text}
					/>
					{viewport.hasHiddenAfter && (
						<Text color={theme.muted} dimColor>
							 ↓
						</Text>
					)}
				</Box>
			</Box>
		</Box>
	)
}
