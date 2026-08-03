import type { DiracToolSpec } from "@shared/tools"
import { DiracDefaultTool } from "@shared/tools"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"
import { CompletionResponseOperation } from "./CompletionResponseOperation"
import { presentPlanForApproval } from "./PlanResponseOperation"
import { presentProgressResponse } from "./ProgressResponseOperation"
import { requestQuestionResponse } from "./QuestionResponseOperation"
import { validateResponseArguments } from "./ResponseArgumentsValidator"
import { RESPONSE_OPERATIONS, ResponseOperation, ResponseParameter } from "@shared/responseTool"

export const respondSpec: DiracToolSpec = {
	id: DiracDefaultTool.RESPOND,
	name: DiracDefaultTool.RESPOND,
	description:
		"Provides progress updates, questions, plans, and completion results. Disabling it removes every user-response operation.",
	promptDescription: "Send a user-facing response.",
	parameters: [
		{
			name: ResponseParameter.OPERATION,
			type: "string",
			required: true,
			enum: RESPONSE_OPERATIONS,
			instruction:
				"progress = interim update; complete = final Act Mode result; plan = Plan Mode response/proposal; question = required user input.",
		},
		{
			name: ResponseParameter.TEXT,
			type: "string",
			required: true,
			instruction: "Response text.",
		},
		{
			name: ResponseParameter.OPTIONS,
			type: "array",
			items: { type: "string" },
			minItems: 2,
			maxItems: 5,
			required: false,
			instruction: "Question choices; omit otherwise.",
		},
	],
}

export class RespondTool implements IDiracTool {
	private readonly completion = new CompletionResponseOperation()

	spec(): DiracToolSpec {
		return respondSpec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(args: unknown, env: IToolEnvironment): Promise<any> {
		const request = validateResponseArguments(args, env)
		env.telemetry.captureCustomMetadata({
			operation: request.operation,
			textLength: request.text.length,
			mode: env.config.mode,
			...(request.operation === ResponseOperation.QUESTION ? { optionCount: request.options?.length ?? 0 } : {}),
		})
		switch (request.operation) {
			case ResponseOperation.PROGRESS:
				return presentProgressResponse(request.text, env)
			case ResponseOperation.QUESTION:
				return requestQuestionResponse(request.text, request.options ?? [], env)
			case ResponseOperation.PLAN:
				return presentPlanForApproval(request.text, env)
			case ResponseOperation.COMPLETE:
				return this.completion.execute(request.text, env)
		}
	}
}
