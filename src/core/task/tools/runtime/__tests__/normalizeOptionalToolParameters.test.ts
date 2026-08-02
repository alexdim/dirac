import { expect } from "chai"
import type { DiracToolSpec } from "@/shared/tools"
import { edit_file_spec } from "@core/task/tools/modules/edit_file/EditFileTool"
import { getDelimiter } from "@utils/line-hashing"
import { normalizeOptionalToolParameters } from "../normalizeOptionalToolParameters"

const spec: DiracToolSpec = {
	id: "test_tool",
	name: "test_tool",
	description: "Test tool",
	parameters: [
		{ name: "required_value", required: true, type: "string", instruction: "Required" },
		{ name: "optional_value", required: false, type: "string", instruction: "Optional" },
		{
			name: "entries",
			required: true,
			type: "array",
			instruction: "Entries",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					mode: { type: "string" },
					metadata: {
						type: "object",
						properties: {
							label: { type: "string" },
						},
						required: [],
					},
				},
				required: ["name"],
			},
		},
	],
}

describe("normalizeOptionalToolParameters", () => {
	it("removes top-level null placeholders only for optional parameters", () => {
		const result = normalizeOptionalToolParameters(
			{ required_value: null, optional_value: null, unknown_value: null },
			spec,
		)

		expect(result).to.deep.equal({ required_value: null, unknown_value: null })
	})

	it("recursively removes optional null placeholders from objects in arrays", () => {
		const result = normalizeOptionalToolParameters(
			{
				entries: [
					{
						name: null,
						mode: null,
						metadata: { label: null },
					},
				],
			},
			spec,
		)

		expect(result).to.deep.equal({ entries: [{ name: null, metadata: {} }] })
	})

	it("removes strict-provider null for insertion end_anchor but preserves required nulls", () => {
		const coordinate = `Apple${getDelimiter()}const value = 1`
		const result = normalizeOptionalToolParameters({
			files: [{
				path: "src/example.ts",
				edits: [{
					edit_type: "insert_after",
					anchor: coordinate,
					end_anchor: null,
					text: null,
				}],
			}],
		}, edit_file_spec)

		expect(result).to.deep.equal({
			files: [{
				path: "src/example.ts",
				edits: [{ edit_type: "insert_after", anchor: coordinate, text: null }],
			}],
		})
	})

})
