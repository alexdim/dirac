import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAppStore } from "@/app/store/appStore"
import { TaskServiceClient } from "@/shared/api/grpc-client"
import { Navbar } from "./Navbar"

const resetRoutes = () =>
	useAppStore.setState({
		showSettings: false,
		settingsTargetSection: undefined,
		showHistory: false,
		showAccount: false,
		showWorktrees: false,
	})

describe("Navbar navigation", () => {
	beforeEach(resetRoutes)

	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	it("opens History and Settings through the app store", async () => {
		const user = userEvent.setup()
		render(<Navbar />)

		await user.click(screen.getByRole("button", { name: "History" }))
		expect(useAppStore.getState().showHistory).toBe(true)

		await user.click(screen.getByRole("button", { name: "Settings" }))
		expect(useAppStore.getState().showSettings).toBe(true)
		expect(useAppStore.getState().showHistory).toBe(false)
	})

	it("clears the current task once and returns to Chat", async () => {
		const clearTask = vi.spyOn(TaskServiceClient, "clearTask").mockResolvedValue({})
		useAppStore.setState({ showSettings: true })
		const user = userEvent.setup()
		render(<Navbar />)

		await user.click(screen.getByRole("button", { name: "New Task" }))

		await waitFor(() => expect(useAppStore.getState().showSettings).toBe(false))
		expect(clearTask).toHaveBeenCalledOnce()
	})

	it("still returns to Chat when clearing the task fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(TaskServiceClient, "clearTask").mockRejectedValue(new Error("clear failed"))
		useAppStore.setState({ showHistory: true })
		const user = userEvent.setup()
		render(<Navbar />)

		await user.click(screen.getByRole("button", { name: "New Task" }))

		await waitFor(() => expect(useAppStore.getState().showHistory).toBe(false))
	})
})
