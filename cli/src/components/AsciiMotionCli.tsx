import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { centerText } from '../utils/display';

export type PlaybackAPI = {
	play: () => void;
	pause: () => void;
	restart: () => void;
};

export type AsciiMotionCliProps = {
	hasDarkBackground?: boolean;
	onInteraction?: (input: string, key: any) => void;
	autoPlay?: boolean;
	loop?: boolean;
	onReady?: (api: PlaybackAPI) => void;
};

const _DIRAC_COLORS = {
	delta: '#E4E4E7',
	dot: '#F59E0B',
	line: '#F59E0B',
	underline: '#3F3F46',
};

// ASCII art Dirac logo
const DIRAC_LOGO = [
	"        █████████████        ",
	"      ███          ▀▀██      ",
	"    ██▀                      ",
	"    ██▄                      ",
	"      ▀██▄                   ",
	"         ▀██▄                ",
	"           ▀██▄              ",
	"         ▄██▀ ▀██▄           ",
	"      ▄██▀      ▀██▄         ",
    "    ▄██▀          ▀██▄       ",
	"  ▄██▀              ▀██▄     ",
	"▄██▀                  ▀██▄   ",
	"▀██▄                  ▄██▀   ",
	"  ▀██▄              ▄██▀     ",
	"    ▀██▄          ▄██▀       ",
	"       ▀▀▀▀▀▀▀▀▀▀▀▀          "
];

export const StaticRobotFrame: React.FC<{ hasDarkBackground?: boolean }> = () => {
	return (
		<Box flexDirection="column" marginBottom={1} marginTop={1}>
			{DIRAC_LOGO.map((line, idx) => (
				<Text color="#F59E0B" key={idx}>
					{centerText(line)}
				</Text>
			))}
		</Box>
	);
};

/**
 * AsciiMotionCli - Now a static version of the Dirac logo.
 * Maintained for compatibility with existing views, but with all animation logic removed.
 */
export const AsciiMotionCli: React.FC<AsciiMotionCliProps> = ({ onReady, onInteraction }) => {
	useEffect(() => {
		if (onReady) {
			onReady({
				play: () => {},
				pause: () => {},
				restart: () => {},
			});
		}
	}, [onReady]);

	// Trigger onInteraction to allow dismissing the welcome state via any keypress
	useInput((input, key) => {
		if (onInteraction) {
			onInteraction(input, key);
		}
	});

	return <StaticRobotFrame />;
};
