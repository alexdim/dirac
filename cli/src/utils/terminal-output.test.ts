import path from "node:path"
import { describe, expect, it } from "vitest"
import { sanitizeTerminalTitle } from "./display"
import { getPathUrl, terminalLink } from "./terminal-link"

describe("terminal control output", () => {
	it("removes control-sequence terminators from terminal titles", () => {
		expect(sanitizeTerminalTitle("safe\u0007\u001b]2;hijack\nnext")).toBe("safe ]2;hijack next")
	})

	it("removes OSC terminators from link labels and targets", () => {
		const link = terminalLink("label\u0007", "https://example.com/\u001b\\bad")
		expect(link).toContain("label")
		expect(link).not.toContain("\u0007")
		expect(link.match(/\u001b/g)).toHaveLength(4)
	})

	it("encodes filesystem paths as valid file URLs", () => {
		const url = getPathUrl(path.join(process.cwd(), "folder with spaces", "file#1.ts"))
		expect(url).toContain("folder%20with%20spaces")
		expect(url).toContain("file%231.ts")
	})
})
