import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import UtilityModelSelection from "./UtilityModelSelection"

const mockUpdateSetting = vi.fn()

vi.mock("@/features/settings/store/settingsStore", () => ({
	useSettingsStore: vi.fn(() => ({
		utilityModelEnabled: false,
		utilityModelSelection: undefined,
		modelProviderPresets: [
			{
				id: "openai:gpt-5-mini",
				provider: "openai",
				modelId: "gpt-5-mini",
				modelInfo: { supportsPromptCache: false },
				openAiProfileName: "utility-profile",
				lastUsedAt: 1,
			},
		],
	})),
}))

vi.mock("./utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

vi.mock("@shared/proto-conversions/models/api-configuration-conversion", () => ({
	convertModelProviderSelectionToProto: (selection: unknown) => selection,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children, ...props }: any) => (
		<label>
			<input type="checkbox" {...props} />
			{children}
		</label>
	),
}))

describe("UtilityModelSelection", () => {
	beforeEach(() => {
		mockUpdateSetting.mockClear()
	})
	it("requires enablement before selection", () => {
		render(<UtilityModelSelection />)

		const toggle = screen.getByRole("checkbox", { name: "Enable utility model" })
		expect(screen.getByLabelText("Utility model selection")).toBeDisabled()
		expect(screen.queryByText("Utility model is enabled but no provider/model is configured.")).not.toBeInTheDocument()

		fireEvent.click(toggle)
		expect(mockUpdateSetting).toHaveBeenCalledWith("utilityModelEnabled", true)
	})

	it("persists copied preset fields when enabled", () => {
		vi.mocked(useSettingsStore).mockReturnValue({
			utilityModelEnabled: true,
			utilityModelSelection: undefined,
			modelProviderPresets: [
				{
					id: "openai:gpt-5-mini",
					provider: "openai",
					modelId: "gpt-5-mini",
					modelInfo: { supportsPromptCache: false },
					openAiProfileName: "utility-profile",
					lastUsedAt: 1,
				},
			],
		} as any)
		render(<UtilityModelSelection />)

		expect(screen.getByText("Utility model is enabled but no provider/model is configured.")).toBeInTheDocument()
		fireEvent.change(screen.getByLabelText("Utility model selection"), {
			target: { value: "openai:gpt-5-mini" },
		})

		expect(mockUpdateSetting).toHaveBeenCalledWith(
			"utilityModelSelection",
			expect.objectContaining({
				provider: "openai",
				modelId: "gpt-5-mini",
				openAiProfileName: "utility-profile",
				modelInfo: { supportsPromptCache: false },
			}),
		)

		const selection = mockUpdateSetting.mock.calls.find(([key]) => key === "utilityModelSelection")?.[1]
		expect(selection).not.toHaveProperty("id")
		expect(selection).not.toHaveProperty("lastUsedAt")
	})

	it("keeps the utility selection independent when main-model presets are reordered", () => {
		const utilityPreset = {
			id: "openai:gpt-5-mini",
			provider: "openai" as const,
			modelId: "gpt-5-mini",
			modelInfo: { supportsPromptCache: false },
			openAiProfileName: "utility-profile",
			lastUsedAt: 1,
		}
		const mainModelPreset = {
			id: "anthropic:claude-sonnet",
			provider: "anthropic" as const,
			modelId: "claude-sonnet",
			modelInfo: { supportsPromptCache: true },
			lastUsedAt: 2,
		}
		vi.mocked(useSettingsStore).mockReturnValue({
			utilityModelEnabled: true,
			utilityModelSelection: {
				provider: utilityPreset.provider,
				modelId: utilityPreset.modelId,
				modelInfo: utilityPreset.modelInfo,
				openAiProfileName: utilityPreset.openAiProfileName,
			},
			modelProviderPresets: [utilityPreset, mainModelPreset],
		} as any)
		const { rerender } = render(<UtilityModelSelection />)
		const selector = screen.getByLabelText("Utility model selection")
		expect(selector).toHaveValue(utilityPreset.id)

		vi.mocked(useSettingsStore).mockReturnValue({
			utilityModelEnabled: true,
			utilityModelSelection: {
				provider: utilityPreset.provider,
				modelId: utilityPreset.modelId,
				modelInfo: utilityPreset.modelInfo,
				openAiProfileName: utilityPreset.openAiProfileName,
			},
			modelProviderPresets: [mainModelPreset, utilityPreset],
		} as any)
		rerender(<UtilityModelSelection />)

		expect(screen.getByLabelText("Utility model selection")).toHaveValue(utilityPreset.id)
		expect(mockUpdateSetting).not.toHaveBeenCalled()

		fireEvent.change(screen.getByLabelText("Utility model selection"), {
			target: { value: mainModelPreset.id },
		})
		expect(mockUpdateSetting).toHaveBeenCalledWith(
			"utilityModelSelection",
			expect.objectContaining({ provider: "anthropic", modelId: "claude-sonnet" }),
		)
	})
})
