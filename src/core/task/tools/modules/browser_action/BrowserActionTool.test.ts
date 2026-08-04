import { describe, it } from "mocha"
import "should"
import { BrowserActionTool } from "./BrowserActionTool"

describe("BrowserActionTool", () => {
	it("strips the data URL prefix and preserves the screenshot media type", async () => {
		const tool = new BrowserActionTool()
		const blocks = await (tool as any).formatBrowserActionResult(
			"launch",
			{
				currentUrl: "https://example.com",
				logs: "",
				screenshot: "data:image/png;base64,cG5nLWJ5dGVz",
			},
			undefined,
		)

		blocks[1].should.deepEqual({
			type: "image",
			source: {
				type: "base64",
				media_type: "image/png",
				data: "cG5nLWJ5dGVz",
			},
		})
	})
})
