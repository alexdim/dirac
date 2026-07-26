import type { Card } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"
import { theme } from "../../constants/theme"
import { CardBody } from "./CardBody"

interface TaskCompletionCardProps {
	card: Card
	maxBodyLines?: number
	scrollOffset?: number
	suppressBody?: boolean
}

export const TaskCompletionCard: React.FC<TaskCompletionCardProps> = ({
	card,
	maxBodyLines,
	scrollOffset,
	suppressBody = false,
}) => {
	const hasBody = Boolean(card.body) && !suppressBody
	return (
		<Box
			borderColor={theme.toolComplete}
			borderStyle="round"
			flexDirection="column"
			paddingX={1}
			width="100%">
			<Text bold>
				<Text color={theme.toolComplete}>✔ Task Completed</Text>
			</Text>
			{hasBody && (
				<Box marginTop={1} paddingLeft={1}>
					<CardBody
						body={card.body}
						maxLines={maxBodyLines}
						renderType={card.renderType}
						scrollOffset={scrollOffset}
					/>
				</Box>
			)}
		</Box>
	)
}
