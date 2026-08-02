import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { SourceDefinitionCatalog } from "../SourceDefinitionCatalog"
import { SourceMutationPlanner } from "../SourceMutationPlanner"
import type {
	AstOccurrenceResult,
	SourceDefinition,
	SourceFileCatalog,
	SourceRange,
} from "../types"

function range(startIndex: number, endIndex: number): SourceRange {
	return {
		startIndex,
		endIndex,
		startLine: 0,
		startColumn: startIndex,
		endLine: 0,
		endColumn: endIndex,
	}
}

function definition(symbol: string, replacementRange: SourceRange): SourceDefinition {
	return {
		simpleName: symbol,
		qualifiedName: symbol,
		kind: "function",
		nameRange: replacementRange,
		definitionRange: replacementRange,
		replacementRange,
		declarationLine: 0,
		declarationText: symbol,
		indentation: "",
		calls: [],
		contextLines: [],
	}
}

function occurrenceResult(
	absolutePath: string,
	displayPath: string,
	symbol: string,
	locations: Array<{ startColumn: number; endColumn: number }>,
): AstOccurrenceResult {
	const occurrences = locations.map((location) => ({
		absolutePath,
		displayPath,
		symbol,
		kind: "reference" as const,
		startLine: 0,
		startColumn: location.startColumn,
		endLine: 0,
		endColumn: location.endColumn,
	}))
	return {
		targets: [{ path: displayPath, symbol, status: "success", occurrences }],
		occurrences,
	}
}

describe("SourceMutationPlanner", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-source-mutation-planner-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("rejects stale rename coordinates without mutating an unexpected slice", async () => {
		const filePath = path.join(tempDir, "rename.ts")
		await fs.writeFile(filePath, "actual();\n")
		const planner = new SourceMutationPlanner({
			resolvePath: async (requestedPath) => ({ absolutePath: filePath, displayPath: requestedPath }),
			definitionCatalog: {} as any,
			occurrenceResolver: {
				resolve: async () => occurrenceResult(filePath, "rename.ts", "expected", [{ startColumn: 0, endColumn: 6 }]),
			} as any,
		})

		const plan = await planner.planRename({ paths: ["rename.ts"], symbol: "expected", replacement: "renamed" })

		assert.equal(plan.files.length, 0)
		assert.equal(plan.editCount, 0)
		assert.equal(plan.failures.length, 1)
		assert.equal(plan.failures[0].status, "parse_error")
		assert.match(plan.failures[0].message, /Stale symbol-index location/)
		assert.equal(await fs.readFile(filePath, "utf8"), "actual();\n")
	})

	it("deduplicates repeated rename locations and preserves exact original bytes", async () => {
		const filePath = path.join(tempDir, "rename.ts")
		const original = "old + old\r\n"
		await fs.writeFile(filePath, original)
		const planner = new SourceMutationPlanner({
			resolvePath: async (requestedPath) => ({ absolutePath: filePath, displayPath: requestedPath }),
			definitionCatalog: {} as any,
			occurrenceResolver: {
				resolve: async () => occurrenceResult(filePath, "rename.ts", "old", [
					{ startColumn: 0, endColumn: 3 },
					{ startColumn: 0, endColumn: 3 },
					{ startColumn: 6, endColumn: 9 },
				]),
			} as any,
		})

		const plan = await planner.planRename({ paths: ["rename.ts"], symbol: "old", replacement: "newName" })

		assert.equal(plan.failures.length, 0)
		assert.equal(plan.editCount, 2)
		assert.equal(plan.files.length, 1)
		assert.equal(plan.files[0].originalContent, original)
		assert.equal(plan.files[0].content, "newName + newName\r\n")
		assert.deepEqual(plan.files[0].changedSymbols, ["old"])
		assert.equal(await fs.readFile(filePath, "utf8"), original)
	})

	it("turns a rename to the existing identifier into an explicit no-op", async () => {
		const filePath = path.join(tempDir, "rename.ts")
		await fs.writeFile(filePath, "old();\n")
		const planner = new SourceMutationPlanner({
			resolvePath: async (requestedPath) => ({ absolutePath: filePath, displayPath: requestedPath }),
			definitionCatalog: {} as any,
			occurrenceResolver: {
				resolve: async () => occurrenceResult(filePath, "rename.ts", "old", [{ startColumn: 0, endColumn: 3 }]),
			} as any,
		})

		const plan = await planner.planRename({ paths: ["rename.ts"], symbol: "Namespace.old", replacement: "old" })

		assert.equal(plan.files.length, 0)
		assert.equal(plan.editCount, 0)
		assert.deepEqual(plan.unchangedTargets, [{
			path: "rename.ts",
			symbol: "Namespace.old",
			reason: "The requested name is unchanged.",
		}])
	})

	it("rejects rename plans when reference ownership is ambiguous", async () => {
		const filePath = path.join(tempDir, "rename.ts")
		await fs.writeFile(filePath, "run();\n")
		const occurrence = {
			absolutePath: filePath,
			displayPath: "rename.ts",
			symbol: "First.run",
			kind: "definition" as const,
			startLine: 0,
			startColumn: 0,
			endLine: 0,
			endColumn: 3,
		}
		const planner = new SourceMutationPlanner({
			resolvePath: async (requestedPath) => ({ absolutePath: filePath, displayPath: requestedPath }),
			definitionCatalog: {} as any,
			occurrenceResolver: {
				resolve: async () => ({
					targets: [{
						path: "rename.ts",
						symbol: "First.run",
						status: "success" as const,
						occurrences: [occurrence],
						partialFailure: true,
						partialFailureStatus: "ambiguous" as const,
						failureMessages: ["Reference ownership is ambiguous."],
					}],
					occurrences: [occurrence],
				}),
			} as any,
		})

		const plan = await planner.planRename({ paths: ["rename.ts"], symbol: "First.run", replacement: "execute" })

		assert.equal(plan.files.length, 0)
		assert.equal(plan.editCount, 0)
		assert.equal(plan.failures[0].status, "ambiguous")
		assert.match(plan.failures[0].message, /Reference ownership is ambiguous/)
		assert.equal(await fs.readFile(filePath, "utf8"), "run();\n")
	})


	it("uses catalog replacement ranges and reports identical replacement text as a no-op", async () => {
		const filePath = path.join(tempDir, "replace.ts")
		const original = "/** owned documentation */\nexport function load(): number {\n\treturn 1\n}\n"
		await fs.writeFile(filePath, original)
		const catalog = new SourceDefinitionCatalog({ validateAccess: () => true, reconcileAnchors: () => [] })
		const loaded = await catalog.load(filePath)
		assert.equal(loaded.status, "success")
		if (loaded.status !== "success") return
		const match = catalog.match(loaded.catalog.definitions, "load")
		assert.equal(match.status, "success")
		if (match.status !== "success") return
		const ownedText = loaded.catalog.content.slice(
			match.definition.replacementRange.startIndex,
			match.definition.replacementRange.endIndex,
		)
		assert.match(ownedText, /^\/\*\* owned documentation \*\//)

		const planner = new SourceMutationPlanner({
			resolvePath: async (requestedPath) => ({ absolutePath: filePath, displayPath: requestedPath }),
			definitionCatalog: catalog,
			occurrenceResolver: {} as any,
		})
		const noOp = await planner.planReplacements({ targets: [{ path: "replace.ts", symbol: "load", replacement: ownedText }] })
		assert.equal(noOp.files.length, 0)
		assert.deepEqual(noOp.unchangedTargets, [{ path: "replace.ts", symbol: "load", reason: "Replacement is identical." }])

		const replacement = "export function load(): number {\n\treturn 2\n}"
		const plan = await planner.planReplacements({ targets: [{ path: "replace.ts", symbol: "load", replacement }] })
		assert.equal(plan.files[0].originalContent, original)
		assert.equal(plan.files[0].content, `${replacement}\n`)
		assert.equal(await fs.readFile(filePath, "utf8"), original)
	})

	it("rejects duplicate and overlapping replacement ranges before producing content", async () => {
		const filePath = path.join(tempDir, "overlap.ts")
		const original = "abcdefghij"
		await fs.writeFile(filePath, original)
		const definitions = [definition("outer", range(0, 10)), definition("inner", range(2, 5))]
		const catalogData: SourceFileCatalog = {
			absolutePath: filePath,
			displayPath: "overlap.ts",
			content: original,
			lines: [original],
			definitions,
		}
		const fakeCatalog = {
			load: async () => ({ status: "success" as const, catalog: catalogData }),
			match: (_definitions: SourceDefinition[], symbol: string) => ({
				status: "success" as const,
				definition: definitions.find((candidate) => candidate.qualifiedName === symbol)!,
			}),
		}
		const planner = new SourceMutationPlanner({
			resolvePath: async (requestedPath) => ({ absolutePath: filePath, displayPath: requestedPath }),
			definitionCatalog: fakeCatalog as any,
			occurrenceResolver: {} as any,
		})

		await assert.rejects(
			() => planner.planReplacements({
				targets: [
					{ path: "overlap.ts", symbol: "outer", replacement: "OUTER" },
					{ path: "overlap.ts", symbol: "outer", replacement: "DUPLICATE" },
				]
			}),
			/Duplicate AST edit range/,
		)
		await assert.rejects(
			() => planner.planReplacements({
				targets: [
					{ path: "overlap.ts", symbol: "outer", replacement: "OUTER" },
					{ path: "overlap.ts", symbol: "inner", replacement: "INNER" },
				]
			}),
			/Overlapping AST edit ranges/,
		)
		assert.equal(await fs.readFile(filePath, "utf8"), original)
	})
})
