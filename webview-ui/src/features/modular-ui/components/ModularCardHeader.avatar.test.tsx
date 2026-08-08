import { render, screen } from "@testing-library/react"
import { CardStatus, type Card, SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { createSubagentCardInput, createSubagentCardOutput } from "@shared/subagents"
import { describe, expect, it, vi } from "vitest"
import { ModularCardHeader } from "./ModularCardHeader"

function createCard(overrides: Partial<Card> = {}): Card {
	return {
		id: "card",
		header: "Feynman Planck: Inspect API handler",
		status: CardStatus.RUNNING,
		renderType: "markdown",
		rawInput: createSubagentCardInput({ id: 34, name: "Feynman Planck" }, "Inspect the API handler"),
		rawOutput: createSubagentCardOutput(SubagentExecutionStatus.RUNNING, []),
		...overrides,
	}
}

describe("ModularCardHeader subagent avatars", () => {
	it("renders an avatar for individual subagent cards", () => {
		render(
			<ModularCardHeader
				card={createCard()}
				contentId="card-content"
				isCollapsed={true}
				onToggleCollapse={vi.fn()}
			/>,
		)

		expect(screen.getByTestId("subagent-avatar")).toHaveTextContent("F")
	})

	it("does not render an avatar for generic cards", () => {
		render(
			<ModularCardHeader
				card={createCard({ header: "Read file", rawInput: undefined, rawOutput: undefined })}
				contentId="card-content"
				isCollapsed={true}
				onToggleCollapse={vi.fn()}
			/>,
		)

		expect(screen.queryByTestId("subagent-avatar")).not.toBeInTheDocument()
	})
})
