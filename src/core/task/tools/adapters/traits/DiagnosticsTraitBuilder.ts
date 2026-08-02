import { HostProvider } from "@/hosts/host-provider"
import type { IDiagnosticsTrait } from "../../interfaces/IToolEnvironment"

export function buildDiagnosticsTrait(): IDiagnosticsTrait {
	return {
		prepare: async (paths) => {
			await HostProvider.workspace.prepareDiagnostics({ filePaths: paths })
		},
		getRaw: async (paths) => {
			const response = await HostProvider.workspace.getDiagnostics({ filePaths: paths })
			return response.fileDiagnostics || []
		},
	}
}
