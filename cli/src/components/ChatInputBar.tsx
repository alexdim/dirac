import React from "react"
import { Box, Text } from "ink"
import { HighlightedInput } from "./HighlightedInput"

interface ChatInputBarProps {
	borderColor: string
	inputPrompt?: string
	textInput: string
	cursorPos: number
	availableCommands: string[]
	show?: boolean
}

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
	borderColor,
	inputPrompt,
	textInput,
	cursorPos,
	availableCommands,
	show = true,
}) => {
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
				width="100%">
				<Box>
					{inputPrompt && <Text color={borderColor}>{inputPrompt} </Text>}
					<HighlightedInput availableCommands={availableCommands} cursorPos={cursorPos} text={textInput} />
				</Box>
			</Box>
		</Box>
	)
}
