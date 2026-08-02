import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { SourceDefinitionCatalog } from "../SourceDefinitionCatalog"

const TYPESCRIPT_SOURCE = `export class First {
	/** First implementation. */
	run(): number {
		return 1
	}
}

export class Second {
	run(): number {
		return 2
	}
}
`

describe("SourceDefinitionCatalog", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-source-definition-catalog-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("returns exact qualified definitions and source ranges", async () => {
		const filePath = path.join(tempDir, "sample.ts")
		await fs.writeFile(filePath, TYPESCRIPT_SOURCE)
		const catalog = new SourceDefinitionCatalog({
			validateAccess: () => true,
			reconcileAnchors: (_path, lines) => lines.map((_, index) => `anchor-${index}`),
		})

		const result = await catalog.load(filePath, { displayPath: "sample.ts", includeAnchors: true })

		assert.equal(result.status, "success")
		if (result.status !== "success") return
		const firstRun = catalog.match(result.catalog.definitions, "First.run")
		assert.equal(firstRun.status, "success")
		if (firstRun.status !== "success") return

		assert.equal(firstRun.definition.qualifiedName, "First.run")
		assert.equal(
			result.catalog.content.slice(firstRun.definition.nameRange.startIndex, firstRun.definition.nameRange.endIndex),
			"run",
		)
		assert.match(
			result.catalog.content.slice(
				firstRun.definition.definitionRange.startIndex,
				firstRun.definition.definitionRange.endIndex,
			),
			/run\(\): number/,
		)
		const replacementText = result.catalog.content.slice(
			firstRun.definition.replacementRange.startIndex,
			firstRun.definition.replacementRange.endIndex,
		)
		assert.match(replacementText, /^\s*\/\*\* First implementation\. \*\//)
		assert.match(replacementText, /run\(\): number/)
		assert.equal(firstRun.definition.declarationText.trim(), "run(): number {")
		assert.equal(firstRun.definition.declarationLine, 2)
	})

	it("distinguishes exact qualified matches, ambiguous suffix matches, and missing symbols", async () => {
		const filePath = path.join(tempDir, "sample.ts")
		await fs.writeFile(filePath, TYPESCRIPT_SOURCE)
		const catalog = new SourceDefinitionCatalog({
			validateAccess: () => true,
			reconcileAnchors: () => [],
		})
		const result = await catalog.load(filePath)
		assert.equal(result.status, "success")
		if (result.status !== "success") return

		const exact = catalog.match(result.catalog.definitions, "Second.run")
		assert.equal(exact.status, "success")
		if (exact.status === "success") assert.equal(exact.definition.qualifiedName, "Second.run")

		const ambiguous = catalog.match(result.catalog.definitions, "run")
		assert.equal(ambiguous.status, "ambiguous")
		if (ambiguous.status === "ambiguous") {
			assert.deepEqual(ambiguous.candidates.map((candidate) => candidate.qualifiedName), ["First.run", "Second.run"])
		}
		assert.deepEqual(catalog.match(result.catalog.definitions, "missing"), { status: "not_found" })
	})

	it("reports inaccessible and unsupported files without presenting them as empty catalogs", async () => {
		const sourcePath = path.join(tempDir, "denied.ts")
		const unsupportedPath = path.join(tempDir, "notes.txt")
		await fs.writeFile(sourcePath, "export function value() { return 1 }\n")
		await fs.writeFile(unsupportedPath, "plain text\n")

		const deniedCatalog = new SourceDefinitionCatalog({
			validateAccess: () => false,
			reconcileAnchors: () => [],
		})
		assert.deepEqual(await deniedCatalog.load(sourcePath, { displayPath: "denied.ts" }), {
			status: "inaccessible",
			path: "denied.ts",
			message: "Access denied for denied.ts.",
		})

		const catalog = new SourceDefinitionCatalog({
			validateAccess: () => true,
			reconcileAnchors: () => [],
		})
		const unsupported = await catalog.load(unsupportedPath, { displayPath: "notes.txt" })
		assert.equal(unsupported.status, "unsupported")
	})
})
