import { theme } from "../constants/theme"
/**
 * Loading spinner component using ink-spinner
 */

import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import React from "react"

interface LoadingSpinnerProps {
	mode?: "act" | "plan"
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ mode = "act" }) => {
	const message = mode === "plan" ? "Planning" : "Thinking"
	return (
		<Box>
			<Text color={theme.info}>
				<Spinner type="dots" />
			</Text>
			<Text color={theme.info}> {message}...</Text>
		</Box>
	)
}
