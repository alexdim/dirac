import { describe, expect, it, vi } from "vitest"
import { executeLocalSlashCommand, type LocalSlashCommandContext } from "./slash-commands"

function localCommandContext(): LocalSlashCommandContext {
	return {
		mode: "act",
		setActivePanel: vi.fn(),
		resetInputLine: vi.fn(),
		clearViewAndResetTask: vi.fn(),
		handleExit: vi.fn(),
		toggleQuietMode: vi.fn(),
	}
}

describe("executeLocalSlashCommand", () => {
	it("toggles quiet mode and clears the input for /quiet", () => {
		const context = localCommandContext()

		expect(executeLocalSlashCommand("quiet", context)).toBe(true)
		expect(context.toggleQuietMode).toHaveBeenCalledOnce()
		expect(context.resetInputLine).toHaveBeenCalledOnce()
	})

	it("opens the ChatGPT usage panel for /usage", () => {
		const context = localCommandContext()

		expect(executeLocalSlashCommand("usage", context)).toBe(true)
		expect(context.setActivePanel).toHaveBeenCalledWith({ type: "usage" })
		expect(context.resetInputLine).toHaveBeenCalledOnce()
	})
})
