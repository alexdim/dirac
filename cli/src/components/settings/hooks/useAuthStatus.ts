import { useEffect, useState } from "react"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { githubCopilotAuthManager } from "@/integrations/github-copilot/auth"

export function useAuthStatus(provider: string, isWaitingForCodexAuth: boolean, isWaitingForGithubAuth: boolean) {
	const [openAiCodexIsAuthenticated, setOpenAiCodexIsAuthenticated] = useState(false)
	const [openAiCodexEmail, setOpenAiCodexEmail] = useState<string | undefined>(undefined)
	const [githubIsAuthenticated, setGithubIsAuthenticated] = useState(false)
	const [githubEmail, setGithubEmail] = useState<string | undefined>(undefined)

	useEffect(() => {
		const updateAuthStatus = async () => {
			const isAuthenticated = await openAiCodexOAuthManager.isAuthenticated()
			setOpenAiCodexIsAuthenticated(isAuthenticated)
			if (isAuthenticated) {
				const email = await openAiCodexOAuthManager.getEmail()
				setOpenAiCodexEmail(email ?? undefined)
			} else {
				setOpenAiCodexEmail(undefined)
			}
		}

		const updateGithubAuthStatus = async () => {
			const isAuthenticated = await githubCopilotAuthManager.isAuthenticated()
			setGithubIsAuthenticated(isAuthenticated)
			if (isAuthenticated) {
				const email = await githubCopilotAuthManager.getEmail()
				setGithubEmail(email ?? undefined)
			} else {
				setGithubEmail(undefined)
			}
		}

		updateAuthStatus()
		updateGithubAuthStatus()
	}, [provider, isWaitingForCodexAuth, isWaitingForGithubAuth])

	return {
		openAiCodexIsAuthenticated,
		openAiCodexEmail,
		githubIsAuthenticated,
		githubEmail,
		setOpenAiCodexIsAuthenticated,
		setOpenAiCodexEmail,
		setGithubIsAuthenticated,
		setGithubEmail,
	}
}
