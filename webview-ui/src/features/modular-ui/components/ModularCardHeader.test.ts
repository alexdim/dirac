import { Card, CardStatus, SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { createSubagentCardInput, createSubagentCardOutput } from "@shared/subagents"
import { describe, expect, it } from "vitest"
import { getCardFilePath, getSubagentCardElapsedTime } from "./ModularCardHeader"

function createSubagentCard(overrides: Partial<Card> = {}): Card {
	return {
		id: "subagent-card",
		header: "Pauli: Investigating API handler",
		status: CardStatus.RUNNING,
		renderType: "markdown",
		startTime: 0,
		rawInput: createSubagentCardInput(
			{ id: 2, name: "Pauli" },
			"Investigate the API handler",
			"Investigating API handler",
		),
		rawOutput: createSubagentCardOutput(SubagentExecutionStatus.RUNNING, []),
		...overrides,
	}
}

describe("getCardFilePath", () => {
	it("prefers an exact machine-readable card location over header inference", () => {
		const card: Card = {
			id: "ast-card",
			header: "Inspecting implementation from misleading.ts",
			toolName: "inspect_ast",
			status: CardStatus.SUCCESS,
			renderType: "markdown",
			locations: [{ path: "src/exact.ts", line: 9 }],
		}

		expect(getCardFilePath(card)).toBe("src/exact.ts")
	})
})

describe("getSubagentCardElapsedTime", () => {
	it("formats a running subagent duration as MM:SS", () => {
		expect(getSubagentCardElapsedTime(createSubagentCard(), 62_000)).toBe("01:02")
	})

	it("freezes a terminal subagent duration at its end time", () => {
		const card = createSubagentCard({
			status: CardStatus.SUCCESS,
			endTime: 95_000,
			rawOutput: createSubagentCardOutput(SubagentExecutionStatus.COMPLETED, []),
		})

		expect(getSubagentCardElapsedTime(card, 120_000)).toBe("01:35")
	})

	it("does not expose a timer for generic or timestamp-less subagent cards", () => {
		const genericCard: Card = {
			id: "generic-card",
			header: "Read file",
			status: CardStatus.RUNNING,
			renderType: "text",
			startTime: 0,
		}

		expect(getSubagentCardElapsedTime(genericCard, 62_000)).toBeUndefined()
		expect(getSubagentCardElapsedTime(createSubagentCard({ startTime: undefined }), 62_000)).toBeUndefined()
	})
})
