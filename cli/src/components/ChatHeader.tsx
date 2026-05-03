import React from "react"
import { Box, Text } from "ink"
import { AsciiMotionCli, StaticRobotFrame } from "./AsciiMotionCli"
import { centerText } from "../utils/display"

interface ChatHeaderProps {
	isWelcomeState?: boolean
	quote?: string
	onInteraction?: (input: string, key: any) => void
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ isWelcomeState, quote, onInteraction }) => {
	const content = (
		<React.Fragment>
			{isWelcomeState ? (
				<AsciiMotionCli onInteraction={onInteraction} />
			) : (
				<StaticRobotFrame />
			)}
			<Text> </Text>
			<Text bold color="white">
				{centerText("What can I do for you?")}
			</Text>
			{isWelcomeState && quote ? (
				<Box marginTop={1}>
					<Text color="cyan" italic>
						{centerText(`“${quote}”`)}
					</Text>
				</Box>
			) : (
				<Text> </Text>
			)}
		</React.Fragment>
	)

	return <Box flexDirection="column">{content}</Box>
}
