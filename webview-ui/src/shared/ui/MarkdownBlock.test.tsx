import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BooleanResponse } from "@shared/proto/dirac/common"
import { FileServiceClient } from "@/shared/api/grpc-client"
import MarkdownBlock from "./MarkdownBlock"

describe("MarkdownBlock inline code", () => {
	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	it("does not reserve a file action for inline code that is not a file", async () => {
		const fileExists = vi
			.spyOn(FileServiceClient, "ifFileExistsRelativePath")
			.mockResolvedValue(BooleanResponse.create({ value: false }))
		const { container } = render(<MarkdownBlock markdown={"Validation: `diagnostics_scan` and `git diff --check` pass."} />)

		await waitFor(() => expect(fileExists).toHaveBeenCalledWith(expect.objectContaining({ value: "diagnostics_scan" })))

		expect(container.querySelector("code")).toHaveTextContent("diagnostics_scan")
		expect(container.querySelector("button")).not.toBeInTheDocument()
	})

	it("renders the file action only after the path is confirmed", async () => {
		const filePath = "src/shared/ui/MarkdownBlock.tsx"
		vi.spyOn(FileServiceClient, "ifFileExistsRelativePath").mockResolvedValue(BooleanResponse.create({ value: true }))

		render(<MarkdownBlock markdown={`Open \`${filePath}\`.`} />)

		expect(await screen.findByRole("button", { name: `Open ${filePath} in editor` })).toBeInTheDocument()
	})
})
