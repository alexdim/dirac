/**
 * Tests for ensureRules/Workflows/HooksDirectoryExists — FU-9.
 *
 * Verifies the relocation from the TCC-protected ~/Documents/Dirac/{Rules,Workflows,Hooks}
 * to ~/.dirac/{Rules,Workflows,Hooks}, plus the best-effort migration that copies existing
 * files without clobbering and swallows EPERM on the legacy dir.
 */
import { expect } from "chai"
import fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import os from "os"
import path from "path"
import * as sinon from "sinon"
import { ensureHooksDirectoryExists, ensureRulesDirectoryExists, ensureWorkflowsDirectoryExists } from "../directoryEnsurers"
import * as pathsModule from "../paths"

const SUBDIRS = ["Rules", "Workflows", "Hooks"] as const
type Subdir = (typeof SUBDIRS)[number]

const ENSURER: Record<Subdir, () => Promise<string>> = {
	Rules: ensureRulesDirectoryExists,
	Workflows: ensureWorkflowsDirectoryExists,
	Hooks: ensureHooksDirectoryExists,
}

describe("directoryEnsurers — FU-9 (TCC-protected path relocation)", () => {
	let sandbox: sinon.SinonSandbox
	let fakeHome: string
	let fakeDocuments: string
	let realHome: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		realHome = os.homedir()
		const tmpBase = path.join(os.tmpdir(), `dirac-ensurers-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		fakeHome = path.join(tmpBase, "home")
		fakeDocuments = path.join(tmpBase, "Documents")
		await fs.mkdir(fakeHome, { recursive: true })
		await fs.mkdir(fakeDocuments, { recursive: true })
		// Stub getDiracHomePath → ~/.dirac under fakeHome; getDocumentsPath → fakeDocuments
		sandbox.stub(pathsModule, "getDiracHomePath").returns(path.join(fakeHome, ".dirac"))
		sandbox.stub(pathsModule, "getDocumentsPath").resolves(fakeDocuments)
	})

	afterEach(async () => {
		sandbox.restore()
		// sanity: real homedir was never touched
		if (realHome !== os.homedir()) throw new Error("homedir was mutated")
	})

	for (const subdir of SUBDIRS) {
		describe(`ensure${subdir}DirectoryExists`, () => {
			it(`returns ~/.dirac/${subdir} (not ~/Documents/Dirac/${subdir})`, async () => {
				const result = await ENSURER[subdir]()
				expect(result).to.equal(path.join(fakeHome, ".dirac", subdir))
			})

			it(`creates ~/.dirac/${subdir} if it does not exist`, async () => {
				const result = await ENSURER[subdir]()
				const stat = await fs.stat(result)
				expect(stat.isDirectory()).to.be.true
			})

			it("migrates files from legacy ~/Documents/Dirac/<subdir> to the new location", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				await fs.writeFile(path.join(legacyDir, "rule1.md"), "content-1")
				await fs.writeFile(path.join(legacyDir, "rule2.md"), "content-2")

				const result = await ENSURER[subdir]()

				const migrated = await fs.readdir(result)
				expect(migrated.sort()).to.deep.equal(["rule1.md", "rule2.md"])
				expect(await fs.readFile(path.join(result, "rule1.md"), "utf8")).to.equal("content-1")
			})

			it("does not clobber existing files in the new location (idempotent)", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				await fs.writeFile(path.join(legacyDir, "shared.md"), "legacy-content")

				const newDir = path.join(fakeHome, ".dirac", subdir)
				await fs.mkdir(newDir, { recursive: true })
				await fs.writeFile(path.join(newDir, "shared.md"), "new-content")

				await ENSURER[subdir]()

				expect(await fs.readFile(path.join(newDir, "shared.md"), "utf8")).to.equal("new-content")
			})

			it("swallows EPERM on legacy dir readdir (TCC-protected ~/Documents)", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				await fs.writeFile(path.join(legacyDir, "rule.md"), "content")
				// Simulate TCC denial on readdir of the legacy dir only
				const realReaddir = fs.readdir.bind(fs)
				sandbox.stub(fs, "readdir").callsFake(((p: string) => {
					if (p === legacyDir) {
						return Promise.reject(Object.assign(new Error("EPERM"), { code: "EPERM" }))
					}
					return realReaddir(p)
				}) as typeof fs.readdir)

				const result = await ENSURER[subdir]()

				// Still returns the new dir, just without migration
				expect(result).to.equal(path.join(fakeHome, ".dirac", subdir))
				const migrated = await fs.readdir(result)
				expect(migrated).to.deep.equal([])
			})

			it("does nothing when legacy dir does not exist", async () => {
				const result = await ENSURER[subdir]()
				const migrated = await fs.readdir(result)
				expect(migrated).to.deep.equal([])
			})
		})
	}
})
