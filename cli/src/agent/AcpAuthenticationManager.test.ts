import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	checkAnyProviderConfigured: vi.fn(),
	providerAuthenticate: vi.fn(),
	providerCancel: vi.fn(),
	startAuthorizationFlow: vi.fn(),
	waitForCallback: vi.fn(),
	cancelAuthorizationFlow: vi.fn(),
	clearCredentials: vi.fn(),
	clearUsage: vi.fn(),
	openUrlInBrowser: vi.fn(),
}))

vi.mock("../utils/auth.js", () => ({ checkAnyProviderConfigured: mocks.checkAnyProviderConfigured }))
vi.mock("./AcpProviderSetup.js", () => ({
	AcpProviderSetup: class {
		authenticate = mocks.providerAuthenticate
		cancel = mocks.providerCancel
	},
}))
vi.mock("@/integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		startAuthorizationFlow: mocks.startAuthorizationFlow,
		waitForCallback: mocks.waitForCallback,
		cancelAuthorizationFlow: mocks.cancelAuthorizationFlow,
		clearCredentials: mocks.clearCredentials,
	},
}))
vi.mock("@/integrations/openai-codex/OpenAiCodexUsageService", () => ({
	openAiCodexUsageService: { clear: mocks.clearUsage },
}))
vi.mock("../utils/browser.js", () => ({ openUrlInBrowser: mocks.openUrlInBrowser }))

import {
	AcpAuthenticationManager,
	DIRAC_ENV_AUTH_METHOD_ID,
	DIRAC_PROVIDER_SETUP_AUTH_METHOD_ID,
	DIRAC_TERMINAL_SETUP_AUTH_METHOD_ID,
	OPENAI_CODEX_AUTH_METHOD_ID,
} from "./AcpAuthenticationManager.js"

describe("AcpAuthenticationManager", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.checkAnyProviderConfigured.mockResolvedValue(false)
		mocks.providerAuthenticate.mockResolvedValue(undefined)
		mocks.startAuthorizationFlow.mockReturnValue("https://auth.openai.test")
		mocks.waitForCallback.mockResolvedValue(undefined)
		mocks.openUrlInBrowser.mockResolvedValue(undefined)
		mocks.clearCredentials.mockResolvedValue(undefined)
	})

	it("does not request authentication when Dirac is already configured", async () => {
		mocks.checkAnyProviderConfigured.mockResolvedValue(true)
		const manager = new AcpAuthenticationManager({})
		expect(await manager.listAuthenticationMethods({ auth: { terminal: true } })).toEqual([])
	})

	it("advertises portable provider, OAuth, and environment setup to baseline clients", async () => {
		const manager = new AcpAuthenticationManager({})
		const methods = await manager.listAuthenticationMethods()
		expect(methods.map((method) => method.id)).toEqual([
			DIRAC_PROVIDER_SETUP_AUTH_METHOD_ID,
			OPENAI_CODEX_AUTH_METHOD_ID,
			DIRAC_ENV_AUTH_METHOD_ID,
		])
		expect(methods.find((method) => method.id === DIRAC_ENV_AUTH_METHOD_ID)).toMatchObject({
			type: "env_var",
			vars: expect.arrayContaining([expect.objectContaining({ name: "DIRAC_PROVIDER" })]),
		})
	})

	it("advertises terminal setup only when the client opts in", async () => {
		const manager = new AcpAuthenticationManager({ diracDir: "/config", cwd: "/workspace" })
		const methods = await manager.listAuthenticationMethods({ auth: { terminal: true } })
		expect(methods.find((method) => method.id === DIRAC_TERMINAL_SETUP_AUTH_METHOD_ID)).toEqual({
			type: "terminal",
			id: DIRAC_TERMINAL_SETUP_AUTH_METHOD_ID,
			name: "Configure Dirac in a terminal",
			description: "Run Dirac's interactive provider setup",
			args: ["--acp-auth", "--config", "/config", "--cwd", "/workspace"],
		})
	})

	it("dispatches provider setup and ChatGPT OAuth independently", async () => {
		const manager = new AcpAuthenticationManager({})
		await expect(manager.authenticate({ methodId: DIRAC_PROVIDER_SETUP_AUTH_METHOD_ID })).resolves.toEqual({})
		expect(mocks.providerAuthenticate).toHaveBeenCalledOnce()

		await expect(manager.authenticate({ methodId: OPENAI_CODEX_AUTH_METHOD_ID })).resolves.toEqual({})
		expect(mocks.openUrlInBrowser).toHaveBeenCalledWith("https://auth.openai.test")
		expect(mocks.waitForCallback).toHaveBeenCalledOnce()
	})

	it("rejects methods that require client-side execution", async () => {
		const manager = new AcpAuthenticationManager({})
		await expect(manager.authenticate({ methodId: DIRAC_ENV_AUTH_METHOD_ID })).rejects.toThrow(
			`Unsupported authentication method: ${DIRAC_ENV_AUTH_METHOD_ID}`,
		)
	})
})
