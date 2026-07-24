import { describe, expect, it, vi } from "vitest"
import { openAiModelInfoSaneDefaults } from "@shared/api"
import type { Settings } from "@shared/storage/state-keys"
import type { DiracAcpSession } from "./public-types.js"
import { SessionConfigManager } from "./sessionConfig.js"

function session(mode: "act" | "plan" = "act"): DiracAcpSession {
	return {
		sessionId: "session-1",
		cwd: "/workspace",
		mode,
		createdAt: 1,
		lastActivityAt: 1,
	}
}

function linkedDeepSeekRuntime(): Partial<Settings> {
	return {
		mode: "act",
		planActSeparateModelsSetting: false,
		planModeApiProvider: "deepseek",
		actModeApiProvider: "deepseek",
		planModeApiModelId: "deepseek-v4-flash",
		actModeApiModelId: "deepseek-v4-flash",
		planModeReasoningEffort: "medium",
		actModeReasoningEffort: "medium",
		planModeThinkingBudgetTokens: 0,
		actModeThinkingBudgetTokens: 0,
	}
}

describe("SessionConfigManager task runtime behavior", () => {
	it("updates both modes only when the task snapshot links their models", async () => {
		const manager = new SessionConfigManager()
		const linked = linkedDeepSeekRuntime()
		await manager.applyModelConfigOption(session(), "deepseek-v4-pro", linked)
		expect(linked.actModeApiModelId).toBe("deepseek-v4-pro")
		expect(linked.planModeApiModelId).toBe("deepseek-v4-pro")

		const separate = { ...linkedDeepSeekRuntime(), planActSeparateModelsSetting: true }
		await manager.applyModelConfigOption(session(), "deepseek-v4-pro", separate)
		expect(separate.actModeApiModelId).toBe("deepseek-v4-pro")
		expect(separate.planModeApiModelId).toBe("deepseek-v4-flash")
	})

	it("clears stale model metadata when the selected model changes", async () => {
		const manager = new SessionConfigManager()
		const runtime: Partial<Settings> = {
			mode: "act",
			planActSeparateModelsSetting: false,
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
			planModeOpenAiModelId: "old-model",
			actModeOpenAiModelId: "old-model",
			planModeOpenAiModelInfo: openAiModelInfoSaneDefaults,
			actModeOpenAiModelInfo: openAiModelInfoSaneDefaults,
		}

		await manager.applyModelConfigOption(session(), "new-model", runtime)

		expect(runtime.planModeOpenAiModelId).toBe("new-model")
		expect(runtime.actModeOpenAiModelId).toBe("new-model")
		expect(runtime.planModeOpenAiModelInfo).toBeUndefined()
		expect(runtime.actModeOpenAiModelInfo).toBeUndefined()
	})

	it("reports an unavailable historical model without substituting it", async () => {
		const manager = new SessionConfigManager()
		const runtime = linkedDeepSeekRuntime()
		runtime.actModeApiModelId = "removed-deepseek-model"

		const options = await manager.getSessionConfigOptions(session(), runtime)
		const model = options.find((option) => option.id === "model")
		expect(model).toMatchObject({
			currentValue: "removed-deepseek-model",
			options: expect.arrayContaining([expect.objectContaining({ value: "removed-deepseek-model" })]),
		})
		expect(() => manager.assertTaskRuntimeAvailable(session(), runtime)).toThrow(
			"Model removed-deepseek-model is unavailable",
		)
	})

	it("keeps a disabled provider visible while rejecting work and model mutations", async () => {
		const providerConfiguration = {
			assertProviderEnabled: vi.fn(() => {
				throw new Error("Provider deepseek is disabled")
			}),
		}
		const manager = new SessionConfigManager(providerConfiguration as never)
		const runtime = linkedDeepSeekRuntime()

		const options = await manager.getSessionConfigOptions(session(), runtime)
		expect(options.find((option) => option.id === "provider")).toMatchObject({ currentValue: "deepseek" })
		expect(() => manager.assertTaskRuntimeAvailable(session(), runtime)).toThrow("Provider deepseek is disabled")
		await expect(manager.applyModelConfigOption(session(), "deepseek-v4-pro", runtime)).rejects.toThrow(
			"Provider deepseek is disabled",
		)
		expect(runtime.actModeApiModelId).toBe("deepseek-v4-flash")
	})

	it("uses standard ACP categories for task runtime controls", async () => {
		const options = await new SessionConfigManager().getSessionConfigOptions(session(), linkedDeepSeekRuntime())
		expect(options.map(({ id, category }) => [id, category])).toEqual([
			["mode", "mode"],
			["provider", "_provider"],
			["model", "model"],
			["reasoning_effort", "thought_level"],
			["thinking_budget", "thought_level"],
		])
	})
})
