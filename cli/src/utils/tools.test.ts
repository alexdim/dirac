import { describe, expect, it } from "vitest"
import { getToolDescription, getToolMainArg, isFileEditTool, isFileSaveTool } from "./tools"

describe("AST tool display utilities", () => {
	it("classifies edit_ast as an edit and save tool", () => {
		expect(isFileEditTool("edit_ast")).toBe(true)
		expect(isFileEditTool("editAst")).toBe(true)
		expect(isFileSaveTool("edit_ast")).toBe(true)
	})

	it("describes the two consolidated AST tools", () => {
		expect(getToolDescription("inspect_ast")).toEqual({
			ask: "wants to inspect source structure",
			say: "inspected source structure",
		})
		expect(getToolDescription("edit_ast")).toEqual({
			ask: "wants to edit source symbols",
			say: "edited source symbols",
		})
	})

	it("summarizes inspect_ast by operation, symbols, and paths", () => {
		expect(
			getToolMainArg("inspect_ast", {
				operation: "references",
				symbols: ["User", "Account"],
				paths: ["src/core", "src/shared"],
			}),
		).toBe("references: User, Account in src/core, src/shared")
	})

	it("summarizes edit_ast without leaking replacement source", () => {
		const replacement = "export function load() { return secretPayload }"
		const summary = getToolMainArg("edit_ast", {
			operation: "replace",
			targets: [{ path: "src/service.ts", symbol: "UserService.load", replacement }],
		})

		expect(summary).toBe("replace: UserService.load in src/service.ts")
		expect(summary).not.toContain(replacement)
		expect(summary).not.toContain("secretPayload")
	})

	it("summarizes edit_ast rename using the identifier replacement", () => {
		expect(
			getToolMainArg("edit_ast", {
				operation: "rename",
				targets: [
					{ path: "src", symbol: "oldName", replacement: "newName" },
					{ path: "cli", symbol: "oldName", replacement: "newName" },
				],
			}),
		).toBe("rename: 'oldName' to 'newName' in src, cli")
	})
})
