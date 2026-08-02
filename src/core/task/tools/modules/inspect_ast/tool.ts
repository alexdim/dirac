import type { DiracToolSpec } from "@/shared/tools"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import { InspectAstTool, inspect_ast_spec } from "./InspectAstTool"

export const spec: DiracToolSpec = inspect_ast_spec

export function create(): IDiracTool {
	return new InspectAstTool()
}
