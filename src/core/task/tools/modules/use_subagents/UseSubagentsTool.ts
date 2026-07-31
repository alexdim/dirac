import { IDiracTool } from "../../interfaces/IDiracTool"
import { ICardHandle, IToolEnvironment } from "../../interfaces/IToolEnvironment"
import { DiracToolSpec, DiracDefaultTool } from "@/shared/tools"
import { stripHashes } from "../../../../../shared/utils/line-hashing"
import { formatResponse } from "@core/formatResponse"
import { AgentConfigLoader } from "../../subagent/AgentConfigLoader"
import { SubagentStatusItem } from "@shared/ExtensionMessage"
import { excerpt } from "../../../utils/excerpt"
import { CardStatus, SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { DiracIcon } from "@/shared/icons"
import {
	appendSubagentTrajectoryEvent,
	allocateSubagentIdentity,
	createSubagentCardInput,
	createSubagentCardOutput,
	formatSubagentTrajectory,
	isTerminalSubagentStatus,
	recordSubagentProgress,
	subagentCardStatus,
	SubagentTrajectoryEventType,
	type SubagentTrajectoryEvent,
} from "@shared/subagents"

interface SubagentRequest {
	prompt: string
	timeout: number
	maxTurns?: number
	includeHistory: boolean
}

export const use_subagents_spec: DiracToolSpec = {
	id: DiracDefaultTool.USE_SUBAGENTS,
	name: "use_subagents",
	description: "Run subagents in parallel.",
	contextRequirements: (context) => context.subagentsEnabled === true,
	parameters: [
		{
			name: "subagents",
			type: "array",
			required: true,
			instruction: "Subagents to run in parallel.",
			items: {
				type: "object",
				properties: {
					prompt: {
						type: "string",
						description: "Task for this subagent.",
					},
					timeout: {
						type: "integer",
						description: "Timeout in seconds. Default: 300.",
					},
					max_turns: {
						type: "integer",
						description: "Maximum turns.",
					},
					include_history: {
						type: "boolean",
						description: "Include the main task conversation history.",
					},
				},
				required: ["prompt"],
				additionalProperties: false,
			},
		},
	],
}

export class UseSubagentsTool implements IDiracTool {
	spec(): DiracToolSpec {
		return use_subagents_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(args: any, env: IToolEnvironment): Promise<any> {
		this.validateExecution(env)

		const subagentName = AgentConfigLoader.getInstance().resolveSubagentNameForTool(env.toolName)
		const requests = this.resolveRequests(args, subagentName)

		if (requests.length === 0) {
			env.orchestration.setTaskState(
				"consecutiveMistakeCount",
				env.orchestration.getTaskState("consecutiveMistakeCount") + 1,
			)
			return formatResponse.toolError(`Missing required parameter: ${subagentName ? "prompt" : "subagents"}`)
		}

		const entries = this.initializeEntries(
			requests.map(({ prompt }) => prompt),
			env.orchestration.getHistory(),
		)
		const presentationErrors: Error[] = []
		let card: ICardHandle | undefined
		if (!env.config.isSubagentExecution) {
			try {
				card = await env.ui.createCard({
					header: "Run Subagents",
					icon: DiracIcon.SUBAGENTS,
					collapsed: true,
				})
			} catch (error) {
				presentationErrors.push(error as Error)
			}
		}

		const emitStatus = async (status: SubagentExecutionStatus) => {
			if (!card) return
			const payload = this.calculateStatusPayload(status, entries)
			try {
				await card.update({
					status: subagentCardStatus(status),
					body: this.formatSubagentStatusMarkdown(payload),
					renderType: "markdown",
				})
			} catch (error) {
				presentationErrors.push(error as Error)
			}
		}

		await emitStatus(SubagentExecutionStatus.RUNNING)
		presentationErrors.push(...(await this.runSubagents(requests, subagentName, entries, env, emitStatus)))

		const failures = entries.filter((entry) => entry.status === SubagentExecutionStatus.FAILED).length
		const cancellations = entries.filter((entry) => entry.status === SubagentExecutionStatus.CANCELLED).length
		const finalStatus =
			failures > 0
				? SubagentExecutionStatus.FAILED
				: cancellations > 0
					? SubagentExecutionStatus.CANCELLED
					: SubagentExecutionStatus.COMPLETED

		await emitStatus(finalStatus)
		if (card) {
			try {
				await card.update({ header: `Ran ${requests.length} subagents` })
			} catch (error) {
				presentationErrors.push(error as Error)
			}
			try {
				await card.finalize(subagentCardStatus(finalStatus))
			} catch (error) {
				presentationErrors.push(error as Error)
			}
		}

		if (presentationErrors.length > 0) {
			env.logging.warn(
				`Subagent execution completed with ${presentationErrors.length} presentation error(s).`,
				presentationErrors[0],
			)
		}

		return formatResponse.toolResult(this.formatFinalResponse(entries))
	}

	private validateExecution(env: IToolEnvironment): void {
		if (env.config.isSubagentExecution) {
			throw new Error("Subagents cannot spawn other subagents.")
		}
	}

	private resolveRequests(args: any, subagentName: string | undefined): SubagentRequest[] {
		if (subagentName) {
			const prompt = typeof args.prompt === "string" ? args.prompt.trim() : ""
			return prompt ? [{ prompt, ...this.parseOptions(args) }] : []
		}

		if (!Array.isArray(args.subagents)) {
			return []
		}

		return args.subagents.map((subagent: any, index: number) => {
			const prompt = typeof subagent?.prompt === "string" ? subagent.prompt.trim() : ""
			if (!prompt) {
				throw new Error(`Subagent ${index + 1} is missing required parameter: prompt`)
			}

			return { prompt, ...this.parseOptions(subagent) }
		})
	}

	private parseOptions(args: any): Omit<SubagentRequest, "prompt"> {
		return {
			timeout: args.timeout === undefined ? 300 : parseInt(String(args.timeout), 10),
			maxTurns: args.max_turns === undefined ? undefined : parseInt(String(args.max_turns), 10),
			includeHistory: args.include_history === true || String(args.include_history) === "true",
		}
	}

	private initializeEntries(
		prompts: string[],
		history: ReturnType<IToolEnvironment["orchestration"]["getHistory"]>,
	): SubagentStatusItem[] {
		const reserved: Array<{ id: number; name: string }> = []
		return prompts.map((prompt) => {
			const identity = allocateSubagentIdentity(history, reserved)
			reserved.push(identity)
			return {
				index: identity.id,
				name: identity.name,
				prompt,
				status: SubagentExecutionStatus.PENDING,
				toolCalls: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0,
				contextTokens: 0,
				contextWindow: 0,
				contextUsagePercentage: 0,
			}
		})
	}

	private calculateStatusPayload(status: SubagentExecutionStatus, entries: SubagentStatusItem[]): any {
		const completed = entries.filter(
			(e) =>
				e.status === SubagentExecutionStatus.COMPLETED ||
				e.status === SubagentExecutionStatus.FAILED ||
				e.status === SubagentExecutionStatus.CANCELLED,
		).length
		const successes = entries.filter((e) => e.status === SubagentExecutionStatus.COMPLETED).length
		const failures = entries.filter((e) => e.status === SubagentExecutionStatus.FAILED).length
		const toolCalls = entries.reduce((acc: number, e) => acc + (e.toolCalls || 0), 0)
		const inputTokens = entries.reduce((acc: number, e) => acc + (e.inputTokens || 0), 0)
		const outputTokens = entries.reduce((acc: number, e) => acc + (e.outputTokens || 0), 0)
		const cacheWrites = entries.reduce((acc: number, e) => acc + (e.cacheWrites || 0), 0)
		const cacheReads = entries.reduce((acc: number, e) => acc + (e.cacheReads || 0), 0)
		const contextWindow = entries.reduce((acc: number, e) => Math.max(acc, e.contextWindow || 0), 0)
		const maxContextTokens = entries.reduce((acc: number, e) => Math.max(acc, e.contextTokens || 0), 0)
		const maxContextUsagePercentage = entries.reduce((acc: number, e) => Math.max(acc, e.contextUsagePercentage || 0), 0)

		return {
			status,
			total: entries.length,
			completed,
			successes,
			failures,
			toolCalls,
			inputTokens,
			outputTokens,
			cacheWrites,
			cacheReads,
			contextWindow,
			maxContextTokens,
			maxContextUsagePercentage,
			items: entries,
		}
	}

	private async runSubagents(
		requests: SubagentRequest[],
		subagentName: string | undefined,
		entries: SubagentStatusItem[],
		env: IToolEnvironment,
		emitStatus: (status: SubagentExecutionStatus) => Promise<void>,
	): Promise<Error[]> {
		let lastAggregateUpdateAt = 0
		const emitRunningStatus = async (force = false) => {
			const now = Date.now()
			if (!force && now - lastAggregateUpdateAt < 100) return
			lastAggregateUpdateAt = now
			await emitStatus(SubagentExecutionStatus.RUNNING)
		}

		const execution = requests.map(async (request, index) => {
			const entry = entries[index]
			const trajectory: SubagentTrajectoryEvent[] = []
			let presentationError: Error | undefined
			let subagentCard: ICardHandle | undefined
			if (!env.config.isSubagentExecution) {
				try {
					subagentCard = await env.ui.createCard({
						header: entry.name,
						collapsed: true,
						status: CardStatus.RUNNING,
						renderType: "markdown",
						autoScroll: true,
						rawInput: createSubagentCardInput({ id: entry.index, name: entry.name }, request.prompt),
						rawOutput: createSubagentCardOutput(SubagentExecutionStatus.RUNNING, trajectory),
						body: formatSubagentTrajectory({
							id: entry.index,
							name: entry.name,
							prompt: request.prompt,
							status: SubagentExecutionStatus.RUNNING,
							trajectory,
						}),
					})
				} catch (error) {
					presentationError = error as Error
				}
			}

			try {
				const runResult = await env.orchestration.runSubagent(request.prompt, {
					timeout: request.timeout,
					maxTurns: request.maxTurns,
					includeHistory: request.includeHistory,
					subagentName,
					agentIdentity: { id: entry.index, name: entry.name },
					onUpdate: async (update) => {
						const current = entries[index]
						const trajectoryChanged = update.trajectoryEvent !== undefined || update.status !== undefined
						const status = trajectoryChanged ? recordSubagentProgress(trajectory, update) : current.status

						if (update.status) current.status = update.status
						if (update.result !== undefined) current.result = update.result
						if (update.error !== undefined) current.error = update.error
						if (update.latestToolCall !== undefined) current.latestToolCall = update.latestToolCall
						if (update.stats) {
							current.toolCalls = update.stats.toolCalls
							current.inputTokens = update.stats.inputTokens
							current.outputTokens = update.stats.outputTokens
							current.cacheWrites = update.stats.cacheWriteTokens
							current.cacheReads = update.stats.cacheReadTokens
							current.totalCost = update.stats.totalCost
							current.contextTokens = update.stats.contextTokens
							current.contextWindow = update.stats.contextWindow
							current.contextUsagePercentage = update.stats.contextUsagePercentage
						}

						try {
							if (update.stats || update.status) {
								await emitRunningStatus(isTerminalSubagentStatus(status))
							}
							if (!subagentCard || !trajectoryChanged || isTerminalSubagentStatus(status)) return

							await subagentCard.update({
								status: subagentCardStatus(status),
								body: stripHashes(
									formatSubagentTrajectory({
										id: current.index,
										name: current.name,
										prompt: current.prompt,
										status,
										trajectory,
									}),
								),
								rawOutput: createSubagentCardOutput(status, trajectory),
							})
						} catch (error) {
							presentationError ??= error as Error
						}
					},
				})

				recordSubagentProgress(trajectory, runResult)
				if (subagentCard) {
					try {
						await subagentCard.update({
							status: subagentCardStatus(runResult.status),
							body: stripHashes(
								formatSubagentTrajectory({
									id: entry.index,
									name: entry.name,
									prompt: entry.prompt,
									status: runResult.status,
									trajectory,
								}),
							),
							rawOutput: createSubagentCardOutput(runResult.status, trajectory),
						})
					} catch (error) {
						presentationError ??= error as Error
					}
					try {
						await subagentCard.finalize(subagentCardStatus(runResult.status))
					} catch (error) {
						presentationError ??= error as Error
					}
				}

				return { runResult, presentationError }
			} catch (error) {
				const message = (error as Error).message || "Subagent execution failed"
				appendSubagentTrajectoryEvent(trajectory, { type: SubagentTrajectoryEventType.ERROR, text: message })
				if (subagentCard) {
					try {
						await subagentCard.update({
							status: CardStatus.ERROR,
							body: formatSubagentTrajectory({
								id: entry.index,
								name: entry.name,
								prompt: entry.prompt,
								status: SubagentExecutionStatus.FAILED,
								trajectory,
							}),
							rawOutput: createSubagentCardOutput(SubagentExecutionStatus.FAILED, trajectory),
						})
					} catch (presentationFailure) {
						presentationError ??= presentationFailure as Error
					}
					try {
						await subagentCard.finalize(CardStatus.ERROR)
					} catch (presentationFailure) {
						presentationError ??= presentationFailure as Error
					}
				}
				if (presentationError) {
					env.logging.warn(`Subagent '${entry.name}' failed with an additional presentation error.`, presentationError)
				}
				throw error
			}
		})

		const presentationErrors: Error[] = []
		const results = await Promise.allSettled(execution)
		results.forEach((result, index) => {
			if (result.status === "rejected") {
				entries[index].status = SubagentExecutionStatus.FAILED
				entries[index].error = (result.reason as Error)?.message || "Subagent execution failed"
				return
			}

			const { runResult, presentationError } = result.value
			entries[index].status = runResult.status
			entries[index].result = runResult.result
			entries[index].error = runResult.error
			entries[index].toolCalls = runResult.stats.toolCalls
			entries[index].inputTokens = runResult.stats.inputTokens
			entries[index].outputTokens = runResult.stats.outputTokens
			entries[index].cacheWrites = runResult.stats.cacheWriteTokens
			entries[index].cacheReads = runResult.stats.cacheReadTokens
			entries[index].totalCost = runResult.stats.totalCost
			entries[index].contextTokens = runResult.stats.contextTokens
			entries[index].contextWindow = runResult.stats.contextWindow
			entries[index].contextUsagePercentage = runResult.stats.contextUsagePercentage
			if (presentationError) presentationErrors.push(presentationError)
		})
		return presentationErrors
	}

	private formatFinalResponse(entries: SubagentStatusItem[]): string {
		const succeeded = entries.filter((entry) => entry.status === SubagentExecutionStatus.COMPLETED).length
		const failed = entries.filter((entry) => entry.status === SubagentExecutionStatus.FAILED).length
		const cancelled = entries.filter((entry) => entry.status === SubagentExecutionStatus.CANCELLED).length
		const totalToolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
		const maxContextTokens = entries.reduce((acc, entry) => Math.max(acc, entry.contextTokens || 0), 0)
		const contextWindow = entries.reduce((acc, entry) => Math.max(acc, entry.contextWindow || 0), 0)
		const maxContextUsagePercentage = entries.reduce((acc, entry) => Math.max(acc, entry.contextUsagePercentage || 0), 0)
		const totalCacheReads = entries.reduce((acc, entry) => acc + (entry.cacheReads || 0), 0)
		const totalCacheWrites = entries.reduce((acc, entry) => acc + (entry.cacheWrites || 0), 0)

		return [
			"Subagent results:",
			`Total: ${entries.length}`,
			`Succeeded: ${succeeded}`,
			`Failed: ${failed}`,
			`Cancelled: ${cancelled}`,
			`Tool calls: ${totalToolCalls}`,
			`Peak context usage: ${maxContextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} (${maxContextUsagePercentage.toFixed(1)}%)`,
			`Cache: ${totalCacheReads.toLocaleString()} reads, ${totalCacheWrites.toLocaleString()} writes`,
			"",
			...entries.map((entry) => {
				const header = `${entry.name} · ${entry.status.toUpperCase()} - ${entry.prompt}`
				const detail = entry.status === SubagentExecutionStatus.COMPLETED ? excerpt(entry.result) : excerpt(entry.error)
				return detail ? `${header}\n${detail}` : header
			}),
		]
			.filter((line): line is string => line !== undefined)
			.join("\n")
	}
	private formatSubagentStatusMarkdown(payload: any): string {
		let md = `### Subagent Status (${payload.completed}/${payload.total})\n\n`
		md += `| Agent | Status | Prompt | Tokens (In/Out) | Cost |\n`
		md += `|-------|--------|--------|-----------------|------|\n`
		payload.items.forEach((item: SubagentStatusItem) => {
			const statusIcon =
				item.status === SubagentExecutionStatus.COMPLETED
					? "✅"
					: item.status === SubagentExecutionStatus.FAILED
						? "❌"
						: item.status === SubagentExecutionStatus.CANCELLED
							? "⊘"
							: "⏳"
			const tokens = `${item.inputTokens.toLocaleString()} / ${item.outputTokens.toLocaleString()}`
			const cost = `$${item.totalCost.toFixed(4)}`
			md += `| ${item.name} | ${statusIcon} ${item.status} | ${item.prompt} | ${tokens} | ${cost} |\n`
		})
		md += `\n**Total Cost:** $${payload.items.reduce((acc: number, i: SubagentStatusItem) => acc + i.totalCost, 0).toFixed(4)}`
		return md
	}
}
