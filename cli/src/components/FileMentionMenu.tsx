import { theme } from "../constants/theme"
/**
 * File mention menu component for CLI
 * Displays a list of matching files when user types @
 */

import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { type FileSearchResult, getRipgrepInstallInstructions } from "../utils/file-search"
import { getVisibleWindow } from "../utils/slash-commands"
import { useTerminalSize } from "../hooks/useTerminalSize"

interface FileMentionMenuProps {
	results: FileSearchResult[]
	selectedIndex: number
	isLoading: boolean
	query: string
	showRipgrepWarning?: boolean
	error?: string | null
}

/**
 * Truncate path from the left if too long, keeping the filename visible
 */
function truncatePath(filePath: string, maxLength = 50): string {
	if (maxLength <= 0) return ""
	if (filePath.length <= maxLength) {
		return filePath
	}
	if (maxLength <= 3) return filePath.slice(-maxLength)
	return "..." + filePath.slice(-(maxLength - 3))
}

export const FileMentionMenu: React.FC<FileMentionMenuProps> = ({
	results,
	selectedIndex,
	isLoading,
	query,
	showRipgrepWarning,
	error,
}) => {
	const { columns } = useTerminalSize()
	const pathWidth = Math.max(1, columns - 6)
	const ripgrepWarning = showRipgrepWarning && (
		<Box marginTop={1}>
			<Text color={theme.warning}>ripgrep not found - file search will be slower. </Text>
			<Text color={theme.muted}>Install: {getRipgrepInstallInstructions()}</Text>
		</Box>
	)

	if (isLoading) {
		return (
			<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color={theme.muted}>Searching files...</Text>
				{ripgrepWarning}
			</Box>
		)
	}

	if (error) {
		return (
			<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color={theme.error}>File search failed: {error}</Text>
				{ripgrepWarning}
			</Box>
		)
	}

	if (results.length === 0) {
		return (
			<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color={theme.muted}>{query ? `No files matching "${query}"` : "Type to search files..."}</Text>
				{ripgrepWarning}
			</Box>
		)
	}

	const { items: visibleResults, startIndex } = getVisibleWindow(results, selectedIndex)
	const hasMoreBelow = startIndex + visibleResults.length < results.length

	return (
		<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
			{visibleResults.map((result, idx) => {
				const isSelected = startIndex + idx === selectedIndex
				const displayPath = truncatePath(result.path, pathWidth)

				return (
					<Box key={result.path}>
						<Text color={isSelected ? COLORS.primaryBlue : undefined}>
							{isSelected ? "❯" : " "} {displayPath}
						</Text>
					</Box>
				)
			})}
			{hasMoreBelow && <Text color={theme.muted}>{"  "}▼</Text>}
			{ripgrepWarning}
		</Box>
	)
}
