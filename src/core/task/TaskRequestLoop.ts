import { ErrorService } from "@services/error"
import { telemetryService } from "@services/telemetry"

import { findLastIndex } from "@shared/array"
import type { DiracApiReqCancelReason, DiracMessageContent } from "@shared/ExtensionMessage"
import { CardStatus, DiracMessageType, TaskStatus } from "@shared/ExtensionMessage"
import { Session } from "@shared/services/Session"
import { isLocalModel } from "@utils/model-utils"
import type { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import type { LocalConversationCompaction } from "./LocalConversationCompaction"

import type { ModelContextTracker } from "@core/context/context-tracking/ModelContextTracker"
import type { ResponseProcessor } from "./ResponseProcessor"
import { StreamChunkCoordinator } from "./StreamChunkCoordinator"
import { StreamingMetricsManager } from "./StreamingMetricsManager"
import type { StreamResponseHandler } from "./StreamResponseHandler"

import type { DiracContent } from "@shared/messages/content"
import type { DiracMessageModelInfo } from "@shared/messages/metrics"
import { Logger } from "@shared/services/Logger"
import { type TaskRequestBuilderContext } from "./TaskRequestBuilder"
import {
	persistApiStopReason,
	processStreamResult,
	type TaskRequestOutcomeContext,
} from "./TaskRequestOutcome"
import { attemptApiRequest } from "./TaskApiRequestAttempt"
import {
	appendQueuedSteeringToUserContent,
	rollbackSteeringClaim,
	settleConsumedSteeringClaim,
	type TaskSteeringContext,
} from "./TaskSteering"
import type { ApiConversationManager } from "./ApiConversationManager"

export interface TaskRequestLoopContext extends TaskRequestBuilderContext, TaskRequestOutcomeContext {
	steeringContext: TaskSteeringContext
	handleMistakeLimitReached: (userContent: DiracContent[]) => Promise<{ didEndLoop: boolean; userContent: DiracContent[] }>
	enqueuePreRequestSteeringMessages: () => Promise<void>
	resetStreamingState: () => Promise<void>
	initializeCheckpoints: (isFirstRequest: boolean) => Promise<void>
	determineContextCompaction: (previousApiReqIndex: number) => Promise<boolean>
	localConversationCompaction: LocalConversationCompaction
	responseProcessor: ResponseProcessor
	streamHandler: StreamResponseHandler
	modelContextTracker: ModelContextTracker
	diffViewProvider: DiffViewProvider
	ulid: string
}

export async function recursivelyMakeDiracRequests(
	ctx: TaskRequestLoopContext,
	userContent: DiracContent[],
	includeFileDetails = false,
): Promise<boolean> {
	ctx.taskState.status = TaskStatus.PREPARING

	if (ctx.taskState.abort) {
		throw new Error("Task instance aborted")
	}
	await ctx.enqueuePreRequestSteeringMessages()

	const { model, providerId, customPrompt, mode } = ctx.getCurrentProviderInfo()
	if (providerId && model.id) {
		try {
			await ctx.modelContextTracker.recordModelUsage(providerId, model.id, mode)
		} catch (error) {
			Logger.error("Failed to record model usage:", error)
		}
	}

	const modelInfo: DiracMessageModelInfo = {
		modelId: model.id,
		providerId: providerId,
		mode: mode,
	}

	const mistakeResult = await ctx.handleMistakeLimitReached(userContent)
	if (mistakeResult.didEndLoop) {
		return true
	}
	userContent = mistakeResult.userContent

	const previousApiReqIndex = findLastIndex(
		ctx.messageStateHandler.getDiracMessages(),
		(m) => m.content.type === DiracMessageType.API_STATUS
	)
	const isFirstRequest =
		ctx.messageStateHandler.getDiracMessages().filter((m) => m.content.type === DiracMessageType.API_STATUS).length === 0

	await ctx.initializeCheckpoints(isFirstRequest)

	const useCompactPrompt = customPrompt === "compact" && isLocalModel(ctx.getCurrentProviderInfo())
	let shouldCompact = await ctx.determineContextCompaction(previousApiReqIndex)
	if (shouldCompact && ctx.localConversationCompaction.isAvailable()) {
		const continuation = await ctx.localConversationCompaction.run({
			source: "automatic",
			triggerApiRequestIndex: previousApiReqIndex,
		})
		if (!continuation) return true

		const compactedContext: DiracContent[] = [{ type: "text", text: continuation }]
		if (ctx.taskState.pinnedContext) {
			compactedContext.push({ type: "text", text: ctx.taskState.pinnedContext })
		}
		userContent = [...compactedContext, ...userContent]
		shouldCompact = false
	}
	const steeringClaim = await appendQueuedSteeringToUserContent(ctx.steeringContext, userContent)

	ctx.taskState.status = TaskStatus.BUILDING_REQUEST

	let apiRequestData: Awaited<ReturnType<ApiConversationManager["prepareApiRequest"]>>
	let steeringClaimConsumed = false
	try {
		apiRequestData = await ctx.apiConversationManager.prepareApiRequest({
			userContent,
			shouldCompact,
			includeFileDetails,
			useCompactPrompt,
			previousApiReqIndex,
			isFirstRequest,
			providerId,
			modelId: model.id,
			mode: modelInfo.mode,
			afterUserContentPersisted: async () => {
				steeringClaimConsumed = true
				if (!steeringClaim) return
				await settleConsumedSteeringClaim(ctx.steeringContext, steeringClaim)
			},
		})
		if (steeringClaim && !steeringClaimConsumed) {
			if (apiRequestData.didConsumeUserContent) {
				steeringClaimConsumed = true
				await settleConsumedSteeringClaim(ctx.steeringContext, steeringClaim)
			} else {
				await rollbackSteeringClaim(ctx.steeringContext, steeringClaim.id)
			}
		}
	} catch (error) {
		if (steeringClaim && !steeringClaimConsumed) await rollbackSteeringClaim(ctx.steeringContext, steeringClaim.id)
		throw error
	}
	userContent = apiRequestData.userContent
	const lastApiReqIndex = apiRequestData.lastApiReqIndex

	if (apiRequestData.isDirectResponse) {
		if (apiRequestData.directResponseText) {
			await ctx.taskMessenger.upsertText(apiRequestData.directResponseText)
		}
		return true
	}

	try {
		const metricsManager = new StreamingMetricsManager(ctx.messageStateHandler, lastApiReqIndex, ctx.api)
		let didFinalizeApiReqMsg = false
		let usageChunkSideEffectsQueue = Promise.resolve()

		const queueUsageChunkSideEffects = (
			usageInputTokens: number,
			usageOutputTokens: number,
			chunkOptions?: { cacheWriteTokens?: number; cacheReadTokens?: number; totalCost?: number; stopReason?: string },
		) => {
			usageChunkSideEffectsQueue = usageChunkSideEffectsQueue.then(async () => {
				if (didFinalizeApiReqMsg || ctx.taskState.abort) {
					return
				}

				await metricsManager.updateApiReqMsgFromMetrics()
				await ctx.postStateToWebview()
				await telemetryService.captureTokenUsage(
					ctx.ulid,
					usageInputTokens,
					usageOutputTokens,
					providerId,
					model.id,
					chunkOptions,
				)
			})
		}

		const finalizeApiReqMsg = async (cancelReason?: DiracApiReqCancelReason, streamingFailedMessage?: string) => {
			didFinalizeApiReqMsg = true
			await usageChunkSideEffectsQueue
			await metricsManager.updateApiReqMsgFromMetrics(cancelReason, streamingFailedMessage)

			const metrics = metricsManager.getMetrics()
			ctx.taskState.totalInputTokens += metrics.inputTokens
			ctx.taskState.totalOutputTokens += metrics.outputTokens
			ctx.taskState.totalReasoningTokens += metrics.reasoningTokens
			ctx.taskState.totalCacheWriteTokens += metrics.cacheWriteTokens
			ctx.taskState.totalCacheReadTokens += metrics.cacheReadTokens
			const cost = metricsManager.getTotalCost()
			if (cost !== undefined) ctx.taskState.totalCost += cost

			const currentApiReqIndex = findLastIndex(
				ctx.messageStateHandler.getDiracMessages(),
				(m) => m.content.type === DiracMessageType.API_STATUS,
			)
			if (currentApiReqIndex !== -1) {
				ctx.taskState.isApiRequestActive = false
				ctx.taskState.activeVoiceStreamId = undefined
			}
		}

		const abortStream = async (cancelReason: DiracApiReqCancelReason, streamingFailedMessage?: string) => {
			Session.get().finalizeRequest()

			if (ctx.diffViewProvider.isEditing) {
				await ctx.diffViewProvider.revertChanges()
			}

			ctx.taskState.isApiRequestActive = false
			ctx.taskState.activeVoiceStreamId = undefined
			await finalizeApiReqMsg(cancelReason, streamingFailedMessage)
			await ctx.messageStateHandler.saveDiracMessagesAndUpdateHistory()

			const metrics = metricsManager.getMetrics()
			await ctx.messageStateHandler.addToApiConversationHistory({
				role: "assistant",
				content: [
					{
						type: "text",
						text:
							assistantMessage +
							`\n\n[${cancelReason === "streaming_failed"
								? "Response interrupted by API Error"
								: "Response interrupted by user"
							}]`,
					},
				],
				modelInfo,
				metrics: {
					tokens: {
						prompt: metrics.inputTokens,
						completion: metrics.outputTokens,
						cached: (metrics.cacheWriteTokens ?? 0) + (metrics.cacheReadTokens ?? 0),
					},
					cost: metrics.totalCost,
				},
				ts: Date.now(),
			})

			telemetryService.captureConversationTurnEvent(
				ctx.ulid,
				providerId,
				modelInfo.modelId,
				"assistant",
				modelInfo.mode,
				undefined,
				ctx.taskState.useNativeToolCalls,
			)

			ctx.taskState.didFinishAbortingStream = true
		}

		await ctx.resetStreamingState()

		const { toolUseHandler, reasonsHandler } = ctx.streamHandler.getHandlers()
		const stream = attemptApiRequest(ctx, previousApiReqIndex, lastApiReqIndex, shouldCompact)

		let assistantMessageId = ""
		let assistantMessage = ""
		let assistantTextOnly = ""
		let assistantTextSignature: string | undefined

		let didReceiveUsageChunk = false
		let stopReason: string | undefined
		let didFinalizeReasoningForUi = false

		const finalizePendingReasoningMessage = async (thinking: string): Promise<boolean> => {
			const activeVoiceStreamId = ctx.taskState.activeVoiceStreamId
			if (!activeVoiceStreamId) {
				return false
			}

			const messages = ctx.messageStateHandler.getDiracMessages()
			const pendingReasoningIndex = messages.findIndex((m) => m.id === activeVoiceStreamId)

			if (pendingReasoningIndex !== -1) {
				const msg = messages[pendingReasoningIndex]
				if (msg.content.type === DiracMessageType.MARKDOWN && msg.content.isReasoning) {
					await ctx.messageStateHandler.updateDiracMessage(pendingReasoningIndex, {
						content: { type: DiracMessageType.MARKDOWN, content: thinking, isReasoning: true },
					})
					const completedReasoning = ctx.messageStateHandler.getDiracMessages()[pendingReasoningIndex]
					if (completedReasoning) {
						await ctx.postStateToWebview()
					}
					ctx.taskState.activeVoiceStreamId = undefined
					return true
				}
			}
			return false
		}

		Session.get().startApiCall()
		ctx.taskState.isApiRequestActive = true
		let streamCoordinator: StreamChunkCoordinator | undefined

		try {
			streamCoordinator = new StreamChunkCoordinator(stream, {
				onUsageChunk: (chunk) => {
					ctx.streamHandler.setRequestId(chunk.id)
					didReceiveUsageChunk = true
					metricsManager.updateFromChunk(chunk)
					stopReason = chunk.stopReason ?? stopReason
					queueUsageChunkSideEffects(chunk.inputTokens, chunk.outputTokens, {
						cacheWriteTokens: chunk.cacheWriteTokens,
						cacheReadTokens: chunk.cacheReadTokens,
						totalCost: chunk.totalCost,
						stopReason: chunk.stopReason,
					})
				},
			})

			const streamResult = await ctx.responseProcessor.consumeStream(streamCoordinator, {
				abortStream,
				finalizePendingReasoningMessage,
				apiAbort: () => ctx.api.abort?.(),
			})

			assistantMessage = streamResult.assistantMessage
			assistantTextOnly = streamResult.assistantTextOnly
			assistantTextSignature = streamResult.assistantTextSignature
			assistantMessageId = streamResult.assistantMessageId
			didFinalizeReasoningForUi = streamResult.didFinalizeReasoningForUi
			const shouldInterruptStream = streamResult.shouldInterruptStream

			if (shouldInterruptStream) {
				await streamCoordinator.stop()
			} else {
				await streamCoordinator.waitForCompletion()
			}
			await usageChunkSideEffectsQueue

			if (!ctx.taskState.abort && !didFinalizeReasoningForUi) {
				const finalReasoning = reasonsHandler.getCurrentReasoning()
				if (finalReasoning?.thinking) {
					await finalizePendingReasoningMessage(finalReasoning.thinking)
					didFinalizeReasoningForUi = true
				}
			}
		} catch (error) {
			await streamCoordinator?.stop()
			if (ctx.taskState.abort || ctx.taskState.abandoned) {
				return true
			}

			const diracError = ErrorService.get().toDiracError(error, ctx.api.getModel().id)
			const errorMessage = diracError.serialize()
			await ctx.abortTask()
			await abortStream("streaming_failed", errorMessage)
			await ctx.reinitExistingTaskFromId()
			return true
		} finally {
			Session.get().endApiCall()
		}

		if (!didReceiveUsageChunk) {
			const apiStreamUsage = await ctx.api.getApiStreamUsage?.()
			if (apiStreamUsage) {
				metricsManager.updateFromChunk(apiStreamUsage)
				queueUsageChunkSideEffects(apiStreamUsage.inputTokens, apiStreamUsage.outputTokens, {
					cacheWriteTokens: apiStreamUsage.cacheWriteTokens,
					cacheReadTokens: apiStreamUsage.cacheReadTokens,
					totalCost: apiStreamUsage.totalCost,
					stopReason: apiStreamUsage.stopReason,
				})
			}
		}

		const autoRetryApiReqIndex = findLastIndex(
			ctx.messageStateHandler.getDiracMessages(),
			(m) => m.content.type === DiracMessageType.API_STATUS,
		)
		if (autoRetryApiReqIndex !== -1) {
			const diracMessages = ctx.messageStateHandler.getDiracMessages()
			const msg = diracMessages[autoRetryApiReqIndex]
			if (msg.content.type === DiracMessageType.API_STATUS) {
				const content = msg.content as Extract<DiracMessageContent, { type: DiracMessageType.API_STATUS }>
				const currentApiReqInfo = { ...content.status }
				delete currentApiReqInfo.retryStatus
				await ctx.messageStateHandler.updateDiracMessage(autoRetryApiReqIndex, {
					content: {
						type: DiracMessageType.API_STATUS,
						status: currentApiReqInfo,
					},
				})
			}
		}

		await finalizeApiReqMsg()
		await persistApiStopReason(ctx, stopReason)
		await ctx.messageStateHandler.saveDiracMessagesAndUpdateHistory()
		await ctx.postStateToWebview()

		if (ctx.taskState.abort) {
			throw new Error("Dirac instance aborted")
		}

		const assistantHasContent = await ctx.responseProcessor.routeAssistantResponse({
			assistantMessage,
			assistantTextOnly,
			assistantTextSignature,
			assistantMessageId,
			providerId,
			modelId: model.id,
			mode: modelInfo.mode,
			taskMetrics: metricsManager.getMetrics(),
			modelInfo,
			toolUseHandler,
		})

		return await processStreamResult(ctx, {
			assistantHasContent,
			stopReason,
			userContent,
			metricsManager,
			modelInfo,
			providerId,
			model,
		})
	} catch (error) {
		if (ctx.taskState.abort) {
			// User-initiated abort — not a fatal error, no card needed
			return true
		}
		const diracError = ErrorService.get().toDiracError(error)
		Logger.error("[Task] Fatal error in task loop:", diracError.serialize())
		try {
			const card = await ctx.taskMessenger.createCard({
				status: CardStatus.ERROR,
				header: "Task Error",
				body: `The task encountered an unexpected error and had to stop.\n\n${diracError.toDisplayMessage()}`,
			})
			await card.finalize(CardStatus.ERROR)
		} catch (sayError) {
			Logger.error("[Task] Failed to emit error message:", sayError)
		}
		return true
	}
}
