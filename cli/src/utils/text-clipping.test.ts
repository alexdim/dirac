import { describe, expect, it } from "vitest"
import { clipTextToLastVisualLines, clipTextToWindow, estimateVisualLineCount } from "./text-clipping"

describe("visual text clipping", () => {
	it("counts wrapped logical lines", () => {
		expect(estimateVisualLineCount("abcdefghij", 4)).toBe(3)
		expect(estimateVisualLineCount("\n", 4)).toBe(2)
	})

	it("clips the contents of one long logical line to the row budget", () => {
		const clipped = clipTextToLastVisualLines("abcdefghijklmnop", 3, 4, "more")
		expect(clipped).toBe("more\nijkl\nmnop")
		expect(estimateVisualLineCount(clipped, 4)).toBe(3)
	})

	it("uses an inline clipping mark when only one row is available", () => {
		const clipped = clipTextToLastVisualLines("abcdefgh", 1, 4)
		expect(clipped).toHaveLength(4)
		expect(clipped.startsWith("…")).toBe(true)
	})

	it("moves a bounded window through wrapped rows", () => {
		const bottom = clipTextToWindow("abcdefghijklmnop", 3, 4, 0, "more")
		expect(bottom).toEqual({ visibleText: "more\nijkl\nmnop", hasMoreAbove: true, hasMoreBelow: false })

		const middle = clipTextToWindow("abcdefghijklmnop", 3, 4, 1, "more")
		expect(middle.visibleText).toBe("abcd\nefgh\nijkl")
		expect(middle.hasMoreAbove).toBe(false)
		expect(middle.hasMoreBelow).toBe(true)
	})
})
