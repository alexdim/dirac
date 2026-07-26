import { theme } from "../constants/theme"
import React from "react"
import { Box, Text } from "ink"
import { AsciiMotionCli, StaticRobotFrame } from "./AsciiMotionCli"
import { centerText } from "../utils/display"
import { version as CLI_VERSION } from "../../package.json"

interface ChatHeaderProps {
	isWelcomeState?: boolean
	quote: string
	onInteraction?: (input: string, key: any) => void
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ isWelcomeState, quote, onInteraction }) => {
	const content = (
		<React.Fragment>
			{isWelcomeState ? <AsciiMotionCli compact onInteraction={onInteraction} /> : <StaticRobotFrame compact />}
			<Text color={theme.primary} italic>
				{centerText(`“${quote}”`)}
			</Text>
			<Text color={theme.muted} dimColor>
				{centerText(`Questions about Dirac? Query the code (v${CLI_VERSION}) directly using /askDirac`)}
			</Text>
		</React.Fragment>
	)

	return <Box flexDirection="column">{content}</Box>
}
