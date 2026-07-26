import { theme } from "../constants/theme"
/**
 * Reusable Checkbox component for settings panels
 */

import { Box, Text } from "ink"
import React from "react"

interface CheckboxProps {
	/** Label displayed next to the checkbox */
	label: string
	/** Current checked state */
	checked: boolean
	/** Whether this checkbox is currently selected/focused */
	isSelected?: boolean
	/** Optional description shown below the label */
	description?: string
}

export const Checkbox: React.FC<CheckboxProps> = ({ label, checked, isSelected = false, description }) => {
	return (
		<Box flexDirection="column">
			<Text>
				<Text bold color={isSelected ? theme.primary : theme.subtle}>
					{isSelected ? "❯" : " "}{" "}
				</Text>
				<Text color={checked ? theme.success : theme.muted}>{checked ? "[✓]" : "[ ]"}</Text>
				<Text bold={isSelected} color={isSelected ? theme.strongText : theme.text}> {label}</Text>
				{isSelected && <Text color={theme.muted}> (Space to toggle)</Text>}
			</Text>
			{description && (
				<Box marginLeft={6}>
					<Text color={theme.muted}>{description}</Text>
				</Box>
			)}
		</Box>
	)
}
