import React, { useEffect } from "react"
import { Box, Text, useInput } from "ink"
import { centerText } from "../utils/display"
import { DIRAC_LOGO, LOGO_GRADIENT } from "../constants/logo"

export type PlaybackAPI = {
	play: () => void
	pause: () => void
	restart: () => void
}

export type AsciiMotionCliProps = {
	hasDarkBackground?: boolean
	onInteraction?: (input: string, key: any) => void
	autoPlay?: boolean
	loop?: boolean
	onReady?: (api: PlaybackAPI) => void
	compact?: boolean
}
export const StaticRobotFrame: React.FC<{ hasDarkBackground?: boolean; compact?: boolean }> = ({ compact = false }) => {
	return (
		<Box flexDirection="column" marginBottom={compact ? 0 : 1} marginTop={compact ? 0 : 1}>
			{DIRAC_LOGO.map((line, idx) => (
				<Text color={LOGO_GRADIENT[idx]} key={idx}>
					{centerText(line)}
				</Text>
			))}
		</Box>
	)
}

/**
 * AsciiMotionCli - Now a static version of the Dirac logo.
 * Maintained for compatibility with existing views, but with all animation logic removed.
 */
export const AsciiMotionCli: React.FC<AsciiMotionCliProps> = ({ onReady, onInteraction, compact = false }) => {
	useEffect(() => {
		if (onReady) {
			onReady({
				play: () => {},
				pause: () => {},
				restart: () => {},
			})
		}
	}, [onReady])

	// Trigger onInteraction to allow dismissing the welcome state via any keypress
	useInput((input, key) => {
		if (onInteraction) {
			onInteraction(input, key)
		}
	})

	return <StaticRobotFrame compact={compact} />
}
