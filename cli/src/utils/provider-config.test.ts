import { beforeEach, describe, expect, it, vi } from "vitest"

const stateManager = {
	getGlobalSettingsKey: vi.fn(),
	getApiConfiguration: vi.fn(),
	setApiConfiguration: vi.fn(),
	flushPendingState: vi.fn(),
}

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: vi.fn(() => stateManager) },
}))

vi.mock("@shared/storage", () => ({
	getProviderModelIdKey: (_provider: string, mode: "act" | "plan") =>
		mode === "act" ? "actModeOpenRouterModelId" : "planModeOpenRouterModelId",
	ProviderToApiKeyMap: { openrouter: "openRouterApiKey" },
	ProviderToBaseUrlKeyMap: {},
}))

vi.mock("@/core/controller/models/apiConfigurationTransaction", () => ({
	buildCandidateApiHandler: vi.fn(),
}))

vi.mock("@/core/controller/models/refreshOpenRouterModels", () => ({
	refreshOpenRouterModels: vi.fn(),
}))

vi.mock("@/core/controller/models/refreshVercelAiGatewayModels", () => ({
	refreshVercelAiGatewayModels: vi.fn(),
}))

vi.mock("./model-metadata", () => ({
	getDefaultModelId: vi.fn(() => ""),
	getModelList: vi.fn(() => []),
}))

const { applyProviderConfig } = await import("./provider-config")

describe("applyProviderConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		stateManager.getGlobalSettingsKey.mockReturnValue(undefined)
		stateManager.getApiConfiguration.mockReturnValue({})
	})

	it("rejects OpenRouter without an explicit or saved model", async () => {
		await expect(applyProviderConfig({ providerId: "openrouter" })).rejects.toThrow(
			"Select an OpenRouter model before configuring the provider",
		)
		expect(stateManager.setApiConfiguration).not.toHaveBeenCalled()
	})
})
