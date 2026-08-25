import { assertGoalAccounting } from "@core/goal/validateGoalRecord"
import type { GoalHistoryItem, RunHistoryItem, TaskHistoryItem } from "@shared/HistoryItem"
import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { reconstructTaskHistory } from "../commands/reconstructTaskHistory"
import { atomicWriteFile } from "./atomicWrite"
import { ensureStateDirectoryExists } from "./directoryEnsurers"

const GOAL_STATUSES = new Set(["working", "waiting", "paused", "blocked", "achieved", "stopped"])

// Returns the path to the task history state file.
export async function getTaskHistoryStateFilePath(): Promise<string> {
	return path.join(await ensureStateDirectoryExists(), "taskHistory.json")
}

// Returns whether the task history state file exists.
export async function taskHistoryStateFileExists(): Promise<boolean> {
	const filePath = await getTaskHistoryStateFilePath()
	return fileExistsAtPath(filePath)
}

// Reads task history from state, attempting recovery on parse failure.
export async function readTaskHistoryFromState(): Promise<RunHistoryItem[]> {
	try {
		const filePath = await getTaskHistoryStateFilePath()
		if (!(await fileExistsAtPath(filePath))) {
			return []
		}
		const contents = await fs.readFile(filePath, "utf8")
		return parseTaskHistoryContents(filePath, contents)
	} catch (error) {
		telemetryService.captureExtensionStorageError(error, "readTaskHistoryFromState")
		throw error
	}
}

// Parses task history contents, recovering an invalid root and skipping invalid records.
async function parseTaskHistoryContents(filePath: string, contents: string): Promise<RunHistoryItem[]> {
	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (parseError) {
		telemetryService.captureExtensionStorageError(parseError, "parseError_attemptingRecovery")
		return recoverTaskHistory(filePath, contents)
	}

	if (!Array.isArray(parsed)) {
		const rootError = new Error("Task history root is not an array")
		telemetryService.captureExtensionStorageError(rootError.message, "invalidRoot_attemptingRecovery")
		return recoverTaskHistory(filePath, contents)
	}

	const historyItems: RunHistoryItem[] = []
	for (const [index, item] of parsed.entries()) {
		if (isExplicitGoalRecord(item)) {
			assertReadableGoalHistoryItem(item, index)
			historyItems.push(item)
			continue
		}
		if (hasUnsupportedRunKind(item)) throw new Error(`History entry ${index} has an unsupported run kind`)
		if (isReadableTaskHistoryItem(item)) historyItems.push(item)
	}
	const skippedItems = parsed.length - historyItems.length
	if (parsed.length > 0 && historyItems.length === 0) {
		const recordsError = new Error("Task history contains no readable records")
		telemetryService.captureExtensionStorageError(recordsError.message, "invalidRecords_attemptingRecovery")
		return recoverTaskHistory(filePath, contents)
	}
	if (skippedItems > 0) {
		Logger.warn(`[Task History] Skipped ${skippedItems} unreadable entr${skippedItems === 1 ? "y" : "ies"}`)
	}
	return historyItems
}

function isExplicitGoalRecord(value: unknown): value is Record<string, unknown> & { runKind: "goal" } {
	return !!value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).runKind === "goal"
}

function hasUnsupportedRunKind(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false
	const runKind = (value as Record<string, unknown>).runKind
	return runKind !== undefined && runKind !== "task" && runKind !== "goal"
}

function hasReadableHistoryBase(item: Record<string, unknown>): boolean {
	return (
		typeof item.id === "string" &&
		item.id.length > 0 &&
		isFiniteNumber(item.ts) &&
		typeof item.task === "string" &&
		isOptional(item.tokensIn, isFiniteNumber) &&
		isOptional(item.tokensOut, isFiniteNumber) &&
		isOptional(item.cacheWrites, isFiniteNumber) &&
		isOptional(item.cacheReads, isFiniteNumber) &&
		isOptional(item.totalCost, isFiniteNumber) &&
		isOptional(item.size, isFiniteNumber) &&
		isOptional(item.ulid, isString) &&
		isOptional(item.shadowGitConfigWorkTree, isString) &&
		isOptional(item.cwdOnTaskInitialization, isString) &&
		isOptional(item.workspaceRootPath, isString) &&
		isOptional(item.checkpointManagerErrorMessage, isString) &&
		isOptional(item.modelId, isString) &&
		isOptional(item.isFavorited, isBoolean) &&
		isOptional(item.conversationHistoryDeletedRange, isFiniteNumberPair)
	)
}

function isReadableTaskHistoryItem(value: unknown): value is TaskHistoryItem {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false
	const item = value as Record<string, unknown>
	return (item.runKind === undefined || item.runKind === "task") && hasReadableHistoryBase(item)
}

function assertReadableGoalHistoryItem(
	value: Record<string, unknown>,
	index: number,
): asserts value is Record<string, unknown> & GoalHistoryItem {
	const path = `History entry ${index}`
	if (!hasReadableHistoryBase(value)) throw new Error(`${path} has an invalid common summary`)
	if (typeof value.conversationUlid !== "string" || !value.conversationUlid) {
		throw new Error(`${path} has an invalid conversationUlid`)
	}
	if (typeof value.initialDisplayText !== "string" || !value.initialDisplayText) {
		throw new Error(`${path} has an invalid initialDisplayText`)
	}
	if (value.task !== value.initialDisplayText) throw new Error(`${path} has inconsistent initial display text`)
	if (typeof value.objectivePreview !== "string" || !value.objectivePreview.trim()) {
		throw new Error(`${path} has an invalid objectivePreview`)
	}
	if (!Number.isInteger(value.objectiveRevision) || (value.objectiveRevision as number) <= 0) {
		throw new Error(`${path} has an invalid objectiveRevision`)
	}
	if (typeof value.status !== "string" || !GOAL_STATUSES.has(value.status)) throw new Error(`${path} has an invalid status`)
	if (!isOptional(value.statusReason, isString)) throw new Error(`${path} has an invalid statusReason`)
	if (!isFiniteNumber(value.createdAt) || !isFiniteNumber(value.updatedAt) || !isFiniteNumber(value.activeDurationMs)) {
		throw new Error(`${path} has invalid timestamps or active duration`)
	}
	if ((value.createdAt as number) < 0 || (value.updatedAt as number) < (value.createdAt as number)) {
		throw new Error(`${path} has inconsistent timestamps`)
	}
	if ((value.activeDurationMs as number) < 0) throw new Error(`${path} has a negative active duration`)
	assertGoalAccounting(value.accounting, `${path}.accounting`)
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

function isFiniteNumberPair(value: unknown): boolean {
	return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber)
}

// Attempts to reconstruct task history after a parse error; returns an empty valid index if recovery fails.
async function recoverTaskHistory(filePath: string, unreadableContents: string): Promise<RunHistoryItem[]> {
	await backupUnreadableTaskHistory(filePath, unreadableContents)

	const result = await reconstructTaskHistory(false)
	if (!result || result.reconstructedTasks === 0) {
		await atomicWriteFile(filePath, "[]")
		return []
	}

	const newContents = await fs.readFile(filePath, "utf8")
	return parseTaskHistoryContents(filePath, newContents)
}

async function backupUnreadableTaskHistory(filePath: string, contents: string): Promise<void> {
	const backupPath = path.join(path.dirname(filePath), `taskHistory.unreadable.${Date.now()}.json`)
	try {
		await atomicWriteFile(backupPath, contents)
	} catch (error) {
		Logger.warn(`[Task History] Failed to back up unreadable history at ${backupPath}`, error)
	}
}

// Atomically writes task history items to the state file.
export async function writeTaskHistoryToState(items: RunHistoryItem[]): Promise<void> {
	try {
		items.forEach((item, index) => {
			if (item.runKind === "goal") assertReadableGoalHistoryItem(item as unknown as Record<string, unknown>, index)
			else if (!isReadableTaskHistoryItem(item)) throw new Error(`History entry ${index} is not a readable Task summary`)
		})
		const filePath = await getTaskHistoryStateFilePath()
		await atomicWriteFile(filePath, JSON.stringify(items))
	} catch (error) {
		Logger.error("[Disk] Failed to write task history:", error)
		throw error
	}
}
