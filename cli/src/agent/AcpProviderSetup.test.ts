import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	configureApiKeyProvider: vi.fn(),
	openUrlInBrowser: vi.fn(),
}))

vi.mock("../utils/provider-config.js", () => ({ configureApiKeyProvider: mocks.configureApiKeyProvider }))
vi.mock("../utils/browser.js", () => ({ openUrlInBrowser: mocks.openUrlInBrowser }))

import { AcpProviderSetup } from "./AcpProviderSetup.js"

describe("AcpProviderSetup", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.configureApiKeyProvider.mockResolvedValue(undefined)
		mocks.openUrlInBrowser.mockResolvedValue(undefined)
	})

	it("persists browser-submitted provider configuration", async () => {
		const setup = new AcpProviderSetup()
		const authentication = setup.authenticate()
		await vi.waitFor(() => expect(mocks.openUrlInBrowser).toHaveBeenCalledOnce())

		const setupUrl = new URL(mocks.openUrlInBrowser.mock.calls[0][0])
		const nonce = setupUrl.pathname.split("/").at(-1)!
		const response = await fetch(setupUrl, {
			method: "POST",
			body: new URLSearchParams({
				nonce,
				provider: "deepseek",
				apiKey: "secret-key",
				modelId: "deepseek-chat",
			}),
		})

		expect(response.status).toBe(200)
		await expect(authentication).resolves.toBeUndefined()
		expect(mocks.configureApiKeyProvider).toHaveBeenCalledWith({
			provider: "deepseek",
			apiKey: "secret-key",
			modelId: "deepseek-chat",
			baseUrl: undefined,
			azureApiVersion: undefined,
		})
	})
})
