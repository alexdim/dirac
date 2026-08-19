import { ICardHandle, IToolEnvironment } from "../../interfaces/IToolEnvironment"
import { CardHeader } from "@shared/cardIdentity"
import { DiracDefaultTool } from "@/shared/tools"
import { DiracIcon } from "@/shared/icons"
import { CardKind, CardStatus, DiracMessageType, SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { waitForPresentationOperation } from "../../subagent/PresentationDeadline"
import { ResponseOperation, responseCardInput } from "@shared/responseTool"
import {
	allocateSubagentIdentity,
	createSubagentCardInput,
	createSubagentCardOutput,
	formatSubagentTrajectory,
	isTerminalSubagentStatus,
	recordSubagentProgress,
	subagentCardStatus,
	type SubagentTrajectoryEvent,
} from "@shared/subagents"

export class CompletionResponseOperation {
	async execute(result: string, env: IToolEnvironment): Promise<any> {
		const doubleCheckResponse = await this.handleDoubleCheckCompletion(env, result)
		if (doubleCheckResponse) {
			return doubleCheckResponse
		}

		env.orchestration.setTaskState("doubleCheckCompletionPending", false)

		if (!(await env.orchestration.commitAttemptCompletion())) {
			return result
		}

		try {
			await this.handleCompletionResult(env, result)
			await env.orchestration.runHook("TaskComplete", {
				taskComplete: {
					taskMetadata: {
						taskId: env.config.taskId,
						ulid: env.config.ulid,
						result,
					},
				},
			})
		} catch (error) {
			env.logging.warn("Completion was committed, but a completion artifact failed", error)
		}

		try {
			if (!env.config.isSubagentExecution && env.config.autoApprovalSettings.enableNotifications) {
				env.system.showNotification({
					subtitle: "Task Completed",
					message: result.replace(/\n/g, " "),
				})
			}
			if (!env.config.isSubagentExecution) {
				env.telemetry.captureTaskCompleted()
				await env.orchestration.runHook("Notification", {
					notification: {
						event: "task_completed",
						source: `${DiracDefaultTool.RESPOND}:${ResponseOperation.COMPLETE}`,
						message: result,
						waitingForUserInput: true,
					},
				})
			}
		} catch (error) {
			env.logging.warn("Completion succeeded, but a completion notification failed", error)
		}
		env.telemetry.captureCustomMetadata({ operation: ResponseOperation.COMPLETE, mode: env.config.mode })

		return result
	}

	private async handleDoubleCheckCompletion(env: IToolEnvironment, result: string): Promise<any | undefined> {
		if (!env.config.doubleCheckCompletionEnabled || env.orchestration.getTaskState("doubleCheckCompletionPending")) {
			return undefined
		}

		const subagentsEnabled = env.config.subagentsEnabled
		if (subagentsEnabled) {
			return await this.runVerificationSubagent(env, result)
		}

		env.orchestration.setTaskState("doubleCheckCompletionPending", true)
		const verificationInstructions = `1. All requested changes have been made (verify using a test script/\`execute_command\` when possible)
2. No steps were skipped or partially completed
3. Edge cases and error handling are addressed
4. The solution matches what was asked for, not just what was convenient
5. Output files contain exactly what was specified - no extra columns, fields, debug output, or commentary
6. If the task specifies numerical thresholds or accuracy targets, verify your result meets the criteria. If close but not passing, iterate rather than declaring completion`

		const history = env.orchestration.getHistory()
		const firstTaskMsgObj = history.find(
			(m) => m.content.type === DiracMessageType.MARKDOWN && m.content.content.includes("<task>"),
		)
		const firstTaskMessage =
			firstTaskMsgObj?.content.type === DiracMessageType.MARKDOWN ? firstTaskMsgObj.content.content.trim() : undefined
		const taskPreview = firstTaskMessage
			? firstTaskMessage.length > 8000
				? firstTaskMessage.slice(0, 8000) + "\n...[truncated]"
				: firstTaskMessage
			: ""
		const taskSection = taskPreview ? `\n\n<initial_task>\n${taskPreview}\n</initial_task>` : ""

		return `Verification Required: User wants you to fully verify your solution before submitting.

<verification_checklist>
${verificationInstructions}
</verification_checklist>${taskSection}

If everything checks out, call respond with operation "complete" and your final result.`
	}

	private async runVerificationSubagent(env: IToolEnvironment, result: string): Promise<any | undefined> {
		const history = env.orchestration.getHistory()
		const identity = allocateSubagentIdentity(history)
		const trajectory: SubagentTrajectoryEvent[] = []
		const taskTitle = "Verifying task completion"
		const firstTaskMsgObjSub = history.find(
			(message) => message.content.type === DiracMessageType.MARKDOWN && message.content.content.includes("<task>"),
		)
		const firstTaskMessage =
			firstTaskMsgObjSub?.content.type === DiracMessageType.MARKDOWN ? firstTaskMsgObjSub.content.content.trim() : undefined
		const taskPreview = firstTaskMessage
			? firstTaskMessage.length > 8000
				? firstTaskMessage.slice(0, 8000) + "\n...[truncated]"
				: firstTaskMessage
			: "No task description available."

		const subagentPrompt = `You are the verifier of a given solution. Please verify the following task completion.

<initial_task>
${taskPreview}
</initial_task>

<completion_result>
${result}
</completion_result>

<verification_checklist>
1. All requested changes have been made (verify using a test script/\`execute_command\` when possible)
2. No steps were skipped or partially completed
3. Edge cases and error handling are addressed
4. The solution matches what was asked for, not just what was convenient
5. Output files contain exactly what was specified - no extra columns, fields, debug output, or commentary
6. If the task specifies numerical thresholds or accuracy targets, verify your result meets the criteria. If close but not passing, iterate rather than declaring completion
</verification_checklist>

If the solution passes all checks, respond with "VERIFICATION: SUCCESS".
Otherwise, respond with "VERIFICATION: FAILED" followed by all the details on what failed.`

		let card: ICardHandle | undefined
		if (!env.config.isSubagentExecution) {
			const cardPromise = env.ui.createCard({
				header: taskTitle,
				icon: DiracIcon.COMPLETE,
				status: CardStatus.RUNNING,
				collapsed: true,
				renderType: "markdown",
				autoScroll: true,
				rawInput: createSubagentCardInput(identity, subagentPrompt, taskTitle),
				rawOutput: createSubagentCardOutput(SubagentExecutionStatus.RUNNING, trajectory),
				body: formatSubagentTrajectory({
					...identity,
					prompt: subagentPrompt,
					status: SubagentExecutionStatus.RUNNING,
					trajectory,
				}),
			})
			const cardCreation = await waitForPresentationOperation(cardPromise)
			if (cardCreation.timedOut) {
				env.logging.warn("Verification subagent card creation timed out.")
				void cardPromise
					.then((lateCard) => lateCard.finalize(CardStatus.ABANDONED))
					.catch((error) => env.logging.warn("Late verification subagent card cleanup failed.", error))
			} else {
				card = cardCreation.value
			}
		}

		let discardQueuedPresentationUpdates = false
		let presentationUpdates = Promise.resolve()
		let presentationError: Error | undefined
		const enqueuePresentationUpdate = (present: () => Promise<void>) => {
			presentationUpdates = presentationUpdates
				.then(async () => {
					if (discardQueuedPresentationUpdates) return
					await present()
				})
				.catch((error) => {
					presentationError ??= error as Error
				})
		}
		const runCardOperation = async (operation: Promise<void>, timeoutMessage: string) => {
			let operationError: Error | undefined
			const observedOperation = operation.catch((error) => {
				operationError = error as Error
			})
			const outcome = await waitForPresentationOperation(observedOperation)
			if (outcome.timedOut) presentationError ??= new Error(timeoutMessage)
			else if (operationError) presentationError ??= operationError
		}

		const runResult = await env.orchestration.runSubagent(subagentPrompt, {
			subagentName: "verifier",
			agentIdentity: identity,
			taskTitle,
			onUpdate: (update) => {
				if (update.trajectoryEvent === undefined && update.status === undefined) return
				const status = recordSubagentProgress(trajectory, update)
				if (!card || isTerminalSubagentStatus(status)) return
				const patch = {
					status: subagentCardStatus(status),
					body: formatSubagentTrajectory({ ...identity, prompt: subagentPrompt, status, trajectory }),
					rawOutput: createSubagentCardOutput(status, trajectory),
				}
				enqueuePresentationUpdate(() => card!.update(patch))
			},
		})

		recordSubagentProgress(trajectory, runResult)
		if (card) {
			const finalPatch = {
				status: subagentCardStatus(runResult.status),
				body: formatSubagentTrajectory({ ...identity, prompt: subagentPrompt, status: runResult.status, trajectory }),
				rawOutput: createSubagentCardOutput(runResult.status, trajectory),
			}
			const applyTerminalCardState = async () => {
				await runCardOperation(card!.update(finalPatch), "Verification subagent final card update timed out.")
				await runCardOperation(
					card!.finalize(subagentCardStatus(runResult.status)),
					"Verification subagent card finalization timed out.",
				)
			}
			const intermediateUpdates = await waitForPresentationOperation(presentationUpdates)
			if (intermediateUpdates.timedOut) {
				discardQueuedPresentationUpdates = true
				presentationError ??= new Error("Verification subagent presentation did not drain before the timeout.")
				void presentationUpdates
					.then(applyTerminalCardState)
					.catch((error) => env.logging.warn("Late verification subagent terminal replay failed.", error))
			}
			await applyTerminalCardState()
		}
		if (presentationError) {
			env.logging.warn("Verification subagent completed with a presentation error.", presentationError)
		}

		if (runResult.status !== SubagentExecutionStatus.COMPLETED) {
			return `Verification Subagent Failed:\n${runResult.error}\n\nPlease verify the task manually or try again.`
		}
		if (runResult.result?.includes("VERIFICATION: SUCCESS")) return undefined
		return `Verification Subagent Report:\n${runResult.result}\n\nThe solution could not be verified successfully. Please address the issues listed above and try again.`
	}

	private async handleCompletionResult(env: IToolEnvironment, result: string): Promise<void> {
		const card = await env.ui.createCard({
			kind: CardKind.TASK_COMPLETION,
			toolName: DiracDefaultTool.RESPOND,
			icon: DiracIcon.COMPLETE,
			header: CardHeader.TASK_COMPLETED,
			body: result,
			rawInput: responseCardInput(ResponseOperation.COMPLETE, result),
			renderType: "markdown",
			collapsed: false,
			maxHeight: 1200,
		})
		await card.finalize(CardStatus.SUCCESS, true)
		await env.orchestration.saveCheckpoint(true, card.id)
	}
}
