import { DiracMessage, DiracMessageType } from "@shared/ExtensionMessage"
import { render } from "ink-testing-library"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessage } from "./ChatMessage"

vi.mock("../hooks/useTerminalSize", () => ({
	useTerminalSize: () => ({
		columns: 120,
		rows: 40,
		resizeKey: 0,
	}),
}))

describe("ChatMessage markdown rendering", () => {
	it("renders basic markdown elements correctly with appropriate styling", () => {
		const message: DiracMessage = {
			id: "1",
			ts: Date.now(),
			content: {
				type: DiracMessageType.MARKDOWN,
				content:
					"# Heading 1\n\nThis is a **bold** and *italic* text with `inline code`.\n\n- List item 1\n- List item 2\n\n> Blockquote\n\n```javascript\nconst x = 1;\n```",
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""
		const plainFrame = frame.replace(/\u001B\[[0-9;]*m/g, "")

		expect(plainFrame).toContain("Heading 1")
		expect(plainFrame).toContain("bold")
		expect(plainFrame).toContain("italic")
		expect(plainFrame).toContain("inline code")
		expect(plainFrame).toContain("• List item 1")
		expect(plainFrame).toContain("• List item 2")
		expect(plainFrame).toContain("│ Blockquote")
		expect(plainFrame).toContain("const x = 1;")

		expect(frame).toContain("\u001B[1m")
		expect(frame).toContain("\u001B[3m")
		expect(frame).toContain("\u001B[48;2;42;42;62m")
	})
})
