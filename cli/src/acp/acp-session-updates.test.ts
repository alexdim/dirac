import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const tempDataDirectories: string[] = []

function setupDataDirectory(): string {
	const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dirac-acp-session-updates-"))
	process.env.DIRAC_DATA_DIR = dataDirectory
	tempDataDirectories.push(dataDirectory)
	return dataDirectory
}

function journalFilePath(dataDirectory: string, sessionId: string): string {
	const digest = crypto.createHash("sha256").update(sessionId).digest("hex")
	return path.join(dataDirectory, "acp-session-updates", `${digest}.json`)
}

async function workerBundle(): Promise<string> {
	const workerPath = path.join(process.cwd(), `.dirac-acp-session-updates-worker-${crypto.randomUUID()}.cjs`)
	const sourcePath = path.resolve(__dirname, "acp-session-updates.ts")
	const esbuild = await import("esbuild")
	await esbuild.build({
		entryPoints: [sourcePath],
		outfile: workerPath,
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
	})
	tempDataDirectories.push(workerPath)
	return workerPath
}

function spawnWriter(workerPath: string, dataDirectory: string, sessionId: string, writerId: number, count: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const source = `
			const { recordSessionUpdate } = require(${JSON.stringify(workerPath)});
			for (let i = 0; i < ${count}; i += 1) {
				recordSessionUpdate(${JSON.stringify(sessionId)}, {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: ${JSON.stringify(`writer-${writerId}-`)} + i },
				});
			}
		`
		const child = spawn(process.execPath, ["--eval", source], {
			env: { ...process.env, DIRAC_DATA_DIR: dataDirectory },
			stdio: ["ignore", "ignore", "pipe"],
		})
		let stderr = ""
		child.stderr.setEncoding("utf8")
		child.stderr.on("data", (chunk) => {
			stderr += chunk
		})
		child.on("error", reject)
		child.on("exit", (code) => {
			if (code === 0) resolve()
			else reject(new Error(`writer ${writerId} exited with code ${code}: ${stderr}`))
		})
	})
}

describe("ACP session update journal", () => {
	beforeEach(() => {
		vi.resetModules()
		setupDataDirectory()
	})

	afterEach(() => {
		delete process.env.DIRAC_DATA_DIR
		delete process.env.DIRAC_ACP_SESSION_UPDATES_MAX_BYTES
		for (const entry of tempDataDirectories.splice(0)) {
			fs.rmSync(entry, { recursive: true, force: true })
		}
	})

	it("persists a monotonic per-session sequence and preserves it for replay", async () => {
		const { getSessionUpdates, recordClientAnnotation, recordSessionUpdate } = await import("./acp-session-updates.js")
		const first = recordSessionUpdate("session-1", {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "first" },
		} as any)
		const usage = recordSessionUpdate("session-1", {
			sessionUpdate: "usage_update",
			used: 12,
			size: 100,
		} as any)
		const annotation = recordClientAnnotation("session-1", {
			kind: "permission_decision",
			outcome: "allow_once",
		})
		const second = recordSessionUpdate("session-1", {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "second" },
		} as any)

		expect(first._meta).toEqual({ "dev.dirac/seq": 1 })
		expect(usage._meta).toEqual({ "dev.dirac/seq": 2 })
		expect(annotation._meta).toEqual({ "dev.dirac/seq": 3 })
		expect(second._meta).toEqual({ "dev.dirac/seq": 4 })
		expect(getSessionUpdates("session-1")).toEqual([
			{ kind: "session_update", sequenceNumber: 1, update: first },
			{ kind: "session_update", sequenceNumber: 2, update: usage },
			{ kind: "client_annotation", sequenceNumber: 3, annotation },
			{ kind: "session_update", sequenceNumber: 4, update: second },
		])
	})

	it("keeps committed JSON valid and retains updates written by separate processes", async () => {
		const dataDirectory = process.env.DIRAC_DATA_DIR!
		const sessionId = "concurrent-session"
		const writerPath = await workerBundle()
		const writerCount = 4
		const updatesPerWriter = 35
		const committedPath = journalFilePath(dataDirectory, sessionId)
		let readerStopped = false
		let readerError: unknown
		const reader = (async () => {
			while (!readerStopped) {
				try {
					const contents = fs.readFileSync(committedPath, "utf8")
					JSON.parse(contents)
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
						readerError = error
						return
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 1))
			}
		})()

		await Promise.all(
			Array.from({ length: writerCount }, (_, writerId) =>
				spawnWriter(writerPath, dataDirectory, sessionId, writerId, updatesPerWriter),
			),
		)
		readerStopped = true
		await reader
		expect(readerError).toBeUndefined()

		vi.resetModules()
		const { getSessionUpdates } = await import("./acp-session-updates.js")
		const updates = getSessionUpdates(sessionId)
		expect(updates).toHaveLength(writerCount * updatesPerWriter)
		expect(updates.map((update) => update.sequenceNumber)).toEqual(
			Array.from({ length: writerCount * updatesPerWriter }, (_, index) => index + 1),
		)
		const texts = updates.map((persisted) => {
			if (persisted.kind !== "session_update" || persisted.update.sessionUpdate !== "agent_message_chunk") return ""
			return persisted.update.content.type === "text" ? persisted.update.content.text : ""
		})
		for (let writerId = 0; writerId < writerCount; writerId += 1) {
			for (let index = 0; index < updatesPerWriter; index += 1) {
				expect(texts).toContain(`writer-${writerId}-${index}`)
			}
		}
		expect(() => JSON.parse(fs.readFileSync(committedPath, "utf8"))).not.toThrow()
	})

	it("preserves the prior committed journal when replacement is interrupted", async () => {
		const dataDirectory = process.env.DIRAC_DATA_DIR!
		const sessionId = "interrupted-session"
		const journal = await import("./acp-session-updates.js")
		journal.recordSessionUpdate(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "committed" },
		} as any)
		const committedPath = journalFilePath(dataDirectory, sessionId)
		const before = fs.readFileSync(committedPath)

		const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
			throw new Error("simulated interruption before rename")
		})
		expect(() =>
			journal.recordSessionUpdate(sessionId, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "uncommitted" },
			} as any),
		).toThrow("simulated interruption before rename")
		rename.mockRestore()

		expect(fs.readFileSync(committedPath)).toEqual(before)
		expect(JSON.parse(before.toString("utf8"))).toMatchObject({ sessionId })
		expect(fs.readdirSync(path.dirname(committedPath)).filter((entry) => entry.endsWith(".tmp"))).toEqual([])
	})

	it("reports malformed legacy data and never overwrites it", async () => {
		const dataDirectory = process.env.DIRAC_DATA_DIR!
		const legacyPath = path.join(dataDirectory, "acp-session-updates.json")
		const malformed = '{"session-1":[{"kind":"session_update","update":{"content":"unterminated'
		fs.writeFileSync(legacyPath, malformed)
		const journal = await import("./acp-session-updates.js")

		expect(() => journal.getSessionUpdates("session-1")).toThrow(
			expect.objectContaining({
				message: expect.stringContaining(`Malformed ACP session update journal at ${legacyPath}`),
			}),
		)
		expect(() => journal.getSessionUpdates("session-1")).toThrow("will not overwrite or reset this file")
		expect(fs.readFileSync(legacyPath, "utf8")).toBe(malformed)
	})

	it("migrates valid legacy data into an isolated session journal", async () => {
		const dataDirectory = process.env.DIRAC_DATA_DIR!
		const legacyPath = path.join(dataDirectory, "acp-session-updates.json")
		fs.writeFileSync(
			legacyPath,
			JSON.stringify({
				"session-1": [
					{
						kind: "session_update",
						sequenceNumber: 1,
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: "legacy" },
							_meta: { "dev.dirac/seq": 1 },
						},
					},
				],
			}),
		)
		const journal = await import("./acp-session-updates.js")
		expect(journal.getSessionUpdates("session-1")).toHaveLength(1)
		expect(fs.existsSync(legacyPath)).toBe(false)
		expect(JSON.parse(fs.readFileSync(journalFilePath(dataDirectory, "session-1"), "utf8"))).toMatchObject({
			version: 1,
			sessionId: "session-1",
		})
	})

	it("preserves a newer isolated journal when a stale legacy file reappears", async () => {
		const dataDirectory = process.env.DIRAC_DATA_DIR!
		const sessionId = "mixed-version-session"
		const legacyPath = path.join(dataDirectory, "acp-session-updates.json")
		const journal = await import("./acp-session-updates.js")
		journal.recordSessionUpdate(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "first" },
		} as any)
		journal.recordSessionUpdate(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "newer" },
		} as any)
		const isolatedBefore = fs.readFileSync(journalFilePath(dataDirectory, sessionId))
		const firstUpdate = journal.getSessionUpdates(sessionId)[0]
		fs.writeFileSync(legacyPath, JSON.stringify({ [sessionId]: [firstUpdate] }))

		expect(journal.getSessionUpdates(sessionId)).toHaveLength(2)
		expect(fs.readFileSync(journalFilePath(dataDirectory, sessionId))).toEqual(isolatedBefore)
		expect(fs.existsSync(legacyPath)).toBe(false)
	})

	it("reports conflicting legacy and isolated histories without overwriting either", async () => {
		const dataDirectory = process.env.DIRAC_DATA_DIR!
		const sessionId = "conflicting-session"
		const legacyPath = path.join(dataDirectory, "acp-session-updates.json")
		const journal = await import("./acp-session-updates.js")
		journal.recordSessionUpdate(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "isolated" },
		} as any)
		const isolatedPath = journalFilePath(dataDirectory, sessionId)
		const isolatedBefore = fs.readFileSync(isolatedPath)
		const conflictingUpdate = {
			kind: "session_update",
			sequenceNumber: 1,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "legacy" },
				_meta: { "dev.dirac/seq": 1 },
			},
		}
		const legacyContents = JSON.stringify({ [sessionId]: [conflictingUpdate] })
		fs.writeFileSync(legacyPath, legacyContents)

		expect(() => journal.getSessionUpdates(sessionId)).toThrow("Conflicting ACP session update histories")
		expect(fs.readFileSync(isolatedPath)).toEqual(isolatedBefore)
		expect(fs.readFileSync(legacyPath, "utf8")).toBe(legacyContents)
	})


	it("enforces a per-session size limit without changing the prior valid state", async () => {
		const dataDirectory = process.env.DIRAC_DATA_DIR!
		const sessionId = "bounded-session"
		process.env.DIRAC_ACP_SESSION_UPDATES_MAX_BYTES = "600"
		const journal = await import("./acp-session-updates.js")
		journal.recordSessionUpdate(sessionId, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "small" },
		} as any)
		const committedPath = journalFilePath(dataDirectory, sessionId)
		const before = fs.readFileSync(committedPath)

		expect(() =>
			journal.recordSessionUpdate(sessionId, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "x".repeat(2_000) },
			} as any),
		).toThrow("exceeding the 600-byte limit")
		expect(fs.readFileSync(committedPath)).toEqual(before)
		expect(() => JSON.parse(before.toString("utf8"))).not.toThrow()
	})
})
