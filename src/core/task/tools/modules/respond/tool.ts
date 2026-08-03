import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { DiracToolSpec } from "@/shared/tools"
import { RespondTool, respondSpec } from "./RespondTool"

export const spec: DiracToolSpec = respondSpec

export function create(): IDiracTool {
	return new RespondTool()
}
