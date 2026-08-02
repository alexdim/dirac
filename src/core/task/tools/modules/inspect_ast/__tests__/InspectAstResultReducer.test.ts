import { strict as assert } from "node:assert"
import type { AstOccurrenceResult } from "@services/source-ast/types"
import { InspectAstResultReducer } from "../InspectAstResultReducer"

function definition(qualifiedName: string, declarationLine = 0) {
	return {
		simpleName: qualifiedName.split(".").at(-1)!,
		qualifiedName,
		kind: "method" as const,
		nameRange: { startIndex: 0, endIndex: 3, startLine: declarationLine, startColumn: 0, endLine: declarationLine, endColumn: 3 },
		definitionRange: { startIndex: 0, endIndex: 10, startLine: declarationLine, startColumn: 0, endLine: declarationLine, endColumn: 10 },
		replacementRange: { startIndex: 0, endIndex: 10, startLine: declarationLine, startColumn: 0, endLine: declarationLine, endColumn: 10 },
		declarationLine,
		declarationText: `${qualifiedName}() {}`,
		indentation: "",
		calls: [],
		contextLines: [],
	}
}

function occurrence(symbol: string, path: string, kind: "definition" | "reference") {
	return {
		absolutePath: `/repo/${path}`,
		displayPath: path,
		symbol,
		kind,
		startLine: 1,
		startColumn: 2,
		endLine: 1,
		endColumn: 6,
		sourceLine: `${symbol}()`,
	}
}

describe("InspectAstResultReducer", () => {
	const reducer = new InspectAstResultReducer()

	it("produces one outline group per requested path", () => {
		const groups = reducer.reduceOutline(["src/a.ts", "src/b.ts"], {
			files: [{
				path: "src/a.ts",
				status: "success",
				definitions: [definition("A.run")],
				lines: [],
			}, {
				path: "src/b.ts",
				status: "not_found",
				definitions: [],
				lines: [],
			}],
		})

		assert.equal(groups.length, 2)
		assert.deepEqual(groups.map((group) => group.status), ["success", "failure"])
	})

	it("reduces Cartesian implementation targets to one group per symbol", () => {
		const groups = reducer.reduceImplementations(
			["src/a.ts", "src/b.ts"],
			["A.run", "B.load"],
			{
				targets: [{
					path: "src/a.ts",
					absolutePath: "/repo/src/a.ts",
					symbol: "A.run",
					status: "success",
					definition: definition("A.run"),
					contentHash: "a",
				}, {
					path: "src/b.ts",
					absolutePath: "/repo/src/b.ts",
					symbol: "A.run",
					status: "success",
					definition: definition("A.run"),
					contentHash: "b",
				}, {
					path: "src/a.ts",
					symbol: "B.load",
					status: "not_found",
				}, {
					path: "src/b.ts",
					symbol: "B.load",
					status: "not_found",
				}],
			},
		)

		assert.equal(groups.length, 2)
		assert.equal(groups[0].status, "success")
		assert.equal(groups[0].matches.length, 2)
		assert.equal(groups[1].status, "failure")
		assert.equal(groups[1].issues.length, 0)
	})

	for (const operation of ["definitions", "references", "occurrences"] as const) {
		it(`reduces Cartesian ${operation} targets to one deduplicated group per symbol`, () => {
			const shared = occurrence("A.run", "src/a.ts", operation === "references" ? "reference" : "definition")
			const result: AstOccurrenceResult = {
				targets: [{
					path: "src",
					symbol: "A.run",
					status: "success",
					occurrences: [shared],
				}, {
					path: "src/a.ts",
					symbol: "A.run",
					status: "success",
					occurrences: [shared],
				}, {
					path: "src",
					symbol: "B.load",
					status: "not_found",
					occurrences: [],
				}, {
					path: "src/a.ts",
					symbol: "B.load",
					status: "not_found",
					occurrences: [],
				}],
				occurrences: [shared],
			}
			const groups = reducer.reduceOccurrences(operation, ["src", "src/a.ts"], ["A.run", "B.load"], result)

			assert.equal(groups.length, 2)
			assert.equal(groups[0].status, "success")
			assert.equal(groups[0].occurrences.length, 1)
			assert.equal(groups[1].status, "failure")
		})
	}
})
