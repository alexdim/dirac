import { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/formatResponse"
import type { ToolRequestSnapshot } from "@core/task/tools/runtime/ToolSnapshot"
import { DiracContent } from "@shared/messages/content"
import { DiracDefaultTool } from "@shared/tools"
import {
	canonicalizeResponseToolCall,
	responseOperationFromToolCall,
	ResponseOperation,
	ResponseParameter,
	ResponseShapeError,
	validateResponseShape,
} from "@shared/responseTool"
import type { ResponseArguments } from "@shared/responseTool"
import type { TaskState } from "../../TaskState"
import type { TaskConfig } from "../types/TaskConfig"
import type { SubagentToolCall } from "./SubagentRunner"
import { SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { createSubagentTrajectoryEvent, SubagentTrajectoryEventType } from "@shared/subagents"
import { formatToolCallPreview, pushSubagentToolResultBlock, serializeToolResult, toToolUseParams } from "./SubagentRunner"

// Executes finalized tool calls for a subagent turn, including intercepted completion, authorization, and dispatch.
// Extracted from SubagentRunner.run() to reduce the 400-line method.
export class SubagentToolExecutor {
	constructor(
		private createSubagentTaskConfig: (state: TaskState, coordinator: any) => TaskConfig,
		private isAllowedTool: (toolName: string, requestSnapshot: ToolRequestSnapshot) => boolean,
	) {}

	// Processes all tool calls for a turn. Returns a completed result for the complete response operation.
	async executeToolCalls(
		finalizedToolCalls: SubagentToolCall[],
		state: TaskState,
		requestSnapshot: ToolRequestSnapshot,
		stats: any,
		onProgress: (update: any) => void,
		isWrappingUp = false,
	): Promise<{ completed?: { result: string; stats: any }; toolResultBlocks: DiracContent[] }> {
		const toolResultBlocks: DiracContent[] = []
		for (const call of finalizedToolCalls) {
			const toolCallBlock: ToolUse = {
				type: "tool_use",
				name: call.name,
				params: toToolUseParams(call.input),
				isNativeToolCall: call.isNativeToolCall,
				call_id: call.call_id || call.toolUseId,
				signature: call.signature,
			}
			try {
				canonicalizeResponseToolCall(toolCallBlock)
			} catch (error) {
				if (!(error instanceof ResponseShapeError)) throw error
				pushSubagentToolResultBlock(toolResultBlocks, call, call.name, formatResponse.toolError(error.message))
				continue
			}
			const toolName = toolCallBlock.name
			const toolCallParams = toolCallBlock.params
			const responseOperation = responseOperationFromToolCall(toolCallBlock)
			const toolCallPreview = formatToolCallPreview(toolName, toolCallParams)
			onProgress({
				latestToolCall: toolCallPreview,
				trajectoryEvent: createSubagentTrajectoryEvent(SubagentTrajectoryEventType.TOOL, toolCallPreview),
			})
			if (responseOperation && !this.isResponseOperationAllowed(responseOperation, requestSnapshot)) {
				pushSubagentToolResultBlock(
					toolResultBlocks,
					call,
					toolName,
					formatResponse.toolError(
						`The '${responseOperation}' response operation is not available inside this subagent run.`,
					),
				)
				continue
			}
			let responseArguments: ResponseArguments | undefined
			if (responseOperation) {
				try {
					responseArguments = validateResponseShape(toolCallParams)
				} catch (error) {
					if (!(error instanceof ResponseShapeError)) throw error
					pushSubagentToolResultBlock(toolResultBlocks, call, toolName, formatResponse.toolError(error.message))
					continue
				}
			}
			if (responseOperation === ResponseOperation.PROGRESS) {
				onProgress({
					trajectoryEvent: createSubagentTrajectoryEvent(
						SubagentTrajectoryEventType.MESSAGE,
						responseArguments!.text,
					),
				})
			}

			if (responseOperation === ResponseOperation.COMPLETE) {
				const completionResult = responseArguments!.text.trim()
				stats.toolCalls += 1
				onProgress({ stats: { ...stats } })
				onProgress({ status: SubagentExecutionStatus.COMPLETED, result: completionResult, stats: { ...stats } })
				return { completed: { result: completionResult, stats: { ...stats } }, toolResultBlocks }
			}

			if (isWrappingUp) {
				const result = formatResponse.toolError(
					'Research is no longer available because the deadline expired. Call respond with operation "complete" and your partial findings now.',
				)
				onProgress({
					trajectoryEvent: createSubagentTrajectoryEvent(SubagentTrajectoryEventType.TOOL_RESULT, result),
				})
				pushSubagentToolResultBlock(toolResultBlocks, call, `[${toolName}]`, result)
				continue
			}

			// Denied tool
			if (!this.isAllowedTool(toolName, requestSnapshot)) {
				pushSubagentToolResultBlock(
					toolResultBlocks,
					call,
					toolName,
					formatResponse.toolError(`Tool '${toolName}' is not available inside subagent runs.`),
				)
				continue
			}

			// Dispatch to coordinator
			if (call.call_id) state.toolUseIdMap.set(call.call_id, call.toolUseId)
			const subagentConfig = this.createSubagentTaskConfig(state, requestSnapshot.coordinator)
			let toolResult: unknown
			if (!subagentConfig.coordinator.has(toolName)) {
				toolResult = formatResponse.toolError(`No handler registered for tool '${toolName}'.`)
			} else {
				try {
					toolResult = await subagentConfig.coordinator.execute(subagentConfig, toolCallBlock)
				} catch (error) {
					toolResult = formatResponse.toolError((error as Error).message)
				}
			}

			stats.toolCalls += 1
			onProgress({ stats: { ...stats } })
			const serializedToolResult = serializeToolResult(toolResult)
			onProgress({
				trajectoryEvent: createSubagentTrajectoryEvent(SubagentTrajectoryEventType.TOOL_RESULT, serializedToolResult),
			})
			pushSubagentToolResultBlock(toolResultBlocks, call, `[${toolName}]`, serializedToolResult)
		}
		return { toolResultBlocks }
	}

	private isResponseOperationAllowed(operation: ResponseOperation, snapshot: ToolRequestSnapshot): boolean {
		const spec = snapshot.promptVisibleSpecs.find((candidate) => candidate.name === DiracDefaultTool.RESPOND)
		const allowed = spec?.parameters?.find((parameter) => parameter.name === ResponseParameter.OPERATION)?.enum
		return Array.isArray(allowed) && allowed.includes(operation)
	}
}
