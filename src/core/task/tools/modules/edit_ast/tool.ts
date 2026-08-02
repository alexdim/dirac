import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { DiracToolSpec } from "@/shared/tools"
import { edit_ast_spec, EditAstTool } from "./EditAstTool"

export const spec: DiracToolSpec = edit_ast_spec

export function create(): IDiracTool {
	return new EditAstTool()
}
