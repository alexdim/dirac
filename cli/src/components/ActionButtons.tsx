import { theme } from "../constants/theme"
/**
 * Action buttons component for CLI
 * Shows primary/secondary buttons above the input field
 * Supports keyboard navigation (1/2 for buttons, arrows to navigate, esc to cancel)
 */

import type { UIActionState } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { getVisibleGlobalActionButtons } from "../utils/action-buttons"

export const ActionButtons: React.FC<{
	uiActionState: UIActionState
	mode?: "act" | "plan"
	isProcessing?: boolean
}> = ({ uiActionState, mode = "act", isProcessing }) => {
	const { columns: terminalWidth } = useTerminalSize()

	// Cancel is handled by ThinkingIndicator with Escape while work is active.
	const buttons = getVisibleGlobalActionButtons(uiActionState.globalButtons)

	if (buttons.length === 0) {
		return null
	}

	const buttonCount = buttons.length
	const stackButtons = terminalWidth < Math.max(24, buttonCount * 10)
	const totalGapWidth = stackButtons ? 0 : Math.max(0, buttonCount - 1)
	const availableWidth = Math.max(1, terminalWidth - (terminalWidth > 2 ? 2 : 0) - totalGapWidth)
	const buttonWidth = stackButtons ? availableWidth : Math.max(1, Math.floor(availableWidth / buttonCount))

	const modeButtonBg = mode === "plan" ? theme.buttonPlanBg : theme.buttonPrimaryBg

	const renderButton = (text: string, shortcut: string, style: string | undefined, key: string) => {
		const fullLabel = ` ${text} (${shortcut}) `
		const shortcutLabel = `[${shortcut}]`
		const label =
			fullLabel.length <= buttonWidth
				? fullLabel
				: buttonWidth <= shortcutLabel.length
					? shortcutLabel.slice(0, buttonWidth)
					: ` ${text.slice(0, Math.max(0, buttonWidth - shortcutLabel.length - 3))}…${shortcutLabel}`.slice(0, buttonWidth)
		const padding = Math.max(0, buttonWidth - label.length)
		const leftPad = Math.floor(padding / 2)
		const rightPad = padding - leftPad
		const paddedLabel = " ".repeat(leftPad) + label + " ".repeat(rightPad)

		const bgColor = isProcessing
			? theme.buttonSecondaryBg
			: style === "danger"
				? theme.buttonDangerBg
				: style === "secondary"
					? theme.buttonSecondaryBg
					: modeButtonBg
		const textColor = style === "danger"
			? theme.buttonDangerText
			: style === "secondary" || isProcessing
				? theme.buttonSecondaryText
				: theme.buttonPrimaryText

		return (
			<Text backgroundColor={bgColor} color={textColor} key={key}>
				{paddedLabel}
			</Text>
		)
	}

	return (
		<Box
			flexDirection={stackButtons ? "column" : "row"}
			gap={stackButtons ? 0 : 1}
			marginLeft={terminalWidth > 2 ? 1 : 0}
			width="100%"
			marginBottom={1}>
			{buttons.map((button, index) =>
				renderButton(
					button.label,
					String(index + 1),
					button.style,
					`${button.action}-${button.value ?? index}`,
				),
			)}
		</Box>
	)
}
