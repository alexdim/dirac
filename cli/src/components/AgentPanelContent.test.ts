import { CardStatus, DiracMessage, DiracMessageType, SubagentExecutionStatus, TaskStatus } from "@shared/ExtensionMessage"
import { createSubagentCardInput, createSubagentCardOutput } from "@shared/subagents"
import { describe, expect, it } from "vitest"
import { buildAgentList, getAgentListRowLimit } from "./AgentPanelContent"

describe("buildAgentList", () => {
	it("keeps Dirac first and exposes named subagent status, prompt, and trajectory", () => {
		const messages: DiracMessage[] = [
			{
				id: "task",
				ts: 1,
				content: { type: DiracMessageType.MARKDOWN, content: "Investigate agents", role: "user" as const },
			},
			{
				id: "agent-message",
				ts: 2,
				content: {
					type: DiracMessageType.MARKDOWN,
					content: "**Shannon:** Working on it.",
					role: "assistant",
					agentId: 2,
					agentName: "Shannon",
				},
			},
			{
				id: "agent",
				ts: 3,
				content: {
					type: DiracMessageType.CARD,
					card: {
						id: "agent",
						header: "Shannon",
						status: CardStatus.RUNNING,
						renderType: "markdown" as const,
						rawInput: createSubagentCardInput({ id: 2, name: "Shannon" }, "Trace the event flow"),
						rawOutput: createSubagentCardOutput(SubagentExecutionStatus.RUNNING, []),
					},
				},
			},
		]

		const agents = buildAgentList(messages, TaskStatus.THINKING)

		expect(agents.map((agent) => agent.name)).toEqual(["Dirac", "Shannon"])
		expect(agents[0].id).toBe(1)
		expect(agents[0].status).toBe(SubagentExecutionStatus.RUNNING)
		expect(agents[0].transcript).not.toContain("Shannon")
		expect(agents[1]).toMatchObject({
			id: 2,
			status: SubagentExecutionStatus.RUNNING,
			prompt: "Trace the event flow",
		})
		expect(agents[1].transcript).toContain("Trajectory")
	})
})

describe("getAgentListRowLimit", () => {
	it("reserves panel chrome and always leaves room for one agent", () => {
		expect(getAgentListRowLimit(6)).toBe(1)
		expect(getAgentListRowLimit(24)).toBe(8)
	})
})
