import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveTerminalColorMode, shouldUseAnsiColors, TerminalColorMode } from "./theme"

describe("terminal color mode", () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("keeps dark mode as the fallback", () => {
		expect(resolveTerminalColorMode({})).toBe(TerminalColorMode.DARK)
	})

	it("honors an explicit mode", () => {
		expect(resolveTerminalColorMode({ DIRAC_COLOR_MODE: "light", COLORFGBG: "15;0" })).toBe(
			TerminalColorMode.LIGHT,
		)
		expect(resolveTerminalColorMode({ DIRAC_COLOR_MODE: "dark", COLORFGBG: "0;15" })).toBe(
			TerminalColorMode.DARK,
		)
	})

	it("uses the persisted preference unless the environment overrides it", () => {
		expect(resolveTerminalColorMode({}, TerminalColorMode.LIGHT)).toBe(TerminalColorMode.LIGHT)
		expect(resolveTerminalColorMode({ DIRAC_COLOR_MODE: "dark" }, TerminalColorMode.LIGHT)).toBe(
			TerminalColorMode.DARK,
		)
		expect(resolveTerminalColorMode({ DIRAC_COLOR_MODE: "auto", COLORFGBG: "0;15" }, TerminalColorMode.DARK)).toBe(
			TerminalColorMode.LIGHT,
		)
	})

	it("reconfigures the exported palette after persisted settings load", async () => {
		vi.resetModules()
		const activeTheme = await import("./theme")
		activeTheme.configureTerminalTheme(TerminalColorMode.LIGHT, {})
		expect(activeTheme.theme.text).toBe("#2A2D33")
		expect(activeTheme.ansi.brightWhite).toBe(activeTheme.ansi.black)
		expect(activeTheme.theme.toolBody).toBe("#555C67")
		expect(activeTheme.ansi.toolBody).toBe("\x1b[38;2;85;92;103m")
		expect(activeTheme.theme.status.waiting).toBe(activeTheme.theme.warning)
		expect(activeTheme.styles.tool.header).toEqual({ color: activeTheme.theme.toolHeader })
		expect(activeTheme.styles.tool.activeHeader).toEqual({ color: activeTheme.theme.toolHeader, bold: true })
		expect(activeTheme.styles.tool.body).toEqual({ color: activeTheme.theme.toolBody })
		expect(activeTheme.styles.conversation.user).toEqual({ color: activeTheme.theme.userMessage })
		expect(activeTheme.styles.conversation.assistant).toEqual({ color: activeTheme.theme.assistantMessage })
		expect(activeTheme.theme.userMessage).not.toBe(activeTheme.theme.assistantMessage)
		expect(activeTheme.theme.userMessage).toBe("#277440")
		expect(activeTheme.theme.assistantMessage).toBe("#8A552E")
		activeTheme.configureTerminalTheme(TerminalColorMode.DARK, {})
		expect(activeTheme.theme.userMessage).toBe("#73B98A")
		expect(activeTheme.theme.assistantMessage).toBe("#D09A72")
	})

	it("detects standard and extended light backgrounds from COLORFGBG", () => {
		expect(resolveTerminalColorMode({ COLORFGBG: "0;15" })).toBe(TerminalColorMode.LIGHT)
		expect(resolveTerminalColorMode({ COLORFGBG: "0;255" })).toBe(TerminalColorMode.LIGHT)
		expect(resolveTerminalColorMode({ COLORFGBG: "15;0" })).toBe(TerminalColorMode.DARK)
	})

	it("keeps redirected output clean and respects standard color overrides", () => {
		expect(shouldUseAnsiColors(false, {})).toBe(false)
		expect(shouldUseAnsiColors(false, { FORCE_COLOR: "1" })).toBe(true)
		expect(shouldUseAnsiColors(true, { NO_COLOR: "1" })).toBe(false)
	})

	it("builds the light semantic and ANSI palette", async () => {
		vi.stubEnv("DIRAC_COLOR_MODE", "light")
		vi.resetModules()
		const lightTheme = await import("./theme")

		expect(lightTheme.terminalColorMode).toBe(TerminalColorMode.LIGHT)
		expect(lightTheme.theme.text).toBe("#2A2D33")
		expect(lightTheme.ansi.brightWhite).toBe(lightTheme.ansi.black)
		expect(lightTheme.theme.toolHeader).toBe("#414751")
		expect(lightTheme.ansi.toolHeader).toBe("\x1b[38;2;65;71;81m")
	})
})
