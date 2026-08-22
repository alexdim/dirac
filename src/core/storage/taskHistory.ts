import { HistoryItem } from "@shared/HistoryItem"
import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { reconstructTaskHistory } from "../commands/reconstructTaskHistory"
import { atomicWriteFile } from "./atomicWrite"
import { ensureStateDirectoryExists } from "./directoryEnsurers"

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
export async function readTaskHistoryFromState(): Promise<HistoryItem[]> {
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
async function parseTaskHistoryContents(filePath: string, contents: string): Promise<HistoryItem[]> {
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

	const historyItems = parsed.filter(isReadableHistoryItem)
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

function isReadableHistoryItem(value: unknown): value is HistoryItem {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false
	const item = value as Record<string, unknown>
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
async function recoverTaskHistory(filePath: string, unreadableContents: string): Promise<HistoryItem[]> {
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
export async function writeTaskHistoryToState(items: HistoryItem[]): Promise<void> {
	try {
		const filePath = await getTaskHistoryStateFilePath()
		await atomicWriteFile(filePath, JSON.stringify(items))
	} catch (error) {
		Logger.error("[Disk] Failed to write task history:", error)
		throw error
	}
}
