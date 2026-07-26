import type { Card } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"
import { theme } from "../../constants/theme"
import { Markdown } from "./Markdown"
import { cardBodyForDisplay } from "../../utils/card-body"

interface TaskCompletionCardProps {
	card: Card
}

export const TaskCompletionCard: React.FC<TaskCompletionCardProps> = ({ card }) => {
	const body = cardBodyForDisplay(card.body, card.renderType)
	return (
		<Box
			borderColor={theme.toolComplete}
			borderStyle="round"
			flexDirection="column"
			paddingX={1}
			width="100%">
			<Text bold color={theme.toolComplete}>✔ Task Completed</Text>
			{body && (
				<Box marginTop={1} paddingLeft={1}>
					<Markdown color={theme.strongText}>{body}</Markdown>
				</Box>
			)}
		</Box>
	)
}
