import { StateManager } from "@core/storage/StateManager"
import { workspaceResolver } from "@core/workspace"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as sinon from "sinon"
import { expectLoggerErrors } from "@/test/loggerGuard"
import { getGlobalDiracRules, getLocalDiracRules } from "../dirac-rules"

describe("dirac-rules error propagation", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-dirac-rules-test-"))
		sandbox
			.stub(workspaceResolver, "resolveWorkspacePath")
			.callsFake((cwdOrRoots: string | unknown[], relativePath: string) => path.join(cwdOrRoots as string, relativePath))
		sandbox.stub(StateManager, "get").returns({
			getGlobalStateKey: () => ({}),
		} as any)
	})

	afterEach(async () => {
		sandbox.restore()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("getLocalDiracRules propagates per-file errors while loading the rest", async () => {
		expectLoggerErrors()
		const rulesDir = path.join(tempDir, ".diracrules")
		await fs.mkdir(rulesDir, { recursive: true })
		await fs.writeFile(path.join(rulesDir, "good.md"), "Always on")
		await fs.writeFile(path.join(rulesDir, "bad.md"), "Bad content")

		const goodPath = path.join(rulesDir, "good.md")
		const badPath = path.join(rulesDir, "bad.md")
		const readFileStub = sandbox.stub(fs, "readFile")
		readFileStub.withArgs(badPath, "utf8").rejects(new Error("forced read failure"))
		readFileStub.callThrough()

		const toggles: Record<string, boolean> = { [goodPath]: true, [badPath]: true }
		const result = await getLocalDiracRules(tempDir, toggles)

		expect(result.instructions).to.contain("good.md")
		expect(result.instructions).to.contain("Always on")
		expect(result.instructions).to.not.contain("Bad content")
		expect(result.errors).to.have.lengthOf(1)
		expect(result.errors![0]).to.include("bad.md")
	})

	it("getGlobalDiracRules propagates per-file errors while loading the rest", async () => {
		expectLoggerErrors()
		const rulesDir = path.join(tempDir, ".diracrules")
		await fs.mkdir(rulesDir, { recursive: true })
		await fs.writeFile(path.join(rulesDir, "good.md"), "Always on")
		await fs.writeFile(path.join(rulesDir, "bad.md"), "Bad content")

		const goodPath = path.join(rulesDir, "good.md")
		const badPath = path.join(rulesDir, "bad.md")
		const readFileStub = sandbox.stub(fs, "readFile")
		readFileStub.withArgs(badPath, "utf8").rejects(new Error("forced read failure"))
		readFileStub.callThrough()

		const toggles: Record<string, boolean> = { [goodPath]: true, [badPath]: true }
		const result = await getGlobalDiracRules(rulesDir, toggles)

		expect(result.instructions).to.contain("good.md")
		expect(result.instructions).to.contain("Always on")
		expect(result.instructions).to.not.contain("Bad content")
		expect(result.errors).to.have.lengthOf(1)
		expect(result.errors![0]).to.include("bad.md")
	})

	it("getLocalDiracRules propagates a single-file .diracrules read error", async () => {
		expectLoggerErrors()
		const rulesFile = path.join(tempDir, ".diracrules")
		await fs.writeFile(rulesFile, "Always on")
		const readFileStub = sandbox.stub(fs, "readFile")
		readFileStub.withArgs(rulesFile, "utf8").rejects(new Error("forced read failure"))
		readFileStub.callThrough()

		const toggles: Record<string, boolean> = { [rulesFile]: true }
		const result = await getLocalDiracRules(tempDir, toggles)

		expect(result.instructions).to.be.undefined
		expect(result.errors).to.have.lengthOf(1)
		expect(result.errors![0]).to.include(rulesFile)
	})
})
