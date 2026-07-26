import { DiracMessage, DiracMessageType } from "@shared/ExtensionMessage"
import { render } from "ink-testing-library"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessage } from "./ChatMessage"
import { theme } from "../constants/theme"

function foregroundAnsi(hex: string): string {
	const rgb = hex
		.slice(1)
		.match(/.{2}/g)!
		.map((component) => Number.parseInt(component, 16))
		.join(";")
	return `\u001B[38;2;${rgb}m`
}

vi.mock("../hooks/useTerminalSize", () => ({
	useTerminalSize: () => ({
		columns: 120,
		rows: 40,
		resizeKey: 0,
	}),
}))

describe("ChatMessage transcript roles", () => {
	it.each([
		["user", "User input", theme.userMessage],
		["assistant", "Model response", theme.assistantMessage],
	] as const)("renders %s messages with their dedicated role color", (role, content, color) => {
		const message: DiracMessage = {
			id: role,
			ts: Date.now(),
			content: {
				type: DiracMessageType.MARKDOWN,
				role,
				content,
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain(`${foregroundAnsi(color)}${content}`)
	})

	it("keeps user input and model responses visually distinct", () => {
		expect(theme.userMessage).toBe("#73B98A")
		expect(theme.assistantMessage).toBe("#D09A72")
		expect(theme.userMessage).not.toBe(theme.assistantMessage)
		expect(theme.userMessage).not.toBe(theme.toolHeader)
		expect(theme.assistantMessage).not.toBe(theme.toolBody)
	})
})


describe("ChatMessage card rendering", () => {
	it("renders subagent approval prompts as a tree", () => {
		const message: DiracMessage = {
			id: "1",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "card-1",
					header: "Dirac wants to run subagents",
					status: "building" as any,
					renderType: "markdown",
					body: "### Dirac wants to run subagents:\n\n- Find codebase stats and size\n- Find funny comments and easter eggs\n- Find unusual patterns and history",
					requireApproval: true,
				},
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = (lastFrame() || "").replace(/\s+/g, " ")

		expect(frame).toContain("Dirac wants to run subagents")
		expect(frame).toContain("Find codebase stats and size")
		expect(frame).toContain("Find funny comments and easter eggs")
		expect(frame).toContain("Find unusual patterns and history")
	})

	it("keeps running tool cards expanded", () => {
		const message: DiracMessage = {
			id: "2",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "card-2",
					header: "Dirac is running subagents",
					status: "running" as any,
					renderType: "markdown",
					body: "### Subagent Status (1/3)\n\n| # | Status | Prompt | Tokens (In/Out) | Cost |\n|---|--------|--------|-----------------|------|\n| 1 | ✅ completed | Find codebase stats and size | 24,400 / 0 | $0.0340 |\n| 2 | ⏳ running | Find funny comments and easter eggs | 31,600 / 0 | $0.0560 |\n| 3 | ⏳ pending | Find unusual patterns and history | 28,900 / 0 | $0.0000 |",
				},
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { isStreaming: true, message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain("Dirac is running subagents")
		expect(frame).toContain("Subagent Status (1/3)")
		expect(frame).toContain("24,400")
	})

	it("keeps completed tool cards expanded", () => {
		const message: DiracMessage = {
			id: "3",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "card-3",
					header: "Read cli/src/components/ChatMessage.tsx",
					status: "success" as any,
					renderType: "text",
					body: "Complete§Complete tool output that must remain visible",
					collapsed: true,
				},
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain("Read cli/src/components/ChatMessage.tsx")
		expect(frame).toContain("Complete tool output that must remain visible")
		expect(frame).not.toContain("Complete§")
	})

	it("uses category color only for tool accents and distinct neutral colors for headers and outputs", () => {
		const message: DiracMessage = {
			id: "completed-colors",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "completed-colors-card",
					header: "Read a source file",
					status: "success" as any,
					renderType: "text",
					body: "Tool output",
				},
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain(foregroundAnsi(theme.toolCommunicate))
		expect(frame).toContain(`${foregroundAnsi(theme.toolHeader)}Read a source file`)
		expect(frame).toContain(`${foregroundAnsi(theme.toolBody)}Tool output`)
		expect(theme.toolHeader).not.toBe(theme.toolBody)
		expect(frame).not.toContain(`${foregroundAnsi(theme.toolCommunicate)}Read a source file`)
		expect(frame).not.toContain(`\u001B[1m${foregroundAnsi(theme.toolHeader)}Read a source file`)
	})

	it("uses bold only for active tool headers", () => {
		const message: DiracMessage = {
			id: "running-style",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "running-style-card",
					header: "Running a command",
					status: "running" as any,
					renderType: "text",
					body: "Command output",
				},
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain(`\u001B[1m${foregroundAnsi(theme.toolHeader)}Running a command`)
		expect(frame).toContain(`${foregroundAnsi(theme.toolBody)}Command output`)
	})

	it("renders task completion as a prominent result panel", () => {
		const message: DiracMessage = {
			id: "task-completion",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "task-completion-card",
					header: "Task Completed",
					icon: "check-circle-2",
					status: "success" as any,
					renderType: "markdown",
					body: "Updated§Updated the CLI completion rendering.",
				},
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain("╭")
		expect(frame).toContain("╰")
		expect(frame).toContain(`\u001B[1m${foregroundAnsi(theme.toolComplete)}✔ Task Completed`)
		expect(frame).toContain("Updated the CLI completion rendering.")
		expect(frame).not.toContain("Updated§")
		expect(frame).not.toContain("✓ success")
	})


	it("renders a normal card header without its body when suppression is requested", () => {
		const message: DiracMessage = {
			id: "quiet-card",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "quiet-card",
					header: "Quiet tool card",
					status: "success" as any,
					renderType: "text",
					body: "Hidden tool output",
				},
			},
		}

		const frame = render(
			React.createElement(ChatMessage, { message, mode: "act", suppressCardBody: true }),
		).lastFrame() || ""

		expect(frame).toContain("Quiet tool card")
		expect(frame).not.toContain("Hidden tool output")
	})

	it("can suppress the Task Completed body while retaining its header", () => {
		const message: DiracMessage = {
			id: "quiet-completion",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "quiet-completion",
					header: "Task Completed",
					status: "success" as any,
					renderType: "markdown",
					body: "Hidden completion output",
				},
			},
		}

		const frame = render(
			React.createElement(ChatMessage, { message, mode: "act", suppressCardBody: true }),
		).lastFrame() || ""

		expect(frame).toContain("Task Completed")
		expect(frame).not.toContain("Hidden completion output")
	})


	it("renders edit-file bodies with the existing diff view", () => {
		const message: DiracMessage = {
			id: "4",
			ts: Date.now(),
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "card-4",
					header: "Edited cli/src/example.ts",
					status: "success" as any,
					renderType: "diff",
					body: "<<<<<<< SEARCH:1\nBefore§const before = 1\n=======\nAfter§const after = 2\n>>>>>>> REPLACE",
				},
			},
		}

		const { lastFrame } = render(React.createElement(ChatMessage, { message, mode: "act" }))
		const frame = lastFrame() || ""

		expect(frame).toContain("Edited cli/src/example.ts")
		expect(frame).toContain("const before = 1")
		expect(frame).toContain("const after = 2")
		expect(frame).not.toContain("Before§")
		expect(frame).not.toContain("After§")
	})
})
