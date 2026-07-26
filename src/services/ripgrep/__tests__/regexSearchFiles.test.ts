import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AnchorStateManager } from "@utils/AnchorStateManager"
import { afterEach, beforeEach, describe, it } from "mocha"
import { formatResults } from "../index"

let tmpDir: string
const taskId = "ripgrep-anchor-test"

describe("Ripgrep search result anchors", () => {
	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-ripgrep-anchor-"))
		AnchorStateManager.reset(taskId)
	})

	afterEach(async () => {
		AnchorStateManager.reset(taskId)
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("reconciles tracked anchors after the file is rewritten", async () => {
		const filePath = path.join(tmpDir, "target.txt")
		const oldLines = ["old first", "old second"]
		await fs.writeFile(filePath, oldLines.join("\n"))
		const oldAnchors = AnchorStateManager.reconcile(filePath, oldLines, taskId)

		const newLines = ["new first", "new second"]
		await fs.writeFile(filePath, newLines.join("\n"))
		const output = await formatResults(
			[{ filePath, lines: [{ lineNum: 1, content: "new first\n", isMatch: true }] }],
			1,
			tmpDir,
			taskId,
			true,
		)

		const emittedAnchor = output.match(/│([A-Z][a-zA-Z]*)§new first/)?.[1]
		assert.ok(emittedAnchor)
		assert.notEqual(emittedAnchor, oldAnchors[0])
		assert.equal(emittedAnchor, AnchorStateManager.getAnchors(filePath, taskId)?.[0])
	})

	it("does not initialize anchor state for plain search output", async () => {
		const filePath = path.join(tmpDir, "plain.txt")
		await fs.writeFile(filePath, "plain line")

		const output = await formatResults(
			[{ filePath, lines: [{ lineNum: 1, content: "plain line\n", isMatch: true }] }],
			1,
			tmpDir,
			taskId,
			false,
		)

		assert.ok(output.includes("│plain line"))
		assert.equal(AnchorStateManager.isTracking(filePath, taskId), false)
	})
})
