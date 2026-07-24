import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type * as acp from "@agentclientprotocol/sdk"
import { DIRAC_CLI_DIR } from "../utils/path.js"

const LEGACY_SESSION_UPDATES_FILE = path.join(DIRAC_CLI_DIR.data, "acp-session-updates.json")
const SESSION_UPDATES_DIRECTORY = path.join(DIRAC_CLI_DIR.data, "acp-session-updates")
const MIGRATION_LOCK_DIRECTORY = path.join(DIRAC_CLI_DIR.data, "acp-session-updates.migration.lock")
const SEQUENCE_META_KEY = "dev.dirac/seq"
const JOURNAL_VERSION = 1
const DEFAULT_MAX_JOURNAL_BYTES = 32 * 1024 * 1024
const LOCK_WAIT_TIMEOUT_MS = 15_000
const LOCK_ORPHAN_GRACE_MS = 30_000
const LOCK_RETRY_INTERVAL_MS = 10
const LOCK_SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4))

type SessionUpdateWithMeta = acp.SessionUpdate & { _meta?: Record<string, unknown> }

export type PersistedSessionUpdate =
	| {
		kind: "session_update"
		sequenceNumber: number
		update: SessionUpdateWithMeta
	}
	| {
		kind: "client_annotation"
		sequenceNumber: number
		annotation: Record<string, unknown>
	}


type LegacyPersistedSessionUpdate =
	| PersistedSessionUpdate
	| {
		kind: "usage_update"
		sequenceNumber: number
		usage: Record<string, unknown>
	}

type LegacySessionUpdatesMap = Record<string, LegacyPersistedSessionUpdate[]>

type SessionUpdatesJournal = {
	version: typeof JOURNAL_VERSION
	sessionId: string
	updates: PersistedSessionUpdate[]
}

type LockOwner = {
	pid: number
	createdAt: number
}

function maximumJournalBytes(): number {
	const configured = process.env.DIRAC_ACP_SESSION_UPDATES_MAX_BYTES
	if (configured === undefined) return DEFAULT_MAX_JOURNAL_BYTES

	const parsed = Number(configured)
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`DIRAC_ACP_SESSION_UPDATES_MAX_BYTES must be a positive integer, received ${JSON.stringify(configured)}`)
	}
	return parsed
}

function journalFilePath(sessionId: string): string {
	const digest = crypto.createHash("sha256").update(sessionId).digest("hex")
	return path.join(SESSION_UPDATES_DIRECTORY, `${digest}.json`)
}

function sessionLockDirectory(sessionId: string): string {
	return `${journalFilePath(sessionId)}.lock`
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validateUpdateArray(updates: unknown, allowLegacyUsageUpdates: boolean): void {
	if (!Array.isArray(updates)) {
		throw new Error("expected an array of persisted updates")
	}

	let previousSequenceNumber = 0
	for (const [index, update] of updates.entries()) {
		if (!isObject(update)) {
			throw new Error(`update ${index} is not an object`)
		}
		if (!Number.isSafeInteger(update.sequenceNumber) || (update.sequenceNumber as number) <= previousSequenceNumber) {
			throw new Error(`update ${index} has a non-monotonic sequenceNumber`)
		}
		previousSequenceNumber = update.sequenceNumber as number

		if (update.kind === "session_update") {
			if (!isObject(update.update)) throw new Error(`session update ${index} has no update payload`)
			continue
		}
		if (update.kind === "client_annotation") {
			if (!isObject(update.annotation)) throw new Error(`client annotation ${index} has no annotation payload`)
			continue
		}
		if (allowLegacyUsageUpdates && update.kind === "usage_update") {
			if (!isObject(update.usage)) throw new Error(`legacy usage update ${index} has no usage payload`)
			continue
		}
		throw new Error(`update ${index} has unknown kind ${JSON.stringify(update.kind)}`)
	}
}

function validateUpdates(updates: unknown): asserts updates is PersistedSessionUpdate[] {
	validateUpdateArray(updates, false)
}

function validateLegacyUpdates(updates: unknown): asserts updates is LegacyPersistedSessionUpdate[] {
	validateUpdateArray(updates, true)
}

function malformedJournalError(filePath: string, error: unknown): Error {
	const detail = error instanceof Error ? error.message : String(error)
	return new Error(
		`Malformed ACP session update journal at ${filePath}: ${detail}. ` +
		"Dirac will not overwrite or reset this file; move it aside for recovery or repair the JSON before retrying.",
	)
}

function parseJournalJson(filePath: string, contents: string): unknown {
	try {
		return JSON.parse(contents)
	} catch (error) {
		throw malformedJournalError(filePath, error)
	}
}

function readSessionJournal(sessionId: string): SessionUpdatesJournal {
	const filePath = journalFilePath(sessionId)
	let contents: string
	try {
		contents = fs.readFileSync(filePath, "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { version: JOURNAL_VERSION, sessionId, updates: [] }
		}
		throw error
	}

	const parsed = parseJournalJson(filePath, contents)
	try {
		if (!isObject(parsed)) throw new Error("expected a JSON object")
		if (parsed.version !== JOURNAL_VERSION) throw new Error(`unsupported journal version ${JSON.stringify(parsed.version)}`)
		if (parsed.sessionId !== sessionId) throw new Error(`journal belongs to session ${JSON.stringify(parsed.sessionId)}`)
		validateUpdates(parsed.updates)
		return parsed as SessionUpdatesJournal
	} catch (error) {
		throw malformedJournalError(filePath, error)
	}
}

function leadingJsonObjectEnd(contents: string): number | undefined {
	let index = 0
	while (index < contents.length && /\s/.test(contents[index])) index += 1
	if (contents[index] !== "{") return undefined

	const closingDelimiters = ["}"]
	let insideString = false
	let escaped = false
	for (index += 1; index < contents.length; index += 1) {
		const character = contents[index]
		if (insideString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (character === "\\") {
				escaped = true
				continue
			}
			if (character === '"') insideString = false
			continue
		}

		if (character === '"') {
			insideString = true
			continue
		}
		if (character === "{") {
			closingDelimiters.push("}")
			continue
		}
		if (character === "[") {
			closingDelimiters.push("]")
			continue
		}
		if (character !== "}" && character !== "]") continue
		if (closingDelimiters.at(-1) !== character) return undefined
		closingDelimiters.pop()
		if (closingDelimiters.length === 0) return index + 1
	}
	return undefined
}

function parseLegacyJournalJson(contents: string): { parsed: unknown; hadTrailingData: boolean } {
	try {
		return { parsed: JSON.parse(contents), hadTrailingData: false }
	} catch (error) {
		const leadingObjectEnd = leadingJsonObjectEnd(contents)
		if (leadingObjectEnd === undefined || contents.slice(leadingObjectEnd).trim() === "") {
			throw malformedJournalError(LEGACY_SESSION_UPDATES_FILE, error)
		}
		try {
			return { parsed: JSON.parse(contents.slice(0, leadingObjectEnd)), hadTrailingData: true }
		} catch {
			throw malformedJournalError(LEGACY_SESSION_UPDATES_FILE, error)
		}
	}
}

function readLegacySessionUpdatesMap(): { sessionUpdates: LegacySessionUpdatesMap; hadTrailingData: boolean } {
	const contents = fs.readFileSync(LEGACY_SESSION_UPDATES_FILE, "utf8")
	const { parsed, hadTrailingData } = parseLegacyJournalJson(contents)
	try {
		if (!isObject(parsed)) throw new Error("expected a JSON object keyed by session ID")
		for (const [sessionId, updates] of Object.entries(parsed)) {
			try {
				validateLegacyUpdates(updates)
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error)
				throw new Error(`session ${JSON.stringify(sessionId)}: ${detail}`)
			}
		}
		return { sessionUpdates: parsed as LegacySessionUpdatesMap, hadTrailingData }
	} catch (error) {
		throw malformedJournalError(LEGACY_SESSION_UPDATES_FILE, error)
	}
}

function fsyncDirectory(directoryPath: string): void {
	let descriptor: number | undefined
	try {
		descriptor = fs.openSync(directoryPath, "r")
		fs.fsyncSync(descriptor)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (process.platform === "win32" && (code === "EINVAL" || code === "EPERM" || code === "EISDIR")) return
		throw error
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor)
	}
}

function serializeJournal(journal: SessionUpdatesJournal, filePath: string): string {
	const serialized = JSON.stringify(journal)
	const byteLength = Buffer.byteLength(serialized)
	const maximumBytes = maximumJournalBytes()
	if (byteLength > maximumBytes) {
		throw new Error(
			`ACP session update journal for session ${JSON.stringify(journal.sessionId)} would grow to ${byteLength} bytes, ` +
			`exceeding the ${maximumBytes}-byte limit at ${filePath}. The previous journal remains intact. ` +
			"Delete the session to remove its replay history or raise DIRAC_ACP_SESSION_UPDATES_MAX_BYTES explicitly.",
		)
	}
	return serialized
}

function atomicWriteJournal(journal: SessionUpdatesJournal): void {
	fs.mkdirSync(SESSION_UPDATES_DIRECTORY, { recursive: true })
	const filePath = journalFilePath(journal.sessionId)
	const serialized = serializeJournal(journal, filePath)
	const temporaryPath = path.join(
		SESSION_UPDATES_DIRECTORY,
		`.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
	)
	let descriptor: number | undefined
	try {
		descriptor = fs.openSync(temporaryPath, "wx", 0o600)
		fs.writeFileSync(descriptor, serialized, "utf8")
		fs.fsyncSync(descriptor)
		fs.closeSync(descriptor)
		descriptor = undefined
		fs.renameSync(temporaryPath, filePath)
		fsyncDirectory(SESSION_UPDATES_DIRECTORY)
	} catch (error) {
		if (descriptor !== undefined) fs.closeSync(descriptor)
		try {
			fs.unlinkSync(temporaryPath)
		} catch (cleanupError) {
			if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError
		}
		throw error
	}
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "ESRCH") return false
		if (code === "EPERM") return true
		throw error
	}
}

function removeAbandonedLock(lockDirectory: string): boolean {
	let owner: LockOwner | undefined
	try {
		owner = JSON.parse(fs.readFileSync(path.join(lockDirectory, "owner.json"), "utf8")) as LockOwner
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error
	}

	if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
		if (processIsAlive(owner.pid)) return false
		fs.rmSync(lockDirectory, { recursive: true, force: true })
		return true
	}

	let age: number
	try {
		age = Date.now() - fs.statSync(lockDirectory).mtimeMs
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
		throw error
	}
	if (age < LOCK_ORPHAN_GRACE_MS) return false
	fs.rmSync(lockDirectory, { recursive: true, force: true })
	return true
}

function acquireLock(lockDirectory: string): void {
	fs.mkdirSync(path.dirname(lockDirectory), { recursive: true })
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
	while (true) {
		try {
			fs.mkdirSync(lockDirectory)
			try {
				fs.writeFileSync(
					path.join(lockDirectory, "owner.json"),
					JSON.stringify({ pid: process.pid, createdAt: Date.now() } satisfies LockOwner),
					{ encoding: "utf8", mode: 0o600 },
				)
			} catch (error) {
				fs.rmSync(lockDirectory, { recursive: true, force: true })
				throw error
			}
			return
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
			if (removeAbandonedLock(lockDirectory)) continue
			if (Date.now() >= deadline) {
				throw new Error(`Timed out after ${LOCK_WAIT_TIMEOUT_MS} ms waiting for ACP persistence lock ${lockDirectory}`)
			}
			Atomics.wait(LOCK_SLEEP_ARRAY, 0, 0, LOCK_RETRY_INTERVAL_MS)
		}
	}
}

function withLock<T>(lockDirectory: string, action: () => T): T {
	acquireLock(lockDirectory)
	try {
		return action()
	} finally {
		fs.rmSync(lockDirectory, { recursive: true, force: true })
	}
}

function finalizeLegacyJournalMigration(hadTrailingData: boolean): void {
	if (hadTrailingData) {
		const recoveryPath = `${LEGACY_SESSION_UPDATES_FILE}.recovery-${Date.now()}-${crypto.randomUUID()}`
		fs.renameSync(LEGACY_SESSION_UPDATES_FILE, recoveryPath)
	} else {
		fs.unlinkSync(LEGACY_SESSION_UPDATES_FILE)
	}
	fsyncDirectory(path.dirname(LEGACY_SESSION_UPDATES_FILE))
}

function updateJsonEquals(left: PersistedSessionUpdate, right: PersistedSessionUpdate): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function migrateLegacySession(sessionId: string, legacyUpdates: PersistedSessionUpdate[]): void {
	withLock(sessionLockDirectory(sessionId), () => {
		const existing = readSessionJournal(sessionId)
		const sharedLength = Math.min(existing.updates.length, legacyUpdates.length)
		for (let index = 0; index < sharedLength; index += 1) {
			if (updateJsonEquals(existing.updates[index], legacyUpdates[index])) continue
			throw new Error(
				`Conflicting ACP session update histories for session ${JSON.stringify(sessionId)} in ` +
				`${LEGACY_SESSION_UPDATES_FILE} and ${journalFilePath(sessionId)} at sequence ${index + 1}. ` +
				"Dirac preserved both files; repair or move one history aside before retrying.",
			)
		}

		if (existing.updates.length >= legacyUpdates.length) return
		atomicWriteJournal({ version: JOURNAL_VERSION, sessionId, updates: legacyUpdates })
	})
}

function currentUpdatesFromLegacy(updates: LegacyPersistedSessionUpdate[]): PersistedSessionUpdate[] {
	return updates.filter((update): update is PersistedSessionUpdate => update.kind !== "usage_update")
}

function migrateLegacyJournal(): void {
	if (!fs.existsSync(LEGACY_SESSION_UPDATES_FILE)) return

	withLock(MIGRATION_LOCK_DIRECTORY, () => {
		if (!fs.existsSync(LEGACY_SESSION_UPDATES_FILE)) return
		const { sessionUpdates, hadTrailingData } = readLegacySessionUpdatesMap()
		for (const [sessionId, updates] of Object.entries(sessionUpdates)) {
			migrateLegacySession(sessionId, currentUpdatesFromLegacy(updates))
		}
		finalizeLegacyJournalMigration(hadTrailingData)
	})
}

function updateSessionJournal<T>(sessionId: string, update: (journal: SessionUpdatesJournal) => T): T {
	migrateLegacyJournal()
	return withLock(sessionLockDirectory(sessionId), () => {
		const journal = readSessionJournal(sessionId)
		const result = update(journal)
		atomicWriteJournal(journal)
		return result
	})
}

function nextSequenceNumber(updates: PersistedSessionUpdate[]): number {
	return (updates.at(-1)?.sequenceNumber ?? 0) + 1
}

/** Persist one ACP session update with its stable, per-session sequence number. */
export function recordSessionUpdate(sessionId: string, update: acp.SessionUpdate): SessionUpdateWithMeta {
	return updateSessionJournal(sessionId, (journal) => {
		const sequenceNumber = nextSequenceNumber(journal.updates)
		const updateWithSequence: SessionUpdateWithMeta = {
			...update,
			_meta: {
				...(update as SessionUpdateWithMeta)._meta,
				[SEQUENCE_META_KEY]: sequenceNumber,
			},
		}
		journal.updates.push({ kind: "session_update", sequenceNumber, update: updateWithSequence })
		return updateWithSequence
	})
}

/** Persist one client control-plane annotation with its stable, per-session sequence number. */
export function recordClientAnnotation(sessionId: string, annotation: Record<string, unknown>): Record<string, unknown> {
	return updateSessionJournal(sessionId, (journal) => {
		const sequenceNumber = nextSequenceNumber(journal.updates)
		const annotationWithSequence = {
			...annotation,
			_meta: {
				...(annotation._meta as Record<string, unknown> | undefined),
				[SEQUENCE_META_KEY]: sequenceNumber,
			},
		}
		journal.updates.push({ kind: "client_annotation", sequenceNumber, annotation: annotationWithSequence })
		return annotationWithSequence
	})
}

/** Return the immutable ordered ACP update journal for a persisted session. */
export function getSessionUpdates(sessionId: string): PersistedSessionUpdate[] {
	migrateLegacyJournal()
	return readSessionJournal(sessionId).updates
}

/** Remove the complete ACP update journal for a deleted session. */
export function deleteSessionUpdates(sessionId: string): void {
	migrateLegacyJournal()
	withLock(sessionLockDirectory(sessionId), () => {
		try {
			fs.unlinkSync(journalFilePath(sessionId))
			fsyncDirectory(SESSION_UPDATES_DIRECTORY)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
	})
}
