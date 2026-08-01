import { fireEvent, render, screen } from "@testing-library/react"
import { Card, CardStatus } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
import { AskQuestionChoices, isAskQuestionCard } from "./AskQuestionDecorator"

function createQuestionCard(overrides: Partial<Card> = {}): Card {
	return {
		id: "question-card",
		header: "Question",
		status: CardStatus.WAITING_FOR_INPUT,
		renderType: "markdown",
		body: "Which approach should I use?",
		rawInput: { tool: "ask_followup_question", question: "Which approach should I use?" },
		actions: [
			{ label: "Use the existing API", value: "existing" },
			{ label: "Create a new API", value: "new" },
		],
		...overrides,
	}
}

describe("AskQuestionDecorator", () => {
	it("identifies ask question cards from machine-readable metadata", () => {
		expect(isAskQuestionCard(createQuestionCard())).toBe(true)
		expect(isAskQuestionCard(createQuestionCard({ rawInput: { tool: "read_file" } }))).toBe(false)
	})

	it("renders accessible choice rows and submits the selected value", () => {
		const onAction = vi.fn()
		render(<AskQuestionChoices card={createQuestionCard()} onAction={onAction} />)

		expect(screen.getByText("Choose a response")).toBeInTheDocument()
		expect(screen.getByText("Need something else? Type your own answer below.")).toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: "Choose Create a new API" }))
		expect(onAction).toHaveBeenCalledOnce()
		expect(onAction).toHaveBeenCalledWith("new")
	})

	it("removes the choices once the card is complete", () => {
		render(<AskQuestionChoices card={createQuestionCard({ status: CardStatus.SUCCESS })} isActive />)
		expect(screen.queryByText("Choose a response")).not.toBeInTheDocument()
	})
})
