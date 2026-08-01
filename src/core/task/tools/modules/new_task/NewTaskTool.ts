import { formatResponse } from "@core/formatResponse"
import { buildTaskHandoffIntentSource, TASK_HANDOFF_TEMPLATE_ID } from "@core/text-condensation/templates"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { DiracIcon } from "@shared/icons"
import { telemetryService } from "@/services/telemetry"
import { CardStatus } from "@/shared/ExtensionMessage"
import { DiracDefaultTool, DiracToolSpec } from "@/shared/tools"
import { IDiracTool } from "../../interfaces/IDiracTool"
import { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export const new_task_spec: DiracToolSpec = {
	id: DiracDefaultTool.NEW_TASK,
	name: "new_task",
	description: "Creates a replacement task with a standalone implementation handoff.",
	promptDescription: (context) =>
		context.taskHandoffCondensationAvailable === true
			? "Creates a replacement task from a concise intent. Provide only the desired objective and scope; a Utility model with access to the current task's conversation history will generate the complete standalone handoff for user preview."
			: "Creates a replacement task from a complete standalone implementation handoff that you generate. The replacement task will not have access to this conversation.",
	parameters: [
		{
			name: "context",
			required: true,
			contextRequirements: (context) => context.taskHandoffCondensationAvailable !== true,
			instruction:
				"Complete standalone implementation handoff for the replacement task. Include the objective, user intent, settled decisions, constraints, current state, findings, exact relevant files and symbols, completed work, and ordered next steps. The replacement task cannot access this conversation.",
		},
		{
			name: "intent",
			required: true,
			contextRequirements: (context) => context.taskHandoffCondensationAvailable === true,
			instruction:
				"Only the desired objective and scope for the replacement task. Use one or two short sentences and no more than 40 words. Do not summarize conversation history, implementation details, files, findings, or completed work; the Utility model will derive those from the current task's conversation history.",
		},
	],
}

export class NewTaskTool implements IDiracTool {
	spec(): DiracToolSpec {
		return new_task_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(args: any, env: IToolEnvironment): Promise<any> {
		const signal = env.orchestration.getTaskState("abortSignal")
		const suppliedContext = this.nonEmptyString(args.context)
		const intent = this.nonEmptyString(args.intent)

		if (suppliedContext && intent) {
			this.incrementMistakeCount(env)
			return formatResponse.toolError("Provide exactly one parameter: context or intent")
		}

		let context = suppliedContext
		if (!context && intent) {
			const condensation = env.conversationCondensation
			if (!condensation?.isAvailable(TASK_HANDOFF_TEMPLATE_ID)) {
				return formatResponse.toolResult(
					"Utility task-handoff generation is no longer available. Call `new_task` again using the schema shown in the next request.",
				)
			}

			context = await this.generateTaskHandoff(intent, signal, condensation.condenseConversation, env)
			this.throwIfCancelled(signal)
			if (!context) {
				return formatResponse.toolResult(
					"Utility task-handoff generation failed. Retry `new_task` with the same concise intent, or fix/disable the configured Utility model and follow the schema shown in the next request.",
				)
			}
		}

		if (!context) {
			const parameter = env.conversationCondensation?.isAvailable(TASK_HANDOFF_TEMPLATE_ID) ? "intent" : "context"
			this.incrementMistakeCount(env)
			return formatResponse.toolError(`Missing required parameter: ${parameter}`)
		}

		env.orchestration.setTaskState("consecutiveMistakeCount", 0)
		if (!env.config.isSubagentExecution && env.config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Dirac wants to start a new task...",
				message: `Dirac is suggesting to start a new task with: ${context}`,
			})
		}

		const cardHandle = await env.ui.createCard({
			header: "New Task",
			icon: DiracIcon.CHAT,
			requireApproval: true,
			requireFeedback: true,
			rawInput: { tool: DiracDefaultTool.NEW_TASK },
			body: context,
			renderType: "markdown",
			actions: [{ label: "Approve New Task", value: DiracDefaultTool.NEW_TASK, primary: true }],
			collapsed: false,
			maxHeight: 1200,
			do_not_auto_collapse: true,
		})
		const { response, value, text, images, files: newTaskFiles } = await cardHandle.waitForInteraction()
		this.throwIfCancelled(signal)

		const apiConfig = env.config.services.stateManager.getApiConfiguration()
		const provider = (env.config.mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const hasFeedback = !!text || !!images?.length || !!newTaskFiles?.length
		const approvedReplacement = response === "approve" && value === DiracDefaultTool.NEW_TASK

		if (!approvedReplacement || hasFeedback) {
			let fileContentString = ""
			if (newTaskFiles && newTaskFiles.length > 0) {
				fileContentString = await processFilesIntoText(newTaskFiles)
				this.throwIfCancelled(signal)
			}
			await env.ui.upsertText(text ?? "", false, "user")
			await cardHandle.finalize(CardStatus.CANCELLED)
			telemetryService.captureToolUsage(
				env.config.ulid,
				this.spec().id,
				env.config.api.getModel().id,
				provider,
				false,
				false,
				undefined,
				true,
			)
			return formatResponse.toolResult(
				`The user provided feedback instead of creating a new task:\n<feedback>\n${text ?? ""}\n</feedback>`,
				images,
				fileContentString,
			)
		}

		this.throwIfCancelled(signal)
		env.orchestration.requestTaskReplacement(context)

		try {
			await cardHandle.update({
				header: "New Task Created",
				collapsed: true,
			})
			await cardHandle.finalize(CardStatus.SUCCESS)
		} catch (error) {
			env.logging.warn("Failed to present completed task replacement", error)
		}

		return formatResponse.toolResult("The user has created a new task with the provided context.")
	}

	private nonEmptyString(value: unknown): string | undefined {
		if (typeof value !== "string") return undefined
		const trimmed = value.trim()
		return trimmed.length > 0 ? trimmed : undefined
	}

	private incrementMistakeCount(env: IToolEnvironment): void {
		env.orchestration.setTaskState(
			"consecutiveMistakeCount",
			env.orchestration.getTaskState("consecutiveMistakeCount") + 1,
		)
	}

	private throwIfCancelled(signal: AbortSignal): void {
		if (signal.aborted) throw new Error("Task instance aborted")
	}

	private async generateTaskHandoff(
		intent: string,
		signal: AbortSignal,
		condenseConversation: NonNullable<IToolEnvironment["conversationCondensation"]>["condenseConversation"],
		env: IToolEnvironment,
	): Promise<string | undefined> {
		try {
			const generatedContext = await condenseConversation(TASK_HANDOFF_TEMPLATE_ID, {
				signal,
				additionalSourceText: buildTaskHandoffIntentSource(intent),
			})
			this.throwIfCancelled(signal)
			if (generatedContext.trim().length === 0) {
				throw new Error("Utility handoff generation returned empty context")
			}
			return generatedContext
		} catch (error) {
			if (signal.aborted) throw error
			env.logging.warn("Utility task handoff generation failed", error)
			return undefined
		}
	}
}
