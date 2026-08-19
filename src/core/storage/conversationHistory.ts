import { Anthropic } from "@anthropic-ai/sdk"
import type { ApiConversationProviderState } from "@core/api/conversation"
import { CardKind, CardStatus, DiracMessage, DiracMessageType, SteeringTranscriptStatus } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { syncWorker } from "@/shared/services/worker/sync"
import { GlobalFileNames } from "./fileNames"
import { atomicWriteFile } from "./atomicWrite"
import { ensureTaskDirectoryExists } from "./directoryEnsurers"

// Reads the saved API conversation history for a task, returning [] if absent.
export async function getSavedApiConversationHistory(taskId: string): Promise<Anthropic.MessageParam[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationHistory)
	const fileExists = await fileExistsAtPath(filePath)
	if (fileExists) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	}
	return []
}

// Reads provider-native conversation state separately from the generic API transcript.
export async function getSavedApiConversationProviderState(taskId: string): Promise<ApiConversationProviderState> {
	const filePath = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationProviderState)
	if (!(await fileExistsAtPath(filePath))) return {}
	return JSON.parse(await fs.readFile(filePath, "utf8"))
}

// Persists opaque provider-native checkpoints without encoding them as generic messages.
export async function saveApiConversationProviderState(taskId: string, state: ApiConversationProviderState): Promise<void> {
	const fileName = GlobalFileNames.apiConversationProviderState
	const data = JSON.stringify(state)
	syncWorker().enqueue(taskId, fileName, data)
	const filePath = path.join(await ensureTaskDirectoryExists(taskId), fileName)
	await atomicWriteFile(filePath, data)
}

// Persists API conversation history for a task, queuing remote sync without blocking.
export async function saveApiConversationHistory(taskId: string, apiConversationHistory: Anthropic.MessageParam[]) {
	if (apiConversationHistory.length === 0) {
		return
	}
	try {
		const fileName = GlobalFileNames.apiConversationHistory
		const data = JSON.stringify(apiConversationHistory)
		syncWorker().enqueue(taskId, fileName, data)
		const filePath = path.join(await ensureTaskDirectoryExists(taskId), fileName)
		await atomicWriteFile(filePath, data)
	} catch (error) {
		Logger.error("Failed to save API conversation history:", error)
	}
}

// Reads saved Dirac UI messages for a task, migrating the legacy filename after validating its contents.
export async function getSavedDiracMessages(taskId: string): Promise<DiracMessage[]> {
	const taskDirectory = await ensureTaskDirectoryExists(taskId)
	const filePath = path.join(taskDirectory, GlobalFileNames.uiMessages)
	if (await fileExistsAtPath(filePath)) {
		return parseSavedDiracMessages(await fs.readFile(filePath, "utf8"), filePath)
	}

	const oldPath = path.join(taskDirectory, "claude_messages.json")
	if (await fileExistsAtPath(oldPath)) {
		const contents = await fs.readFile(oldPath, "utf8")
		const messages = await parseSavedDiracMessages(contents, oldPath)
		await atomicWriteFile(filePath, JSON.stringify(messages))
		await fs.unlink(oldPath)
		return messages
	}
	return []
}

async function parseSavedDiracMessages(contents: string, filePath: string): Promise<DiracMessage[]> {
	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		throw new Error(`Saved task transcript is not valid JSON: ${filePath}`, { cause: error })
	}
	if (!Array.isArray(parsed)) {
		throw new Error(`Saved task transcript is not an array: ${filePath}`)
	}

	const readableMessages = parsed.filter(isReadableDiracMessage)
	const skippedMessages = parsed.length - readableMessages.length
	if (parsed.length > 0 && readableMessages.length === 0) {
		throw new Error(`Saved task transcript uses an unsupported or unreadable format: ${filePath}`)
	}
	if (skippedMessages > 0) {
		await backupTranscriptBeforeSkippingMessages(filePath, contents)
		Logger.warn(
			`[Task History] Skipped ${skippedMessages} unreadable message${skippedMessages === 1 ? "" : "s"} in ${filePath}`,
		)
	}
	return readableMessages
}

async function backupTranscriptBeforeSkippingMessages(filePath: string, contents: string): Promise<void> {
	const extension = path.extname(filePath)
	const baseName = path.basename(filePath, extension)
	const backupPath = path.join(path.dirname(filePath), `${baseName}.unreadable.${Date.now()}${extension}`)
	try {
		await atomicWriteFile(backupPath, contents)
	} catch (error) {
		Logger.warn(`[Task History] Failed to back up unreadable messages from ${filePath}; continuing with readable messages`, error)
	}
}

const CARD_KINDS = new Set<string>(Object.values(CardKind))
const CARD_STATUSES = new Set<string>(Object.values(CardStatus))
const STEERING_STATUSES = new Set<string>(Object.values(SteeringTranscriptStatus))
const RENDER_TYPES = new Set(["text", "markdown", "diff"])
const CLEANUP_STRATEGIES = new Set(["abandon", "success", "error", "keep_running"])
const ACTION_STYLES = new Set(["default", "danger", "secondary"])
const MESSAGE_ROLES = new Set(["user", "assistant"])
const COMPLETION_TYPES = new Set(["act", "plan"])
const API_CANCEL_REASONS = new Set(["streaming_failed", "user_cancelled", "retries_exhausted"])

function isReadableDiracMessage(value: unknown): value is DiracMessage {
	if (!isRecord(value)) return false
	if (typeof value.id !== "string" || value.id.length === 0) return false
	if (!isFiniteNumber(value.ts)) return false
	if (!isRecord(value.content)) return false

	switch (value.content.type) {
		case DiracMessageType.MARKDOWN:
			return isReadableMarkdown(value.content)
		case DiracMessageType.CARD:
			return isReadableCard(value.content.card)
		case DiracMessageType.API_STATUS:
			return isReadableApiStatus(value.content.status)
		case DiracMessageType.CHECKPOINT:
			return true
		default:
			return false
	}
}

function isReadableMarkdown(content: Record<string, unknown>): boolean {
	return (
		typeof content.content === "string" &&
		isOptional(content.isReasoning, isBoolean) &&
		isOptional(content.images, isStringArray) &&
		isOptional(content.files, isStringArray) &&
		isOptional(content.isCompletion, isBoolean) &&
		isOptional(content.completionType, (value) => isStringInSet(value, COMPLETION_TYPES)) &&
		isOptional(content.showFeedback, isBoolean) &&
		isOptional(content.role, (value) => isStringInSet(value, MESSAGE_ROLES)) &&
		isOptional(content.agentId, isFiniteNumber) &&
		isOptional(content.agentName, isString) &&
		isOptional(content.steering, isReadableSteeringState)
	)
}

function isReadableSteeringState(value: unknown): boolean {
	return isRecord(value) && isStringInSet(value.status, STEERING_STATUSES)
}

function isReadableApiStatus(value: unknown): boolean {
	if (!isRecord(value)) return false
	return (
		isOptional(value.id, isString) &&
		isOptional(value.request, isString) &&
		isOptional(value.tokensIn, isFiniteNumber) &&
		isOptional(value.tokensOut, isFiniteNumber) &&
		isOptional(value.cacheWrites, isFiniteNumber) &&
		isOptional(value.reasoningTokens, isFiniteNumber) &&
		isOptional(value.cacheReads, isFiniteNumber) &&
		isOptional(value.cost, isFiniteNumber) &&
		isOptional(value.contextWindow, isFiniteNumber) &&
		isOptional(value.contextUsagePercentage, isFiniteNumber) &&
		isOptional(value.deletedMetrics, isReadableDeletedMetrics) &&
		isOptional(value.cancelReason, (reason) => isStringInSet(reason, API_CANCEL_REASONS)) &&
		isOptional(value.streamingFailedMessage, isString) &&
		isOptional(value.stopReason, isString) &&
		isOptional(value.retryStatus, isReadableRetryStatus)
	)
}

function isReadableDeletedMetrics(value: unknown): boolean {
	if (!isRecord(value)) return false
	return (
		isOptional(value.tokensIn, isFiniteNumber) &&
		isOptional(value.tokensOut, isFiniteNumber) &&
		isOptional(value.cacheWrites, isFiniteNumber) &&
		isOptional(value.cacheReads, isFiniteNumber)
	)
}

function isReadableRetryStatus(value: unknown): boolean {
	return (
		isRecord(value) &&
		isFiniteNumber(value.attempt) &&
		isFiniteNumber(value.maxAttempts) &&
		isFiniteNumber(value.delaySec) &&
		isOptional(value.errorSnippet, isString)
	)
}

function isReadableCard(value: unknown): boolean {
	if (!isRecord(value)) return false
	return (
		typeof value.id === "string" &&
		value.id.length > 0 &&
		typeof value.header === "string" &&
		isStringInSet(value.status, CARD_STATUSES) &&
		isStringInSet(value.renderType, RENDER_TYPES) &&
		isOptional(value.kind, (kind) => isStringInSet(kind, CARD_KINDS)) &&
		isOptional(value.toolName, isString) &&
		isOptional(value.body, isString) &&
		isOptional(value.icon, isString) &&
		isOptional(value.rawInput, isRecord) &&
		isOptional(value.rawOutput, isRecord) &&
		isOptional(value.diffs, isReadableCardDiffs) &&
		isOptional(value.locations, isReadableCardLocations) &&
		isOptional(value.requireApproval, isBoolean) &&
		isOptional(value.requireFeedback, isBoolean) &&
		isOptional(value.feedbackPlaceholder, isString) &&
		isOptional(value.actions, isReadableCardActions) &&
		isOptional(value.autoScroll, isBoolean) &&
		isOptional(value.collapsed, isBoolean) &&
		isOptional(value.maxHeight, isFiniteNumber) &&
		isOptional(value.cleanupStrategy, (strategy) => isStringInSet(strategy, CLEANUP_STRATEGIES)) &&
		isOptional(value.do_not_auto_collapse, isBoolean) &&
		isOptional(value.startTime, isFiniteNumber) &&
		isOptional(value.endTime, isFiniteNumber) &&
		isOptional(value.outcome, isString)
	)
}

function isReadableCardActions(value: unknown): boolean {
	return Array.isArray(value) && value.every(isReadableCardAction)
}

function isReadableCardAction(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.label === "string" &&
		typeof value.value === "string" &&
		isOptional(value.primary, isBoolean) &&
		isOptional(value.style, (style) => isStringInSet(style, ACTION_STYLES)) &&
		isOptional(value.url, isString)
	)
}

function isReadableCardLocations(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every(
			(location) => isRecord(location) && typeof location.path === "string" && isOptional(location.line, isFiniteNumber),
		)
	)
}

function isReadableCardDiffs(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every(
			(diff) =>
				isRecord(diff) &&
				typeof diff.path === "string" &&
				typeof diff.oldText === "string" &&
				typeof diff.newText === "string",
		)
	)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isOptional(value: unknown, predicate: (candidate: unknown) => boolean): boolean {
	return value === undefined || predicate(value)
}

function isString(value: unknown): value is string {
	return typeof value === "string"
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean"
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isString)
}

function isStringInSet(value: unknown, values: ReadonlySet<string>): boolean {
	return typeof value === "string" && values.has(value)
}

// Persists Dirac UI messages for a task.
export async function saveDiracMessages(taskId: string, uiMessages: DiracMessage[]) {
	try {
		const taskDir = await ensureTaskDirectoryExists(taskId)
		const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
		await atomicWriteFile(filePath, JSON.stringify(uiMessages))
	} catch (error) {
		Logger.error("Failed to save ui messages:", error)
	}
}
