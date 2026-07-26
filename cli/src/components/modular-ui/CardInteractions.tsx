import { styles, theme } from "../../constants/theme"
import { ActionButton } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"

interface CardInteractionsProps {
	requireFeedback?: boolean
	feedbackPlaceholder?: string
	actions?: ActionButton[]
}

export const CardInteractions: React.FC<CardInteractionsProps> = ({ requireFeedback, feedbackPlaceholder, actions }) => {
	if (!requireFeedback && (!actions || actions.length === 0)) return null

	return (
		<Box flexDirection="column" marginLeft={2}>
			{requireFeedback && (
				<Text {...styles.tool.attention}>
					◇ {feedbackPlaceholder || "Waiting for feedback..."}
				</Text>
			)}
			{actions && actions.length > 0 && (
				<Text>
					{actions.map((action, idx) => {
						const actionColor = action.style === "danger" ? theme.error : action.primary ? theme.primary : theme.text
						return (
							<Text key={idx}>
								<Text color={theme.subtle}>[{idx + 1}]</Text>{" "}
								<Text bold={action.primary} color={actionColor}>
									{action.label}
								</Text>
								{idx < actions.length - 1 ? "   " : ""}
							</Text>
						)
					})}
				</Text>
			)}
		</Box>
	)
}
