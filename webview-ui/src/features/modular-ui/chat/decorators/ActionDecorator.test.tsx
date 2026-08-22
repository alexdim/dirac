import { fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import type { ModularInputContext } from "../types"
import { createActionDecorator } from "./ActionDecorator"

vi.mock("@/features/dirac-rules/components/DiracRulesToggleModal", () => ({
	default: () => null,
}))

const inputContext: ModularInputContext = {
	inputValue: "",
	setInputValue: vi.fn(),
	cursorPosition: 0,
	setCursorPosition: vi.fn(),
	isFocused: false,
	setIsFocused: vi.fn(),
	textAreaRef: createRef<HTMLTextAreaElement>(),
	selectedFiles: [],
	setSelectedFiles: vi.fn(),
	selectedImages: [],
	setSelectedImages: vi.fn(),
}

function renderActions({
	fastModeSupported = true,
	fastModeEnabled = false,
	isUpdatingFastMode = false,
	onFastModeToggle = vi.fn().mockResolvedValue(undefined),
} = {}) {
	const decorator = createActionDecorator({
		onModeToggle: vi.fn(),
		mode: "act",
		modelDisplayName: "anthropic:Claude Opus",
		fastModeSupported,
		fastModeEnabled,
		isUpdatingFastMode,
		onFastModeToggle,
		onModelButtonClick: vi.fn(),
		modelProviderPresets: [],
		onModelProviderPresetSelect: vi.fn().mockResolvedValue(undefined),
		isActivatingModelPreset: false,
		supportsReasoningEffort: false,
		reasoningEffort: "medium",
		reasoningEffortOptions: [],
		onReasoningEffortSelect: vi.fn().mockResolvedValue(undefined),
		isUpdatingReasoningEffort: false,
	})

	render(<>{decorator.renderAction?.(inputContext)}</>)
	return { onFastModeToggle }
}

describe("ActionDecorator Fast Mode toggle", () => {
	it("stays visible and muted when Fast Mode is supported but disabled", () => {
		renderActions()

		const toggle = screen.getByRole("button", { name: "Enable Fast Mode" })
		expect(toggle).toHaveAttribute("aria-pressed", "false")
		expect(toggle).toHaveClass("opacity-50")
	})

	it("shows the active state and disables Fast Mode when clicked", () => {
		const onFastModeToggle = vi.fn().mockResolvedValue(undefined)
		renderActions({ fastModeEnabled: true, onFastModeToggle })

		const toggle = screen.getByRole("button", { name: "Disable Fast Mode" })
		expect(toggle).toHaveAttribute("aria-pressed", "true")
		fireEvent.click(toggle)
		expect(onFastModeToggle).toHaveBeenCalledOnce()
	})

	it("hides the toggle for models without Fast Mode", () => {
		renderActions({ fastModeSupported: false })
		expect(screen.queryByTestId("fast-mode-toggle")).not.toBeInTheDocument()
	})

	it("disables the toggle while the setting is being persisted", () => {
		renderActions({ isUpdatingFastMode: true })
		expect(screen.getByRole("button", { name: "Enable Fast Mode" })).toBeDisabled()
	})
})
