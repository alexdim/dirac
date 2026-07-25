import { fireEvent, render, screen, within } from "@testing-library/react"
import { OpenRouterEndpoint } from "@shared/proto/dirac/models"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { OpenRouterProviderSelector } from "./OpenRouterRoutingControls"

const { handleFieldChange } = vi.hoisted(() => ({
	handleFieldChange: vi.fn(),
}))

vi.mock("./utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({ handleFieldChange }),
}))

vi.mock("@vscode/webview-ui-toolkit/react", async () => {
	const React = await import("react")
	return {
		VSCodeButton: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
			({ children, ...props }, ref) => (
				<button ref={ref} {...props}>
					{children}
				</button>
			),
		),
		VSCodeCheckbox: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
			({ children, ...props }, ref) => (
				<label>
					<input ref={ref} type="checkbox" {...props} />
					{children}
				</label>
			),
		),
		VSCodeDropdown: React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
			({ children, ...props }, ref) => (
				<select ref={ref} {...props}>
					{children}
				</select>
			),
		),
		VSCodeOption: (props: React.OptionHTMLAttributes<HTMLOptionElement>) => <option {...props} />,
		VSCodeTextField: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
			({ children: _children, ...props }, ref) => <input ref={ref} {...props} />,
		),
	}
})

const modelId = "qwen/qwen3-coder"
const endpoints = [
	OpenRouterEndpoint.create({
		providerName: "DeepInfra",
		tag: "deepinfra/turbo",
		quantization: "bf16",
		status: 0,
		uptimeLast30m: 99.9,
		throughputLast30m: 120.4,
	}),
	OpenRouterEndpoint.create({
		providerName: "Novita",
		tag: "novita/fp8",
		quantization: "fp8",
		status: 0,
		uptimeLast30m: 100,
		latencyLast30m: 0.42,
	}),
]

function setSelectorState({
	pins,
	model = modelId,
	status = "fresh",
	availableEndpoints = endpoints,
}: {
	pins?: Record<string, string[]>
	model?: string
	status?: "loading" | "fresh" | "stale" | "unavailable"
	availableEndpoints?: OpenRouterEndpoint[]
} = {}) {
	useSettingsStore.setState({
		apiConfiguration: { openRouterPinnedProviders: pins },
		pendingApiConfigurationUpdates: {},
		openRouterEndpointStates: {
			[model]: { status, endpoints: availableEndpoints },
		},
		fetchOpenRouterEndpoints: vi.fn().mockResolvedValue(undefined),
	})
}

describe("OpenRouterProviderSelector", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setSelectorState()
		handleFieldChange.mockImplementation((_field, value) => {
			useSettingsStore.setState((state) => ({
				apiConfiguration: { ...state.apiConfiguration, openRouterPinnedProviders: value },
			}))
			return Promise.resolve(true)
		})
	})

	it("searches all endpoint details and adds the first match with Enter", () => {
		render(<OpenRouterProviderSelector modelId={modelId} />)

		const search = screen.getByRole("combobox", { name: "Allowed upstream providers" })
		fireEvent.focus(search)
		fireEvent.input(search, { target: { value: "fp8" } })

		expect(screen.getByText("Novita")).toBeInTheDocument()
		expect(screen.queryByText("DeepInfra")).not.toBeInTheDocument()
		fireEvent.keyDown(search, { key: "Enter" })

		expect(handleFieldChange).toHaveBeenCalledWith("openRouterPinnedProviders", {
			[modelId]: ["novita/fp8"],
		})
		expect(screen.getByText("novita/fp8")).toBeInTheDocument()
	})

	it("adds one provider at a time by clicking an autocomplete result", () => {
		render(<OpenRouterProviderSelector modelId={modelId} />)

		fireEvent.focus(screen.getByRole("combobox", { name: "Allowed upstream providers" }))
		fireEvent.click(screen.getByText("DeepInfra"))

		expect(handleFieldChange).toHaveBeenCalledTimes(1)
		expect(handleFieldChange).toHaveBeenCalledWith("openRouterPinnedProviders", {
			[modelId]: ["deepinfra/turbo"],
		})
	})

	it("surfaces saved pins immediately and removes only the selected pin", () => {
		setSelectorState({
			pins: { [modelId]: ["deepinfra/turbo", "novita/fp8"] },
			status: "loading",
			availableEndpoints: [],
		})
		render(<OpenRouterProviderSelector modelId={modelId} />)

		expect(screen.getByText("deepinfra/turbo")).toBeInTheDocument()
		expect(screen.getByText("novita/fp8")).toBeInTheDocument()
		expect(screen.queryByText("Unavailable")).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: "Remove deepinfra/turbo" }))

		expect(handleFieldChange).toHaveBeenCalledWith("openRouterPinnedProviders", {
			[modelId]: ["novita/fp8"],
		})
	})

	it("uses the selected model's saved pins and treats a missing entry as no preference", () => {
		const secondModelId = "moonshotai/kimi-k2"
		setSelectorState({
			pins: {
				[modelId]: ["deepinfra/turbo"],
				[secondModelId]: ["novita/fp8"],
			},
		})
		const { rerender } = render(<OpenRouterProviderSelector modelId={modelId} />)
		expect(screen.getByText("deepinfra/turbo")).toBeInTheDocument()

		useSettingsStore.setState((state) => ({
			openRouterEndpointStates: {
				...state.openRouterEndpointStates,
				[secondModelId]: { status: "fresh", endpoints },
			},
		}))
		rerender(<OpenRouterProviderSelector modelId={secondModelId} />)
		expect(screen.getByText("novita/fp8")).toBeInTheDocument()
		expect(screen.queryByText("deepinfra/turbo")).not.toBeInTheDocument()

		const unconfiguredModelId = "custom/model"
		useSettingsStore.setState((state) => ({
			openRouterEndpointStates: {
				...state.openRouterEndpointStates,
				[unconfiguredModelId]: { status: "fresh", endpoints },
			},
		}))
		rerender(<OpenRouterProviderSelector modelId={unconfiguredModelId} />)
		expect(screen.queryByText("1 allowed")).not.toBeInTheDocument()
		expect(within(screen.getByRole("combobox", { name: "Allowed upstream providers" })).queryByText(/.+/)).toBeNull()
	})

	it("keeps a saved tag visible and removable when fresh metadata no longer contains it", () => {
		setSelectorState({ pins: { [modelId]: ["retired/fp8"] } })
		render(<OpenRouterProviderSelector modelId={modelId} />)

		expect(screen.getByText("retired/fp8")).toBeInTheDocument()
		expect(screen.getByText("Unavailable")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Remove retired/fp8" }))

		expect(handleFieldChange).toHaveBeenCalledWith("openRouterPinnedProviders", undefined)
	})
})
