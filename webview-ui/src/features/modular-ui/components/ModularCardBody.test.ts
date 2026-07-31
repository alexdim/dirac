import { CardStatus, SubagentExecutionStatus, type Card } from "@shared/ExtensionMessage"
import {
	createSubagentCardInput,
	createSubagentCardOutput,
	SubagentTrajectoryEventType,
} from "@shared/subagents"
import { describe, expect, it } from "vitest"
import { resolveCardBodyPresentation, SUBAGENT_CARD_MAX_HEIGHT_PX } from "./ModularCardBody"

describe("resolveCardBodyPresentation", () => {
	it("shows subagent tool calls without tool outputs and applies a fixed scroll height", () => {
		const identity = { id: 2, name: "Pauli" }
		const card: Card = {
			id: "subagent",
			header: identity.name,
			status: CardStatus.RUNNING,
			renderType: "markdown",
			body: "backend-formatted body",
			rawInput: createSubagentCardInput(identity, "Inspect the implementation", "Inspecting implementation"),
			rawOutput: createSubagentCardOutput(SubagentExecutionStatus.RUNNING, [
				{ type: SubagentTrajectoryEventType.TOOL, text: "read_file(paths=[\"src/file.ts\"])" },
				{ type: SubagentTrajectoryEventType.TOOL_RESULT, text: "secret tool output" },
			]),
		}

		const presentation = resolveCardBodyPresentation(card)

		expect(presentation.body).toContain("read_file")
		expect(presentation.body).not.toContain("secret tool output")
		expect(presentation.body).not.toContain("Agent 2")
		expect(presentation.maxHeight).toBe(SUBAGENT_CARD_MAX_HEIGHT_PX)
	})

	it("preserves ordinary card bodies and height limits", () => {
		const card: Card = {
			id: "ordinary",
			header: "Ordinary",
			status: CardStatus.RUNNING,
			renderType: "text",
			body: "full output",
			maxHeight: 640,
		}

		expect(resolveCardBodyPresentation(card)).toEqual({ body: "full output", maxHeight: 640 })
	})
})
