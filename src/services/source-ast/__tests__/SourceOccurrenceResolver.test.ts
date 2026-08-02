import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import type { SymbolLocation } from "@services/symbol-index/SymbolIndexService"
import { SourceOccurrenceResolver } from "../SourceOccurrenceResolver"
import { SourceDefinitionCatalog } from "../SourceDefinitionCatalog"

interface FakeIndexOptions {
	root: string
	locations?: SymbolLocation[]
	initializeError?: Error
}

function fakeIndex(options: FakeIndexOptions) {
	let projectRoot = options.root
	return {
		initialize: async () => {
			if (options.initializeError) throw options.initializeError
		},
		getProjectRoot: () => projectRoot,
		shouldIndexPath: () => true,
		updateFile: async () => undefined,
		getDefinitions: () => (options.locations ?? []).filter((location) => location.type === "definition"),
		getReferences: () => (options.locations ?? []).filter((location) => location.type === "reference"),
		getSymbols: () => options.locations ?? [],
		setProjectRoot: (root: string) => {
			projectRoot = root
		},
	} as any
}

describe("SourceOccurrenceResolver", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-source-occurrences-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("uses exact descendant boundaries, deduplicates overlapping scopes, and sorts deterministically", async () => {
		const appDir = path.join(tempDir, "src", "app")
		const siblingDir = path.join(tempDir, "src", "application")
		await fs.mkdir(appDir, { recursive: true })
		await fs.mkdir(siblingDir, { recursive: true })
		const aPath = path.join(appDir, "a.ts")
		const bPath = path.join(appDir, "b.ts")
		const siblingPath = path.join(siblingDir, "ignored.ts")
		await fs.writeFile(aPath, "target()\n")
		await fs.writeFile(bPath, "target()\n")
		await fs.writeFile(siblingPath, "target()\n")

		const locations: SymbolLocation[] = [
			{ path: path.relative(tempDir, bPath), startLine: 0, startColumn: 0, endLine: 0, endColumn: 6, type: "reference" },
			{ path: path.relative(tempDir, aPath), startLine: 0, startColumn: 0, endLine: 0, endColumn: 6, type: "definition" },
			{ path: path.relative(tempDir, aPath), startLine: 0, startColumn: 0, endLine: 0, endColumn: 6, type: "definition" },
			{ path: path.relative(tempDir, siblingPath), startLine: 0, startColumn: 0, endLine: 0, endColumn: 6, type: "reference" },
		]
		const resolver = new SourceOccurrenceResolver({
			root: tempDir,
			resolvePath: async (requestedPath) => ({
				absolutePath: path.join(tempDir, requestedPath),
				displayPath: requestedPath,
			}),
			validateAccess: () => true,
			reconcileAnchors: (_absolutePath, lines) => lines.map((_, index) => `anchor-${index}`),
			index: fakeIndex({ root: tempDir, locations }),
		})

		const result = await resolver.resolve({
			paths: ["src/app", "src/app/a.ts"],
			symbols: ["target"],
			kind: "both",
			includeAnchors: true,
		})

		assert.deepEqual(result.occurrences.map((occurrence) => occurrence.displayPath), ["src/app/a.ts", "src/app/b.ts"])
		assert.deepEqual(result.occurrences.map((occurrence) => occurrence.kind), ["definition", "reference"])
		assert.equal(result.occurrences[0].anchor, "anchor-0")
		assert.equal(result.occurrences.some((occurrence) => occurrence.absolutePath === siblingPath), false)
		assert.equal(result.targets.length, 2)
		assert.equal(result.targets.every((target) => target.status === "success"), true)
	})

	it("reports inaccessible scopes and stale indexed lines explicitly", async () => {
		const filePath = path.join(tempDir, "source.ts")
		await fs.writeFile(filePath, "target()\n")
		const resolver = new SourceOccurrenceResolver({
			root: tempDir,
			resolvePath: async (requestedPath) => {
				if (requestedPath === "missing") throw new Error("missing")
				return { absolutePath: filePath, displayPath: requestedPath }
			},
			validateAccess: () => true,
			reconcileAnchors: () => [],
			index: fakeIndex({
				root: tempDir,
				locations: [{ path: filePath, startLine: 99, startColumn: 0, endLine: 99, endColumn: 6, type: "reference" }],
			}),
		})

		const result = await resolver.resolve({ paths: ["missing", "source.ts"], symbols: ["target"], kind: "reference" })

		const missing = result.targets.find((target) => target.path === "missing")
		assert.equal(missing?.status, "inaccessible")
		const stale = result.targets.find((target) => target.path === "source.ts")
		assert.equal(stale?.status, "inaccessible")
		assert.equal(stale?.partialFailure, true)
		assert.match(stale?.message ?? "", /Stale symbol-index line/)
	})

	it("selects qualified definitions and rejects ambiguous same-named occurrence lookups", async () => {
		const filePath = path.join(tempDir, "same-name.ts")
		const source = [
			"class First {",
			"\trun() { return 1 }",
			"}",
			"class Second {",
			"\trun() { return 2 }",
			"}",
			"const first = new First()",
			"first.run()",
			"",
		].join("\n")
		await fs.writeFile(filePath, source)
		const locations: SymbolLocation[] = [
			{ path: filePath, startLine: 1, startColumn: 1, endLine: 1, endColumn: 4, type: "definition" },
			{ path: filePath, startLine: 4, startColumn: 1, endLine: 4, endColumn: 4, type: "definition" },
			{ path: filePath, startLine: 7, startColumn: 6, endLine: 7, endColumn: 9, type: "reference" },
		]
		const resolver = new SourceOccurrenceResolver({
			root: tempDir,
			resolvePath: async (requestedPath) => ({ absolutePath: filePath, displayPath: requestedPath }),
			validateAccess: () => true,
			reconcileAnchors: () => [],
			definitionCatalog: new SourceDefinitionCatalog({ validateAccess: () => true, reconcileAnchors: () => [] }),
			index: fakeIndex({ root: tempDir, locations }),
		})

		const qualifiedDefinitions = await resolver.resolve({
			paths: ["same-name.ts"],
			symbols: ["First.run"],
			kind: "definition",
		})
		assert.equal(qualifiedDefinitions.targets[0].status, "success")
		assert.deepEqual(qualifiedDefinitions.occurrences.map((occurrence) => occurrence.startLine), [1])

		const qualifiedOccurrences = await resolver.resolve({
			paths: ["same-name.ts"],
			symbols: ["First.run"],
			kind: "both",
		})
		assert.equal(qualifiedOccurrences.targets[0].status, "success")
		assert.equal(qualifiedOccurrences.targets[0].partialFailure, true)
		assert.equal(qualifiedOccurrences.targets[0].partialFailureStatus, "ambiguous")
		assert.deepEqual(qualifiedOccurrences.occurrences.map((occurrence) => occurrence.startLine), [1])
		assert.match(qualifiedOccurrences.targets[0].message ?? "", /cannot assign references/)

		const unqualifiedOccurrences = await resolver.resolve({
			paths: ["same-name.ts"],
			symbols: ["run"],
			kind: "both",
		})
		assert.equal(unqualifiedOccurrences.targets[0].status, "ambiguous")
		assert.equal(unqualifiedOccurrences.occurrences.length, 0)
		assert.match(unqualifiedOccurrences.targets[0].message ?? "", /Use a dot-qualified symbol/)
	})


	it("treats a declaration and definition with one qualified identity as the same file-scoped symbol", async () => {
		const sourcePath = path.join(tempDir, "sample.c")
		const headerPath = path.join(tempDir, "sample.h")
		await fs.writeFile(sourcePath, "void say_hello(void) {}\nsay_hello();\n")
		await fs.writeFile(headerPath, "void say_hello(void);\n")
		const locations: SymbolLocation[] = [
			{ path: sourcePath, startLine: 0, startColumn: 5, endLine: 0, endColumn: 14, type: "definition" },
			{ path: sourcePath, startLine: 1, startColumn: 0, endLine: 1, endColumn: 9, type: "reference" },
			{ path: headerPath, startLine: 0, startColumn: 5, endLine: 0, endColumn: 14, type: "definition" },
		]
		const resolver = new SourceOccurrenceResolver({
			root: tempDir,
			resolvePath: async (requestedPath) => ({ absolutePath: sourcePath, displayPath: requestedPath }),
			validateAccess: () => true,
			reconcileAnchors: () => [],
			definitionCatalog: new SourceDefinitionCatalog({ validateAccess: () => true, reconcileAnchors: () => [] }),
			index: fakeIndex({ root: tempDir, locations }),
		})

		const result = await resolver.resolve({ paths: ["sample.c"], symbols: ["say_hello"], kind: "both" })

		assert.equal(result.targets[0].status, "success")
		assert.equal(result.targets[0].partialFailure, false)
		assert.deepEqual(result.occurrences.map((occurrence) => occurrence.kind), ["definition", "reference"])
	})

	it("reports denied indexed descendants without reading or returning them", async () => {
		const sourceDir = path.join(tempDir, "src")
		const allowedPath = path.join(sourceDir, "allowed.ts")
		const deniedPath = path.join(sourceDir, "denied.ts")
		await fs.mkdir(sourceDir, { recursive: true })
		await fs.writeFile(allowedPath, "target()\n")
		await fs.writeFile(deniedPath, "target()\n")
		const resolver = new SourceOccurrenceResolver({
			root: tempDir,
			resolvePath: async (requestedPath) => ({
				absolutePath: path.join(tempDir, requestedPath),
				displayPath: requestedPath,
			}),
			validateAccess: (absolutePath) => absolutePath !== deniedPath,
			reconcileAnchors: () => [],
			index: fakeIndex({
				root: tempDir,
				locations: [
					{ path: allowedPath, startLine: 0, startColumn: 0, endLine: 0, endColumn: 6, type: "reference" },
					{ path: deniedPath, startLine: 0, startColumn: 0, endLine: 0, endColumn: 6, type: "reference" },
				],
			}),
		})

		const result = await resolver.resolve({ paths: ["src"], symbols: ["target"], kind: "reference" })

		assert.equal(result.targets[0].status, "success")
		assert.equal(result.targets[0].partialFailure, true)
		assert.match(result.targets[0].message ?? "", /Access denied/)
		assert.deepEqual(result.occurrences.map((occurrence) => occurrence.absolutePath), [allowedPath])
	})


	it("throws when index initialization fails or does not bind to the requested root", async () => {
		const resolverWithFailure = new SourceOccurrenceResolver({
			root: tempDir,
			resolvePath: async () => ({ absolutePath: tempDir, displayPath: "." }),
			validateAccess: () => true,
			reconcileAnchors: () => [],
			index: fakeIndex({ root: tempDir, initializeError: new Error("index failed") }),
		})
		await assert.rejects(
			() => resolverWithFailure.resolve({ paths: ["."], symbols: ["target"], kind: "both" }),
			/index failed/,
		)

		const resolverWithWrongRoot = new SourceOccurrenceResolver({
			root: tempDir,
			resolvePath: async () => ({ absolutePath: tempDir, displayPath: "." }),
			validateAccess: () => true,
			reconcileAnchors: () => [],
			index: fakeIndex({ root: path.join(tempDir, "other") }),
		})
		await assert.rejects(
			() => resolverWithWrongRoot.resolve({ paths: ["."], symbols: ["target"], kind: "both" }),
			/Symbol index is unavailable/,
		)
	})
})
