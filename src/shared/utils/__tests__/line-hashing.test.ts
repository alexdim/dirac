import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
    containsAnchoredLine,
    getAnchoredLinePattern,
    getDelimiter,
    parseAnchoredLine,
    stripHashes,
    stripHashesFromDiff,
} from "../line-hashing"

const coordinate = (anchor: string, content: string) => `${anchor}${getDelimiter()}${content}`

describe("shared line-anchor helpers", () => {
	it("parses complete coordinates including blank source lines", () => {
		assert.deepEqual(parseAnchoredLine(coordinate("Apple", "")), { anchor: "Apple", content: "" })
		assert.equal(parseAnchoredLine("Apple"), null)
		assert.equal(parseAnchoredLine(`apple${getDelimiter()}line`), null)
	})

	it("detects anchored source lines in LF and CRLF content", () => {
		assert.equal(containsAnchoredLine(`ordinary\n${coordinate("Apple", "line")}`), true)
		assert.equal(containsAnchoredLine(`ordinary\r\n${coordinate("Apple", "line")}`), true)
		assert.equal(containsAnchoredLine(`ordinary\r\n  ${coordinate("Apple", "literal")}`), false)
	})

	it("strips anchor prefixes while preserving original line separators", () => {
		const input = `${coordinate("Apple", "first")}\r\n${coordinate("Banana", "second")}`
		assert.equal(stripHashes(input), "first\r\nsecond")

		const diff = `+${coordinate("Apple", "first")}\r\n ${coordinate("Banana", "second")}`
		assert.equal(stripHashesFromDiff(diff), "+first\r\n second")
	})

	it("produces a schema pattern for the current delimiter and blank content", () => {
		const pattern = new RegExp(getAnchoredLinePattern())
		assert.equal(pattern.test(coordinate("Apple", "")), true)
		assert.equal(pattern.test(coordinate("Apple", "content")), true)
		assert.equal(pattern.test("Apple"), false)
	})
})
