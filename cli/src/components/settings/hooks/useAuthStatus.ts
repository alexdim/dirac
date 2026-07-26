import { useEffect, useState } from "react"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { githubCopilotAuthManager } from "@/integrations/github-copilot/auth"
import { Logger } from "@/shared/services/Logger"

export function useAuthStatus(provider: string, isWaitingForCodexAuth: boolean, isWaitingForGithubAuth: boolean) {
	const [openAiCodexIsAuthenticated, setOpenAiCodexIsAuthenticated] = useState(false)
	const [openAiCodexEmail, setOpenAiCodexEmail] = useState<string | undefined>(undefined)
	const [githubIsAuthenticated, setGithubIsAuthenticated] = useState(false)
	const [githubEmail, setGithubEmail] = useState<string | undefined>(undefined)
	const [authStatusError, setAuthStatusError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		const updateAuthStatuses = async () => {
			try {
				const [codexAuthenticated, githubAuthenticated] = await Promise.all([
					openAiCodexOAuthManager.isAuthenticated(),
					githubCopilotAuthManager.isAuthenticated(),
				])
				const [codexEmail, githubEmail] = await Promise.all([
					codexAuthenticated ? openAiCodexOAuthManager.getEmail() : null,
					githubAuthenticated ? githubCopilotAuthManager.getEmail() : null,
				])
				if (cancelled) return
				setOpenAiCodexIsAuthenticated(codexAuthenticated)
				setOpenAiCodexEmail(codexEmail ?? undefined)
				setGithubIsAuthenticated(githubAuthenticated)
				setGithubEmail(githubEmail ?? undefined)
				setAuthStatusError(null)
			} catch (error) {
				Logger.error("Failed to read authentication status:", error)
				if (!cancelled) setAuthStatusError(error instanceof Error ? error.message : String(error))
			}
		}

		updateAuthStatuses()
		return () => {
			cancelled = true
		}
	}, [provider, isWaitingForCodexAuth, isWaitingForGithubAuth])

	return {
		openAiCodexIsAuthenticated,
		openAiCodexEmail,
		githubIsAuthenticated,
		githubEmail,
		authStatusError,
		setOpenAiCodexIsAuthenticated,
		setOpenAiCodexEmail,
		setGithubIsAuthenticated,
		setGithubEmail,
	}
}
