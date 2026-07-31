import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { CardStatus, SubagentExecutionStatus } from "@shared/ExtensionMessage"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"
import { use_subagents_spec, UseSubagentsTool } from "./UseSubagentsTool"

const EMPTY_STATS = {
	toolCalls: 0,
	inputTokens: 0,
	outputTokens: 0,
	cacheWriteTokens: 0,
	cacheReadTokens: 0,
	totalCost: 0,
	contextTokens: 0,
	contextWindow: 0,
	contextUsagePercentage: 0,
}

interface RecordedCard {
	params: any
	updates: any[]
	finalStatuses: unknown[]
}

function createRecordedCardEnvironment(
	runSubagent: (_prompt: string, options: any) => Promise<any>,
	shouldFailUpdate: (params: any) => boolean = () => false,
): { env: IToolEnvironment; cards: RecordedCard[]; warnings: unknown[][] } {
	const cards: RecordedCard[] = []
	const warnings: unknown[][] = []
	const env = {
		toolName: "use_subagents",
		config: { isSubagentExecution: false },
		orchestration: {
			getHistory: () => [],
			getTaskState: () => 0,
			setTaskState: () => {},
			runSubagent,
		},
		ui: {
			createCard: async (params: any) => {
				const card = { params, updates: [] as any[], finalStatuses: [] as unknown[] }
				cards.push(card)
				return {
					update: async (patch: any) => {
						if (shouldFailUpdate(params)) throw new Error("presentation failed")
						card.updates.push(patch)
					},
					finalize: async (status: unknown) => {
						card.finalStatuses.push(status)
					},
				}
			},
		},
		logging: {
			warn: (...args: unknown[]) => warnings.push(args),
		},
	} as unknown as IToolEnvironment
	return { env, cards, warnings }
}

describe("UseSubagentsTool", () => {
	it("reports cancellations separately and keeps named trajectory cards collapsed", async () => {
		const { env, cards } = createRecordedCardEnvironment(async (_prompt, options) => {
			await options.onUpdate({ status: SubagentExecutionStatus.RUNNING, stats: EMPTY_STATS })
			await options.onUpdate({ textChunk: "first chunk" })
			await options.onUpdate({ textChunk: "second chunk" })
			await options.onUpdate({
				status: SubagentExecutionStatus.CANCELLED,
				error: "cancelled by user",
				stats: EMPTY_STATS,
			})
			return { status: SubagentExecutionStatus.CANCELLED, error: "cancelled by user", stats: EMPTY_STATS }
		})

		const result = await new UseSubagentsTool().processCall({ subagents: [{ prompt: "Investigate" }] }, env)
		const agentCard = cards.find((card) => card.params.header !== "Run Subagents")

		assert.match(result as string, /Succeeded: 0/)
		assert.match(result as string, /Failed: 0/)
		assert.match(result as string, /Cancelled: 1/)
		assert.ok(agentCard)
		assert.equal(agentCard.params.collapsed, true)
		assert.doesNotMatch(agentCard.params.header, /^Agent\s+\d+/)
		assert.equal(agentCard.updates.length, 2)
		assert.deepEqual(agentCard.finalStatuses, [CardStatus.CANCELLED])
	})

	it("finalizes from the returned result when no terminal progress update is emitted", async () => {
		const { env, cards } = createRecordedCardEnvironment(async () => ({
			status: SubagentExecutionStatus.COMPLETED,
			result: "done",
			stats: EMPTY_STATS,
		}))

		await new UseSubagentsTool().processCall({ subagents: [{ prompt: "Investigate" }] }, env)
		const agentCard = cards.find((card) => card.params.header !== "Run Subagents")
		const finalUpdate = agentCard?.updates.at(-1)

		assert.ok(agentCard)
		assert.equal(finalUpdate.rawOutput.status, SubagentExecutionStatus.COMPLETED)
		assert.match(finalUpdate.body, /done/)
		assert.deepEqual(agentCard.finalStatuses, [CardStatus.SUCCESS])
	})

	it("returns completed execution results when an agent card update fails", async () => {
		const { env, warnings } = createRecordedCardEnvironment(
			async () => ({
				status: SubagentExecutionStatus.COMPLETED,
				result: "done",
				stats: EMPTY_STATS,
			}),
			(params) => params.header !== "Run Subagents",
		)

		const result = await new UseSubagentsTool().processCall({ subagents: [{ prompt: "Investigate" }] }, env)

		assert.match(result as string, /Succeeded: 1/)
		assert.equal(warnings.length, 1)
		assert.match(String(warnings[0][0]), /presentation error/)
	})

	it("uses a 600-second default timeout without a turn-limit option", async () => {
		let receivedOptions: any
		const { env } = createRecordedCardEnvironment(async (_prompt, options) => {
			receivedOptions = options
			return {
				status: SubagentExecutionStatus.COMPLETED,
				result: "done",
				stats: EMPTY_STATS,
			}
		})

		await new UseSubagentsTool().processCall({ subagents: [{ prompt: "Investigate" }] }, env)

		assert.equal(receivedOptions.timeout, 600)
		assert.equal("maxTurns" in receivedOptions, false)
		const subagentsParameter = use_subagents_spec.parameters?.find((parameter) => parameter.name === "subagents")
		assert.ok(subagentsParameter?.items)
		assert.equal("max_turns" in subagentsParameter.items.properties, false)
	})

})
