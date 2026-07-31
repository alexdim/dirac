import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { CardStatus, SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { SubagentTrajectoryEventType } from "@shared/subagents"
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
	beforeCardUpdate: (params: any, patch: any) => Promise<void> = async () => { },
	beforeCreateCard: (params: any) => Promise<void> = async () => { },
): { env: IToolEnvironment; cards: RecordedCard[]; warnings: unknown[][] } {
	const cards: RecordedCard[] = []
	const warnings: unknown[][] = []
	const env = {
		toolName: "use_subagents",
		config: { isSubagentExecution: false },
		orchestration: {
			getHistory: () => [],
			getTaskState: () => 0,
			setTaskState: () => { },
			runSubagent,
		},
		ui: {
			createCard: async (params: any) => {
				await beforeCreateCard(params)
				const card = { params, updates: [] as any[], finalStatuses: [] as unknown[] }
				cards.push(card)
				return {
					update: async (patch: any) => {
						if (shouldFailUpdate(params)) throw new Error("presentation failed")
						await beforeCardUpdate(params, patch)
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

		const result = await new UseSubagentsTool().processCall({ subagents: [{ task_title: "Investigating subagent behavior", prompt: "Investigate" }] }, env)
		const agentCard = cards.find((card) => card.params.header !== "Run Subagents")

		assert.match(result as string, /Succeeded: 0/)
		assert.match(result as string, /Failed: 0/)
		assert.match(result as string, /Cancelled: 1/)
		assert.ok(agentCard)
		assert.equal(agentCard.params.collapsed, true)
		assert.equal(agentCard.params.header, "Investigating subagent behavior")
		assert.equal(agentCard.params.rawInput.taskTitle, "Investigating subagent behavior")
		assert.equal(agentCard.updates.length, 2)
		assert.deepEqual(agentCard.finalStatuses, [CardStatus.CANCELLED])
	})

	it("finalizes from the returned result when no terminal progress update is emitted", async () => {
		const { env, cards } = createRecordedCardEnvironment(async () => ({
			status: SubagentExecutionStatus.COMPLETED,
			result: "done",
			stats: EMPTY_STATS,
		}))

		await new UseSubagentsTool().processCall({ subagents: [{ task_title: "Investigating subagent behavior", prompt: "Investigate" }] }, env)
		const agentCard = cards.find((card) => card.params.header !== "Run Subagents")
		const finalUpdate = agentCard?.updates.at(-1)

		assert.ok(agentCard)
		assert.equal(finalUpdate.rawOutput.status, SubagentExecutionStatus.COMPLETED)
		assert.match(finalUpdate.body, /done/)
		assert.deepEqual(agentCard.finalStatuses, [CardStatus.SUCCESS])
	})

	it("keeps the final card update after delayed trajectory updates", async () => {
		const { env, cards } = createRecordedCardEnvironment(
			async (_prompt, options) => {
				options.onUpdate({
					trajectoryEvent: { type: SubagentTrajectoryEventType.TOOL, text: "first_tool" },
				})
				options.onUpdate({
					trajectoryEvent: { type: SubagentTrajectoryEventType.TOOL, text: "second_tool" },
				})
				return { status: SubagentExecutionStatus.COMPLETED, result: "done", stats: EMPTY_STATS }
			},
			() => false,
			async (_params, patch) => {
				if (patch.rawOutput?.status === SubagentExecutionStatus.COMPLETED) return
				if (patch.body?.includes("second_tool")) {
					await new Promise((resolve) => setTimeout(resolve, 10))
					return
				}
				if (patch.body?.includes("first_tool")) await new Promise((resolve) => setTimeout(resolve, 20))
			},
		)

		await new UseSubagentsTool().processCall(
			{ subagents: [{ task_title: "Tracking tool progress", prompt: "Investigate" }] },
			env,
		)
		const agentCard = cards.find((card) => card.params.header === "Tracking tool progress")
		const finalUpdate = agentCard?.updates.at(-1)

		assert.ok(agentCard)
		assert.equal(agentCard.updates.length, 3)
		assert.equal(finalUpdate.status, CardStatus.SUCCESS)
		assert.equal(finalUpdate.rawOutput.status, SubagentExecutionStatus.COMPLETED)
		assert.match(finalUpdate.body, /second_tool/)
		assert.match(finalUpdate.body, /done/)
	})


	it("returns when a presentation update never settles", async () => {
		const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
		try {
			const { env, warnings } = createRecordedCardEnvironment(
				async (_prompt, options) => {
					options.onUpdate({
						trajectoryEvent: { type: SubagentTrajectoryEventType.TOOL, text: "blocked_tool" },
					})
					return { status: SubagentExecutionStatus.COMPLETED, result: "done", stats: EMPTY_STATS }
				},
				() => false,
				async (params, patch) => {
					if (params.header === "Run Subagents") return
					if (patch.rawOutput?.status === SubagentExecutionStatus.RUNNING) {
						await new Promise<void>(() => { })
					}
				},
			)

			const resultPromise = new UseSubagentsTool().processCall(
				{ subagents: [{ task_title: "Tracking blocked presentation", prompt: "Investigate" }] },
				env,
			)
			await clock.tickAsync(0)
			await clock.tickAsync(1_000)
			const result = await resultPromise

			assert.match(result as string, /Succeeded: 1/)
			assert.equal(warnings.length, 1)
			assert.match(String(warnings[0][1]), /did not drain before the timeout/)
		} finally {
			clock.restore()
		}
	})

	it("returns when aggregate card creation never settles", async () => {
		const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
		try {
			const { env, warnings } = createRecordedCardEnvironment(
				async () => ({ status: SubagentExecutionStatus.COMPLETED, result: "done", stats: EMPTY_STATS }),
				() => false,
				async () => { },
				async (params) => {
					if (params.header === "Run Subagents") await new Promise<void>(() => { })
				},
			)

			const resultPromise = new UseSubagentsTool().processCall(
				{ subagents: [{ task_title: "Testing card timeout", prompt: "Investigate" }] },
				env,
			)
			await clock.tickAsync(1_000)
			const result = await resultPromise

			assert.match(result as string, /Succeeded: 1/)
			assert.equal(warnings.length, 1)
			assert.match(String(warnings[0][1]), /card creation timed out/)
		} finally {
			clock.restore()
		}
	})

	it("returns when a subagent card creation never settles", async () => {
		const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
		try {
			const { env, warnings } = createRecordedCardEnvironment(
				async () => ({ status: SubagentExecutionStatus.COMPLETED, result: "done", stats: EMPTY_STATS }),
				() => false,
				async () => { },
				async (params) => {
					if (params.header !== "Run Subagents") await new Promise<void>(() => { })
				},
			)

			const resultPromise = new UseSubagentsTool().processCall(
				{ subagents: [{ task_title: "Testing card timeout", prompt: "Investigate" }] },
				env,
			)
			await clock.tickAsync(0)
			await clock.tickAsync(1_000)
			const result = await resultPromise

			assert.match(result as string, /Succeeded: 1/)
			assert.equal(warnings.length, 1)
			assert.match(String(warnings[0][1]), /card creation timed out/)
		} finally {
			clock.restore()
		}
	})

	it("derives a task title for legacy calls that omit it", async () => {
		const { env, cards } = createRecordedCardEnvironment(async () => ({
			status: SubagentExecutionStatus.COMPLETED,
			result: "done",
			stats: EMPTY_STATS,
		}))

		const result = await new UseSubagentsTool().processCall(
			{ subagents: [{ prompt: "Investigate the current subagent behavior carefully" }] },
			env,
		)
		const agentCard = cards.find((card) => card.params.header !== "Run Subagents")

		assert.match(result as string, /Succeeded: 1/)
		assert.equal(agentCard?.params.header, "Investigate the current subagent behavior")
		assert.equal(agentCard?.params.rawInput.taskTitle, "Investigate the current subagent behavior")
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

		const result = await new UseSubagentsTool().processCall({ subagents: [{ task_title: "Investigating subagent behavior", prompt: "Investigate" }] }, env)

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

		await new UseSubagentsTool().processCall({ subagents: [{ task_title: "Investigating subagent behavior", prompt: "Investigate" }] }, env)

		assert.equal(receivedOptions.timeout, 600)
		assert.equal("maxTurns" in receivedOptions, false)
		const subagentsParameter = use_subagents_spec.parameters?.find((parameter) => parameter.name === "subagents")
		assert.ok(subagentsParameter?.items)
		assert.deepEqual(subagentsParameter.items.required, ["task_title", "prompt"])
		assert.equal(
			subagentsParameter.items.properties.task_title.description,
			"Task header for user observability. No more than 5 words or 80 characters.",
		)
		assert.equal("max_turns" in subagentsParameter.items.properties, false)
	})

	it("rejects task titles longer than five words", async () => {
		const { env } = createRecordedCardEnvironment(async () => {
			throw new Error("Subagent should not run")
		})

		await assert.rejects(
			() =>
				new UseSubagentsTool().processCall(
					{ subagents: [{ task_title: "This title contains more than five words", prompt: "Investigate" }] },
					env,
				),
			/task_title must contain no more than 5 words/,
		)
	})


	it("rejects task titles longer than eighty characters", async () => {
		const { env } = createRecordedCardEnvironment(async () => {
			throw new Error("Subagent should not run")
		})

		await assert.rejects(
			() =>
				new UseSubagentsTool().processCall(
					{ subagents: [{ task_title: "x".repeat(81), prompt: "Investigate" }] },
					env,
				),
			/task_title must contain no more than 80 characters/,
		)
	})

})
