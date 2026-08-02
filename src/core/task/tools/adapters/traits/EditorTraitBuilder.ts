import type { IEditorTrait } from "../../interfaces/IToolEnvironment"
import type { TaskConfig } from "../../types/TaskConfig"

export function buildEditorTrait(config: TaskConfig): IEditorTrait {
	const diffView = () => config.services.diffViewProvider
	const mapSaveResult = (result: any) => ({
		content: result.finalContent || "",
		userEdits: !!result.userEdits,
		autoFormatting: !!result.autoFormattingEdits,
	})
	return {
		showReview: async (files) => await diffView().showReview(files),
		hideReview: async () => await diffView().hideReview(),
		open: async (path, options) => await diffView().open(path, options),
		update: async (content, finalize) => await diffView().update(content, finalize),
		saveChanges: async (options) => mapSaveResult(await diffView().saveChanges(options)),
		applyAndSaveSilently: async (path, content) => mapSaveResult(await diffView().applyAndSaveSilently(path, content)),
		applyAndSaveBatchSilently: async (files) => {
			const results = await diffView().applyAndSaveBatchSilently(files)
			const mapped = new Map<string, any>()
			for (const [path, result] of results.entries()) mapped.set(path, mapSaveResult(result))
			return mapped
		},
		revertChanges: async () => await diffView().revertChanges(),
		reset: async () => await diffView().reset(),
		scrollToFirstDiff: async () => await diffView().scrollToFirstDiff(),
		undoUserEdits: async () => await diffView().undoUserEdits(),
		format: async (path) => await diffView().format(path),
	}
}
