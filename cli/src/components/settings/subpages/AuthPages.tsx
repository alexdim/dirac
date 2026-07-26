import { theme } from "../../../constants/theme"
import React from "react"
import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import { COLORS } from "../../../constants/colors"
import { terminalLink } from "../../../utils/clipboard"

interface CodexAuthPageProps {
	codexAuthUrl: string | null
	copied: boolean
}

export const CodexAuthPage: React.FC<CodexAuthPageProps> = ({ codexAuthUrl, copied }) => (
	<Box flexDirection="column">
		<Box>
			<Text color={COLORS.primaryBlue}>
				<Spinner type="dots" />
			</Text>
			<Text color={theme.text}> Waiting for ChatGPT sign-in...</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>Sign in with your ChatGPT account in the browser.</Text>
		</Box>
		{codexAuthUrl && (
			<Box flexDirection="column" marginTop={1}>
				<Text bold color={theme.info}>
					{terminalLink("👉 Sign in to ChatGPT", codexAuthUrl)}
				</Text>
				<Box marginTop={1}>
					{copied ? (
						<Text color={theme.success}>✔ Copied to clipboard!</Text>
					) : (
						<Text color={theme.muted}>(press 'c' to copy URL)</Text>
					)}
				</Box>
				<Box marginTop={1}>
					<Text color={theme.warning}>Note: If you are on a remote machine, you may need to set up SSH port forwarding:</Text>
				</Box>
				<Text color={theme.muted}>ssh -L 1455:localhost:1455 your-remote-host</Text>
			</Box>
		)}
		<Box marginTop={1}>
			<Text color={theme.muted}>Requires ChatGPT Plus, Pro, or Team subscription.</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>Esc to cancel</Text>
		</Box>
	</Box>
)

interface GithubAuthPageProps {
	githubAuthData: {
		verification_uri: string
		user_code: string
	}
}

export const GithubAuthPage: React.FC<GithubAuthPageProps> = ({ githubAuthData }) => (
	<Box flexDirection="column">
		<Box>
			<Text color={COLORS.primaryBlue}>
				<Spinner type="dots" />
			</Text>
			<Text color={theme.text}> Waiting for GitHub authorization...</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.text}>1. Open: </Text>
			<Text color={theme.info} bold underline>
				{githubAuthData.verification_uri}
			</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.text}>2. Enter code: </Text>
			<Text color={theme.warning} bold>
				{githubAuthData.user_code}
			</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>The browser should have opened automatically.</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>Esc to cancel</Text>
		</Box>
	</Box>
)

interface AuthErrorPageProps {
	error: string
}

export const AuthErrorPage: React.FC<AuthErrorPageProps> = ({ error }) => (
	<Box flexDirection="column">
		<Text bold color={theme.error}>
			ChatGPT sign-in failed
		</Text>
		<Box marginTop={1}>
			<Text color={theme.warning}>{error}</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>Press any key to continue</Text>
		</Box>
	</Box>
)
