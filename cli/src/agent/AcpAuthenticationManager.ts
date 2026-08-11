import type * as acp from "@agentclientprotocol/sdk"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { openAiCodexUsageService } from "@/integrations/openai-codex/OpenAiCodexUsageService"
import { applyProviderConfig } from "../utils/provider-config.js"
import { openUrlInBrowser } from "../utils/browser.js"
import { AcpProviderSetup } from "./AcpProviderSetup.js"

export const DIRAC_PROVIDER_SETUP_AUTH_METHOD_ID = "dirac-provider-setup"
export const DIRAC_TERMINAL_SETUP_AUTH_METHOD_ID = "dirac-terminal-setup"
export const DIRAC_ENV_AUTH_METHOD_ID = "dirac-env"
export const OPENAI_CODEX_AUTH_METHOD_ID = "openai-codex-oauth"

type AuthenticationOptions = {
	diracDir?: string
	cwd?: string
}

function terminalSetupArgs(options: AuthenticationOptions): string[] {
	return [
		"--acp-auth",
		...(options.diracDir ? ["--config", options.diracDir] : []),
		...(options.cwd ? ["--cwd", options.cwd] : []),
	]
}

function supportsLegacyTerminalAuth(capabilities?: acp.ClientCapabilities): boolean {
	return capabilities?._meta?.["terminal-auth"] === true
}

export class AcpAuthenticationManager {
	private readonly providerSetup = new AcpProviderSetup()

	constructor(private readonly options: AuthenticationOptions) {}

	listAuthenticationMethods(configured: boolean, capabilities?: acp.ClientCapabilities): acp.AuthMethod[] {
		if (configured) return []

		const args = terminalSetupArgs(this.options)
		const providerSetup: acp.AuthMethod = {
			id: DIRAC_PROVIDER_SETUP_AUTH_METHOD_ID,
			name: "Configure a Dirac provider",
			description: "Choose a provider, model, and API key in your browser",
			...(supportsLegacyTerminalAuth(capabilities) && process.argv[1]
				? {
						_meta: {
							"terminal-auth": {
								command: process.execPath,
								args: [process.argv[1], ...args],
								label: "Configure Dirac",
							},
						},
					}
				: {}),
		}
		const methods: acp.AuthMethod[] = [
			providerSetup,
			{
				id: OPENAI_CODEX_AUTH_METHOD_ID,
				name: "Sign in with ChatGPT",
				description: "Authenticate with your ChatGPT Plus/Pro/Team subscription",
			},
			{
				type: "env_var",
				id: DIRAC_ENV_AUTH_METHOD_ID,
				name: "Configure with environment variables",
				description: "Provide a Dirac provider, model, and optional API credentials",
				vars: [
					{ name: "DIRAC_PROVIDER", label: "Provider ID", secret: false },
					{ name: "DIRAC_MODEL", label: "Model ID", secret: false },
					{ name: "DIRAC_API_KEY", label: "API key", optional: true },
					{ name: "DIRAC_BASE_URL", label: "Base URL", secret: false, optional: true },
				],
			},
		]

		if (capabilities?.auth?.terminal === true) {
			methods.push({
				type: "terminal",
				id: DIRAC_TERMINAL_SETUP_AUTH_METHOD_ID,
				name: "Configure Dirac in a terminal",
				description: "Run Dirac's interactive provider setup",
				args,
			})
		}
		return methods
	}

	async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
		if (params.methodId === DIRAC_PROVIDER_SETUP_AUTH_METHOD_ID) {
			await this.providerSetup.authenticate()
			return {}
		}
		if (params.methodId === OPENAI_CODEX_AUTH_METHOD_ID) {
			const authorizationUrl = openAiCodexOAuthManager.startAuthorizationFlow()
			await openUrlInBrowser(authorizationUrl)
			await openAiCodexOAuthManager.waitForCallback()
			await applyProviderConfig({ providerId: "openai-codex" })
			openAiCodexUsageService.clear()
			return {}
		}
		throw new Error(`Unsupported authentication method: ${params.methodId}`)
	}

	async logout(): Promise<void> {
		this.providerSetup.cancel()
		openAiCodexOAuthManager.cancelAuthorizationFlow()
		await openAiCodexOAuthManager.clearCredentials()
		openAiCodexUsageService.clear()
	}

	shutdown(): void {
		this.providerSetup.cancel()
		openAiCodexOAuthManager.cancelAuthorizationFlow()
	}
}
