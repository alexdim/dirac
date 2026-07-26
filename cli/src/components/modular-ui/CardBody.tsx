import { styles } from "../../constants/theme"
import { RenderType } from "@shared/ExtensionMessage"
import { cardBodyForDisplay } from "../../utils/card-body"
import React from "react"
import { Text, Box } from "ink"
import { Diff } from "./Diff"
import { linkifyPaths } from "../../utils/terminal-link"
import { clipTextToWindow } from "../../utils/text-clipping"
import { Markdown } from "./Markdown"

interface CardBodyProps {
	body?: string
	maxLines?: number
	renderType: RenderType
	scrollOffset?: number
	renderWidth?: number
}

export const CardBody: React.FC<CardBodyProps> = ({ body, maxLines, renderType, scrollOffset, renderWidth }) => {
	const displayBody = cardBodyForDisplay(body, renderType)
	if (!displayBody) return null
	const columns = Math.max(1, renderWidth ?? (process.stdout.columns || 80) - 6)
	const { visibleText, hasMoreAbove, hasMoreBelow } = maxLines
		? clipTextToWindow(displayBody, maxLines, columns, scrollOffset ?? 0)
		: { visibleText: displayBody, hasMoreAbove: false, hasMoreBelow: false }
	return (
		<React.Fragment>
			{maxLines ? <Text {...styles.tool.body}>{visibleText}</Text> : renderContent(visibleText, renderType, columns)}
			{(hasMoreAbove || hasMoreBelow) && (
				<Box marginTop={0}>
					<Text {...styles.tool.metadata}>
						{hasMoreAbove ? "↑ " : ""}scroll{hasMoreBelow ? " ↓" : ""}
					</Text>
				</Box>
			)}
		</React.Fragment>
	)
}

function renderContent(body: string, renderType: RenderType, width: number): React.ReactNode {
	switch (renderType) {
		case "markdown":
			return <Markdown color={styles.tool.body.color} width={width}>{body}</Markdown>
		case "diff":
			return <Diff content={body} width={width} />
		case "text":
		default:
			return <Text {...styles.tool.body}>{linkifyPaths(body)}</Text>
	}
}
