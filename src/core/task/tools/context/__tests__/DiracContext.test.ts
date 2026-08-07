import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { AnchorStateManager } from "@utils/AnchorStateManager"
import { DiracContext } from "../DiracContext"

const TASK_ID = "context-persistence"
const CONVERSATION_ID = "context-conversation"

function contextFile(diracHome: string): string {
	return path.join(diracHome, "data", "tasks", TASK_ID, "tool_context.json")
}

describe("DiracContext persistence", () => {
	let diracHome: string
	let previousDiracHome: string | undefined
	let stateManager: { flushPendingState: sinon.SinonStub }

	beforeEach(async () => {
		diracHome = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-context-"))
		previousDiracHome = process.env.DIRAC_DIR
		process.env.DIRAC_DIR = diracHome
		stateManager = { flushPendingState: sinon.stub().resolves() }
		AnchorStateManager.reset(CONVERSATION_ID)
	})

	afterEach(async () => {
		AnchorStateManager.reset(CONVERSATION_ID)
		if (previousDiracHome === undefined) delete process.env.DIRAC_DIR
		else process.env.DIRAC_DIR = previousDiracHome
		await fs.rm(diracHome, { recursive: true, force: true })
	})

	it("does not persist or flush when a tool never accesses context", async () => {
		const context = new DiracContext(TASK_ID, stateManager as any, CONVERSATION_ID)

		await context.save()

		await assert.rejects(fs.access(contextFile(diracHome)))
		sinon.assert.notCalled(stateManager.flushPendingState)
	})

	it("loads legacy pretty JSON without rewriting read-only context and writes compact mutations", async () => {
		const filePath = contextFile(diracHome)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		const legacy = JSON.stringify({ fileHashes: { "/workspace/a.ts#plain": { contentHash: "abc" } } }, null, 2)
		await fs.writeFile(filePath, legacy)
		const context = new DiracContext(TASK_ID, stateManager as any, CONVERSATION_ID)

		assert.deepEqual(await context.task.get("fileHashes"), { "/workspace/a.ts#plain": { contentHash: "abc" } })
		await context.save()
		assert.equal(await fs.readFile(filePath, "utf8"), legacy)
		sinon.assert.notCalled(stateManager.flushPendingState)

		await context.task.set("fileHashes", { "/workspace/a.ts#plain": { contentHash: "def" } })
		await context.save()
		const compact = await fs.readFile(filePath, "utf8")
		assert.equal(compact, JSON.stringify(JSON.parse(compact)))
		sinon.assert.calledOnce(stateManager.flushPendingState)

		await context.task.set("fileHashes", { "/workspace/a.ts#plain": { contentHash: "def" } })
		await context.save()
		sinon.assert.calledOnce(stateManager.flushPendingState)
	})

	it("persists changed anchor state and restores it lazily", async () => {
		const sourcePath = path.join(diracHome, "workspace", "source.ts")
		const context = new DiracContext(TASK_ID, stateManager as any, CONVERSATION_ID)
		await context.ensureAnchorState()
		const anchors = AnchorStateManager.reconcile(sourcePath, ["first", "second"], CONVERSATION_ID)
		context.markAnchorStateDirty()
		await context.save()

		AnchorStateManager.reset(CONVERSATION_ID)
		const restored = new DiracContext(TASK_ID, stateManager as any, CONVERSATION_ID)
		await restored.load()
		assert.equal(AnchorStateManager.getAnchors(sourcePath, CONVERSATION_ID), null)
		await restored.ensureAnchorState()
		assert.deepEqual(AnchorStateManager.getAnchors(sourcePath, CONVERSATION_ID), anchors)
	})
	it("serializes concurrent cache updates and retains anchor mutations made during persistence", async () => {
		const context = new DiracContext(TASK_ID, stateManager as any, CONVERSATION_ID)
		await Promise.all([
			context.task.update<Record<string, string>>("fileHashes", (current) => ({ ...current, first: "one" })),
			context.task.update<Record<string, string>>("fileHashes", (current) => ({ ...current, second: "two" })),
		])
		await context.save()
		assert.deepEqual(await context.task.get("fileHashes"), { first: "one", second: "two" })

		const sourcePath = path.join(diracHome, "workspace", "source.ts")
		await context.ensureAnchorState()
		AnchorStateManager.reconcile(sourcePath, ["first"], CONVERSATION_ID)
		context.markAnchorStateDirty()

		const originalWriteJson = (context as any).writeJson.bind(context)
		let releaseWrite!: () => void
		const writeReleased = new Promise<void>((resolve) => { releaseWrite = resolve })
		let signalWriteStarted!: () => void
		const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve })
		const writeJson = sinon.stub(context as any, "writeJson").callsFake(async (filePath, data) => {
			signalWriteStarted()
			await writeReleased
			await originalWriteJson(filePath, data)
		})

		const firstSave = context.save()
		await writeStarted
		const anchors = AnchorStateManager.reconcile(sourcePath, ["first", "second"], CONVERSATION_ID)
		context.markAnchorStateDirty()
		releaseWrite()
		await firstSave
		writeJson.restore()
		await context.save()

		AnchorStateManager.reset(CONVERSATION_ID)
		const restored = new DiracContext(TASK_ID, stateManager as any, CONVERSATION_ID)
		await restored.ensureAnchorState()
		assert.deepEqual(AnchorStateManager.getAnchors(sourcePath, CONVERSATION_ID), anchors)
		assert.deepEqual(await restored.task.get("fileHashes"), { first: "one", second: "two" })
	})

})
