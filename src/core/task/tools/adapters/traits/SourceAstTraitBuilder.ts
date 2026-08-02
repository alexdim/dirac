import { resolveWorkspacePath } from "@core/workspace"
import { SourceAstService } from "@services/source-ast/SourceAstService"
import { AnchorStateManager } from "@utils/AnchorStateManager"
import type { ISourceAstTrait } from "../../interfaces/IToolEnvironment"
import type { TaskConfig } from "../../types/TaskConfig"

export function buildSourceAstTrait(config: TaskConfig): ISourceAstTrait {
	const service = new SourceAstService({
		root: config.cwd,
		resolvePath: async (requestedPath) => {
			const resolved = resolveWorkspacePath(config, requestedPath, "SourceAstTraitBuilder.resolvePath")
			return typeof resolved === "string"
				? { absolutePath: resolved, displayPath: requestedPath }
				: { absolutePath: resolved.absolutePath, displayPath: resolved.displayPath }
		},
		validateAccess: (absolutePath) => config.services.diracIgnoreController.validateAccess(absolutePath),
		reconcileAnchors: (absolutePath, lines) => AnchorStateManager.reconcile(absolutePath, lines, config.ulid),
		getAnchorFingerprint: (absolutePath) => AnchorStateManager.getDocumentFingerprint(absolutePath, config.ulid),
	})

	return {
		outline: (request) => service.outline(request),
		implementations: (request) => service.implementations(request),
		occurrences: (request) => service.occurrences(request),
		planRename: (request) => service.planRename(request),
		planReplacements: (request) => service.planReplacements(request),
		getAnchorFingerprint: (path) => service.getAnchorFingerprint(path),
	}
}
