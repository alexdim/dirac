import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "mocha"
import { SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { SubagentRunRecorder } from "../SubagentRunRecorder"

const temporaryDirectories: string[] = []

async function createRecorder(runId = "run-1", taskDirectory?: string): Promise<SubagentRunRecorder> {
	const directory = taskDirectory ?? (await fs.mkdtemp(path.join(os.tmpdir(), "dirac-subagent-recorder-")))
	if (!taskDirectory) temporaryDirectories.push(directory)
	return await SubagentRunRecorder.create({
		taskId: "task-1",
		agent: { id: 7, name: "Research Agent" },
		taskTitle: "Inspect recorder output",
		prompt: "Inspect the recorder",
		timeoutSeconds: 600,
		includeHistory: false,
		providerId: "test-provider",
		modelId: "test-model",
		taskDirectory: directory,
		runId,
	})
}

async function readArtifact(recorder: SubagentRunRecorder, artifact: "transcriptPath" | "diagnosticsPath" | "indexPath") {
	return await fs.readFile(recorder.getPaths()[artifact], "utf8")
}

describe("SubagentRunRecorder", () => {
	afterEach(async () => {
		await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
	})

	it("creates append-only transcript, diagnostics, and task index artifacts", async () => {
		const recorder = await createRecorder()
		const paths = recorder.getPaths()

		await recorder.recordTranscript({ type: "assistant_text", details: { text: "first visible response" } })
		await recorder.recordDiagnostic({ type: "phase_entered", phase: "building_initial_context", details: { attempt: 1 } })
		await recorder.recordTerminal(SubagentExecutionStatus.COMPLETED, { result: "done" })
		await recorder.flush()

		const [transcript, diagnostics, index] = await Promise.all([
			readArtifact(recorder, "transcriptPath"),
			readArtifact(recorder, "diagnosticsPath"),
			readArtifact(recorder, "indexPath"),
		])
		assert.match(transcript, /# Subagent transcript/)
		assert.match(transcript, /first visible response/)
		assert.match(transcript, /event 2 · terminal/)
		assert.match(diagnostics, /# Subagent diagnostics/)
		assert.match(diagnostics, /building_initial_context/)
		assert.match(diagnostics, /completed/)
		assert.match(index, /"status": "started"/)
		assert.match(index, /"status": "completed"/)
		assert.match(index, /run-1\/transcript\.md/)
		assert.match(index, /run-1\/diagnostics\.md/)
		await assert.doesNotReject(fs.access(paths.transcriptPath))
		await assert.doesNotReject(fs.access(paths.diagnosticsPath))
	})

	it("orders concurrent records without rewriting prior content", async () => {
		const recorder = await createRecorder()
		await Promise.all(
			Array.from({ length: 12 }, (_unused, index) =>
				recorder.recordTranscript({ type: "progress", details: { marker: `event-${index + 1}` } }),
			),
		)
		await recorder.flush()

		const transcript = await readArtifact(recorder, "transcriptPath")
		for (let index = 1; index <= 12; index += 1) {
			assert.match(transcript, new RegExp(`event ${index} · progress`))
			assert.match(transcript, new RegExp(`"marker": "event-${index}"`))
		}
		assert.ok(transcript.indexOf('"marker": "event-1"') < transcript.indexOf('"marker": "event-12"'))
	})

	it("preserves structured visible activity while redacting secrets and serializing exceptional values", async () => {
		const recorder = await createRecorder()
		const circular: { label: string; self?: unknown } = { label: "circular" }
		circular.self = circular
		await recorder.recordTranscript({
			type: "tool_call",
			details: {
				input: { path: "src", apiKey: "do-not-store" },
				bearer: "Bearer top-secret-value",
				providerToken: "sk-12345678901234567890",
				fence: "`````",
				circular,
				error: new Error("Bearer hidden-in-error"),
				large: 1n,
			},
		})
		await recorder.flush()

		const transcript = await readArtifact(recorder, "transcriptPath")
		assert.match(transcript, /"path": "src"/)
		assert.match(transcript, /"apiKey": "\[REDACTED\]"/)
		assert.match(transcript, /Bearer \[REDACTED\]/)
		assert.equal(transcript.includes("top-secret-value"), false)
		assert.equal(transcript.includes("12345678901234567890"), false)
		assert.match(transcript, /"self": "\[CIRCULAR\]"/)
		assert.match(transcript, /"large": "1"/)
		assert.match(transcript, /"message": "Bearer \[REDACTED\]"/)
		assert.match(transcript, /``````json/)
	})

	it("isolates concurrent runs while recording their terminal summaries in the shared index", async () => {
		const taskDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-subagent-recorder-shared-"))
		temporaryDirectories.push(taskDirectory)
		const [first, second] = await Promise.all([
			createRecorder("first", taskDirectory),
			createRecorder("second", taskDirectory),
		])
		await Promise.all([
			first.recordTerminal(SubagentExecutionStatus.FAILED, { error: "first failed" }),
			second.recordTerminal(SubagentExecutionStatus.CANCELLED, { error: "second cancelled" }),
		])
		await Promise.all([first.flush(), second.flush()])

		assert.notEqual(first.getPaths().runDirectory, second.getPaths().runDirectory)
		assert.match(await readArtifact(first, "transcriptPath"), /first failed/)
		assert.match(await readArtifact(second, "transcriptPath"), /second cancelled/)
		const sharedIndex = await readArtifact(first, "indexPath")
		assert.match(sharedIndex, /first\/transcript\.md/)
		assert.match(sharedIndex, /second\/transcript\.md/)
	})
})
