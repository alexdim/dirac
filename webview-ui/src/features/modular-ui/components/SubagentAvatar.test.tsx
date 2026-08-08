import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { getSubagentAvatarAccent, getSubagentAvatarInitial, SubagentAvatar } from "./SubagentAvatar"

describe("SubagentAvatar", () => {
	it("uses the first Unicode character of the complete subagent name", () => {
		expect(getSubagentAvatarInitial("Gödel")).toBe("G")
		expect(getSubagentAvatarInitial("Feynman Planck")).toBe("F")
		expect(getSubagentAvatarInitial("von Neumann")).toBe("V")
	})

	it("assigns compound-name subagents distinct stable accents", () => {
		const feynmanPlanckAccent = getSubagentAvatarAccent(34)

		expect(getSubagentAvatarAccent(34)).toBe(feynmanPlanckAccent)
		expect(getSubagentAvatarAccent(35)).not.toBe(feynmanPlanckAccent)
	})

	it("renders a decorative circular initial", () => {
		render(<SubagentAvatar agentId={34} agentName="Feynman Planck" />)

		const avatar = screen.getByTestId("subagent-avatar")
		expect(avatar).toHaveTextContent("F")
		expect(avatar).toHaveAttribute("aria-hidden", "true")
		expect(avatar).toHaveClass("rounded-full")
		expect(avatar.style.getPropertyValue("--subagent-avatar-accent")).toBe(getSubagentAvatarAccent(34))
	})
})
