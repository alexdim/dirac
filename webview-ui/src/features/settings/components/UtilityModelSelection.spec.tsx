import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import UtilityModelSelection from "./UtilityModelSelection"

const mockUpdateSetting = vi.fn()

vi.mock("@/features/settings/store/settingsStore", () => ({
	useSettingsStore: vi.fn(() => ({
		utilityModelSelection: undefined,
		utilityModelUseCondense: true,
		utilityModelUseNewTask: true,
		utilityModelUseGenerateCommitMessage: true,
		openRouterModels: {},
		openAiModels: {},
		liteLlmModels: {},
		requestyModels: {},
		groqModels: {},
		basetenModels: {},
		huggingFaceModels: {},
		vercelAiGatewayModels: {},
	})),
}))

vi.mock("./utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

vi.mock("./common/ModelAutocomplete", () => ({
	ModelAutocomplete: ({ onChange, selectedModelId }: any) => (
		<input
			aria-label="Model"
			value={selectedModelId || ""}
			onChange={(event) => onChange(event.target.value, { supportsPromptCache: false })}
		/>
	),
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

	it("shows each Utility use case enabled by default", () => {
		render(<UtilityModelSelection />)

		expect(screen.getByRole("checkbox", { name: "Condense conversation" })).toBeChecked()
		expect(screen.getByRole("checkbox", { name: "New task handoffs" })).toBeChecked()
		expect(screen.getByRole("checkbox", { name: "Generate commit messages" })).toBeChecked()
	})

	it("persists each use case independently", () => {
		render(<UtilityModelSelection />)

		fireEvent.click(screen.getByRole("checkbox", { name: "New task handoffs" }))
		expect(mockUpdateSetting).toHaveBeenCalledWith("utilityModelUseNewTask", false)
	})

	it("persists an arbitrary model ID for the selected provider", () => {
		render(<UtilityModelSelection />)

		fireEvent.change(screen.getByLabelText("Utility model provider"), { target: { value: "openai" } })
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "custom-utility-model" } })

		expect(mockUpdateSetting).toHaveBeenLastCalledWith(
			"utilityModelSelection",
			expect.objectContaining({ provider: "openai", modelId: "custom-utility-model" }),
		)
	})
})
