import { strict as assert } from "node:assert"
import type { AstImplementationResult, AstOccurrenceResult, AstOutlineResult } from "@services/source-ast/types"
import { InspectAstFormatter, type ImplementationCacheRecord } from "../InspectAstFormatter"
import { InspectAstResultReducer } from "../InspectAstResultReducer"

function definition(qualifiedName = "UserService.load") {
	return {
		simpleName: qualifiedName.split(".").at(-1)!,
		qualifiedName,
		kind: "method" as const,
		nameRange: { startIndex: 20, endIndex: 24, startLine: 1, startColumn: 10, endLine: 1, endColumn: 14 },
		definitionRange: { startIndex: 10, endIndex: 40, startLine: 1, startColumn: 0, endLine: 3, endColumn: 1 },
		replacementRange: { startIndex: 0, endIndex: 40, startLine: 0, startColumn: 0, endLine: 3, endColumn: 1 },
		declarationLine: 1,
		declarationText: "\tload() {",
		indentation: "\t",
		calls: ["fetchUser"],
		contextLines: [],
	}
}

describe("InspectAstFormatter", () => {
	const reducer = new InspectAstResultReducer()

	it("formats anchored outlines in one compact result block", () => {
		const result: AstOutlineResult = {
			files: [{
				path: "src/UserService.ts",
				absolutePath: "/repo/src/UserService.ts",
				status: "success",
				definitions: [definition()],
				lines: [{ lineNumber: 2, text: "\tload() {", anchor: "Apple" }],
			}],
		}
		const groups = reducer.reduceOutline(["src/UserService.ts"], result)
		const formatted = new InspectAstFormatter().formatOutline(groups, true)
		assert.equal(formatted.text, "src/UserService.ts\nApple§\tload() {\n\tcalls: fetchUser")
		assert.equal(formatted.summary.successCount, 1)
	})

	it("re-emits requested coordinates while abbreviating unchanged plain implementations", () => {
		const result: AstImplementationResult = {
			targets: [{
				path: "src/UserService.ts",
				absolutePath: "/repo/src/UserService.ts",
				symbol: "UserService.load",
				status: "success",
				definition: definition(),
				content: "load() {}",
				contentHash: "deadbeef",
				lines: [{ lineNumber: 2, text: "load() {}", anchor: "Apple" }],
			}],
		}
		const groups = reducer.reduceImplementations(["src/UserService.ts"], ["UserService.load"], result)
		const cache: Record<string, ImplementationCacheRecord | string> = {}
		const formatter = new InspectAstFormatter()

		const firstAnchored = formatter.formatImplementations(groups, true, cache, () => "fingerprint-1")
		const repeatedAnchored = formatter.formatImplementations(groups, true, cache, () => "fingerprint-1")
		assert.equal(firstAnchored.cacheStats.missCount, 1)
		assert.equal(repeatedAnchored.cacheStats.missCount, 1)
		assert.equal(repeatedAnchored.cacheStats.hitCount, 0)
		assert.match(repeatedAnchored.text, /^Apple§load\(\) \{\}$/m)
		assert.doesNotMatch(repeatedAnchored.text, /^unchanged$/m)

		const firstPlain = formatter.formatImplementations(groups, false, cache, () => null)
		const repeatedPlain = formatter.formatImplementations(groups, false, cache, () => null)
		assert.equal(firstPlain.cacheStats.missCount, 1)
		assert.equal(repeatedPlain.cacheStats.hitCount, 1)
		assert.match(repeatedPlain.text, /^unchanged$/m)
	})

	it("keeps occurrence issues inside the successful symbol block", () => {
		const result: AstOccurrenceResult = {
			targets: [{
				path: "src",
				symbol: "load",
				status: "success",
				partialFailure: true,
				partialFailureStatus: "inaccessible",
				failureMessages: ["Unable to read one indexed file."],
				occurrences: [{
					absolutePath: "/repo/src/UserService.ts",
					displayPath: "src/UserService.ts",
					symbol: "load",
					kind: "definition",
					startLine: 1,
					startColumn: 1,
					endLine: 1,
					endColumn: 5,
					sourceLine: "load() {}",
				}],
			}],
			occurrences: [],
		}
		const groups = reducer.reduceOccurrences("occurrences", ["src"], ["load"], result)
		const formatted = new InspectAstFormatter().formatOccurrences(groups, "occurrences", false)
		assert.match(formatted.text, /^src\/UserService\.ts$/m)
		assert.match(formatted.text, /^  definition 2:2 load\(\) \{\}$/m)
		assert.doesNotMatch(formatted.text, /Status:|Warnings:/)
		assert.match(formatted.text, /Unable to read one indexed file/)
		assert.equal(formatted.summary.successCount, 1)
		assert.equal(formatted.summary.issueCount, 1)
	})

	it("emits anchored occurrence source as a standalone exact line", () => {
		const result: AstOccurrenceResult = {
			targets: [{
				path: "src",
				symbol: "load",
				status: "success",
				occurrences: [{
					absolutePath: "/repo/src/UserService.ts",
					displayPath: "src/UserService.ts",
					symbol: "load",
					kind: "definition",
					startLine: 1,
					startColumn: 1,
					endLine: 1,
					endColumn: 5,
					sourceLine: "load() {}  ",
					anchor: "Apple",
				}],
			}],
			occurrences: [],
		}
		const groups = reducer.reduceOccurrences("occurrences", ["src"], ["load"], result)
		const formatted = new InspectAstFormatter().formatOccurrences(groups, "occurrences", true)

		assert.match(formatted.text, /^Apple§load\(\) \{\}  $/m)
		assert.doesNotMatch(formatted.text, /\[definition\].*Apple§/)
	})

})
