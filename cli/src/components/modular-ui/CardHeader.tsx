import { styles } from "../../constants/theme"
import { CardStatus } from "@shared/ExtensionMessage"
import { Text } from "ink"
import Spinner from "ink-spinner"
import React from "react"
import { getIcon, getIconCategoryColor, getStatusColor, getStatusIcon } from "../../utils/icon-mapping"

interface CardHeaderProps {
	header: string
	status: CardStatus
	icon?: string
	isCollapsed?: boolean
	compact?: boolean
}

function getHeaderPresentation(status: CardStatus) {
	switch (status) {
		case CardStatus.ERROR:
		case CardStatus.CANCELLED:
			return styles.tool.errorHeader
		case CardStatus.WAITING_FOR_INPUT:
			return styles.tool.attentionHeader
		case CardStatus.RUNNING:
		case CardStatus.BUILDING:
			return styles.tool.activeHeader
		default:
			return styles.tool.header
	}
}

export const CardHeader: React.FC<CardHeaderProps> = ({ header, status, icon, compact }) => {
	const statusColor = getStatusColor(status)
	const categoryColor = getIconCategoryColor(icon)
	const statusIcon = getStatusIcon(status)
	const isRunning = status === CardStatus.RUNNING || status === CardStatus.BUILDING
	const headerPresentation = getHeaderPresentation(status)
	const statusLabel = status.toLowerCase().replaceAll("_", " ")
	const headerColor = headerPresentation.color
	const headerBold = "bold" in headerPresentation ? headerPresentation.bold : false

	if (compact) {
		return (
			<Text>
				<Text color={categoryColor}>{getIcon(icon)}</Text>{" "}
				<Text bold={headerBold}>
					<Text color={headerColor}>{header}</Text>
				</Text>{" "}
				<Text color={statusColor}>{isRunning ? <Spinner type="dots" /> : statusIcon}</Text>
			</Text>
		)
	}

	return (
		<Text>
			<Text color={categoryColor}>{getIcon(icon)}</Text>{" "}
			<Text bold={headerBold}>
				<Text color={headerColor}>{header}</Text>
			</Text>{" "}
			<Text color={statusColor}>{isRunning ? <Spinner type="dots" /> : statusIcon}</Text>{" "}
			<Text {...styles.tool.metadata}>{statusLabel}</Text>
		</Text>
	)
}
