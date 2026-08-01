import type { UserApprovedCommand } from "@shared/UserApprovedCommand"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import UserApprovedCommandsSection from "./UserApprovedCommandsSection"

const { mockPersistSetting, settingsState } = vi.hoisted(() => ({
	mockPersistSetting: vi.fn(),
	settingsState: { userApprovedCommands: [] as UserApprovedCommand[] },
}))

vi.mock("@/features/settings/store/settingsStore", () => {
	const useSettingsStore = (selector: (state: typeof settingsState) => unknown) => selector(settingsState)
	useSettingsStore.getState = () => ({
		setSettings: ({ userApprovedCommands }: { userApprovedCommands: UserApprovedCommand[] }) => {
			settingsState.userApprovedCommands = userApprovedCommands
		},
	})
	return { useSettingsStore }
})

vi.mock("../utils/settingsHandlers", () => ({
	persistSetting: (...args: unknown[]) => mockPersistSetting(...args),
}))

vi.mock("@vscode/webview-ui-toolkit/react", async () => {
	const React = await import("react")
	return {
		VSCodeButton: React.forwardRef<
			HTMLButtonElement,
			React.ButtonHTMLAttributes<HTMLButtonElement> & { appearance?: string }
		>(({ appearance: _appearance, children, ...props }, ref) => (
			<button ref={ref} {...props}>
				{children}
			</button>
		)),
		VSCodeTextField: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
			({ children: _children, ...props }, ref) => <input ref={ref} {...props} />,
		),
	}
})

function renderSection() {
	return render(<UserApprovedCommandsSection renderSectionHeader={() => null} />)
}

describe("UserApprovedCommandsSection", () => {
	beforeEach(() => {
		settingsState.userApprovedCommands = []
		mockPersistSetting.mockReset().mockResolvedValue(undefined)
	})

	it("defaults to approving the exact command only", async () => {
		renderSection()

		fireEvent.input(screen.getByRole("textbox", { name: "Command" }), { target: { value: "npm test" } })
		expect(screen.getByRole("radio", { name: /Exact command only/ })).toBeChecked()
		fireEvent.click(screen.getByRole("button", { name: "Add command" }))

		await waitFor(() =>
			expect(mockPersistSetting).toHaveBeenCalledWith("userApprovedCommands", {
				commands: [{ command: "npm test", match: "exact" }],
			}),
		)
	})

	it("approves additional arguments through one explicit choice", async () => {
		renderSection()

		fireEvent.input(screen.getByRole("textbox", { name: "Command" }), { target: { value: "npm test" } })
		fireEvent.click(screen.getByRole("radio", { name: /Command with any arguments/ }))
		expect(screen.getByText("Choose this only when you trust this command with every possible argument.")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Add command" }))

		await waitFor(() =>
			expect(mockPersistSetting).toHaveBeenCalledWith("userApprovedCommands", {
				commands: [{ command: "npm test", match: "prefix" }],
			}),
		)
	})

	it("shows and updates the scope of an existing command", async () => {
		settingsState.userApprovedCommands = [{ command: "npm test", match: "prefix" }]
		renderSection()

		fireEvent.click(screen.getByRole("button", { name: "Edit" }))
		const scope = screen.getByRole("group", { name: "Approval scope" })
		expect(within(scope).getByRole("radio", { name: /Command with any arguments/ })).toBeChecked()
		fireEvent.click(within(scope).getByRole("radio", { name: /Exact command only/ }))
		fireEvent.click(screen.getByRole("button", { name: "Save command" }))

		await waitFor(() =>
			expect(mockPersistSetting).toHaveBeenCalledWith("userApprovedCommands", {
				commands: [{ command: "npm test", match: "exact" }],
			}),
		)
	})
})
