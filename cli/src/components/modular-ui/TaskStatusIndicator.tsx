import { TaskStatus } from "@shared/ExtensionMessage"
import { projectTaskStatus, type TaskStatusTone } from "@shared/taskStatusProjection"
import { Box, Text } from "ink"
import React, { useEffect, useMemo, useState } from "react"

const ASCII_SPINNER_FRAMES = ["|", "/", "-", "\\"]
const SPINNER_INTERVAL_MS = 140

import { theme } from "../../constants/theme"

function getToneColor(tone: TaskStatusTone): string {
	switch (tone) {
		case "muted":
			return theme.muted
		case "active":
			return theme.info
		case "warning":
			return theme.warning
		case "success":
			return theme.success
	}
}

interface TaskStatusIndicatorProps {
	status?: TaskStatus
}

export const TaskStatusIndicator: React.FC<TaskStatusIndicatorProps> = ({ status }) => {
	const projection = useMemo(() => projectTaskStatus(status), [status])
	const [frameIndex, setFrameIndex] = useState(0)

	useEffect(() => {
		if (!projection.isBusy) {
			setFrameIndex(0)
			return
		}

		const interval = setInterval(() => {
			setFrameIndex((current) => (current + 1) % ASCII_SPINNER_FRAMES.length)
		}, SPINNER_INTERVAL_MS)

		return () => clearInterval(interval)
	}, [projection.isBusy])

	const color = getToneColor(projection.tone)
	const dimColor = projection.tone === "muted" || projection.tone === "success"

	return (
		<Box>
			{projection.isBusy && (
				<Text color={color}>
					{ASCII_SPINNER_FRAMES[frameIndex]}{" "}
				</Text>
			)}
			<Text color={color} dimColor={dimColor}>
				{projection.label}
			</Text>
		</Box>
	)
}
