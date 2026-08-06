import { getErrorMessage } from "@/shared/errors"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"
import type { Edit, FileEdit } from "./types"

/** Validates and normalizes the file-level shape while preserving per-edit partial success. */
export class EditFileValidator {
	validateFiles(args: { files: string | FileEdit[] }, env: IToolEnvironment): FileEdit[] | string {
		let files: unknown = args?.files
		if (typeof files === "string") {
			try {
				files = JSON.parse(files)
			} catch (error) {
				return this.fail(env, `The 'files' parameter contains invalid JSON: ${getErrorMessage(error)}`)
			}
		}
		if (!Array.isArray(files) || files.length === 0) {
			return this.fail(env, "The 'files' parameter must be a non-empty array of file objects.")
		}

		const normalized: FileEdit[] = []
		for (const [fileIndex, candidate] of files.entries()) {
			if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
				return this.fail(env, `files[${fileIndex}] must be an object.`)
			}
			const file = candidate as Record<string, unknown>
			if (typeof file.path !== "string" || file.path.trim().length === 0) {
				return this.fail(env, `files[${fileIndex}].path must be a non-empty string.`)
			}

			let edits = file.edits
			if (typeof edits === "string") {
				try {
					edits = JSON.parse(edits)
				} catch {
					return this.fail(env, `files[${fileIndex}].edits must be a valid JSON array of edit objects.`)
				}
			}
			if (!Array.isArray(edits) || edits.length === 0) {
				return this.fail(env, `files[${fileIndex}].edits must be a non-empty array of edit objects.`)
			}
			normalized.push({ path: file.path, edits: edits as Edit[] })
		}
		return normalized
	}

	private fail(env: IToolEnvironment, message: string): string {
		env.orchestration.setTaskState("consecutiveMistakeCount", env.config.taskState.consecutiveMistakeCount + 1)
		return message
	}
}
