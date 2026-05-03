import { execSync } from "child_process"

/**
 * Get current git branch name
 */
export function getGitBranch(cwd?: string): string | null {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: cwd || process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()
		return branch
	} catch {
		return null
	}
}

export interface GitDiffStats {
	files: number
	additions: number
	deletions: number
}

/**
 * Get git diff stats (files changed, additions, deletions)
 */
export function getGitDiffStats(cwd?: string): GitDiffStats | null {
	try {
		const output = execSync("git diff --shortstat", {
			cwd: cwd || process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()

		if (!output) return null

		// Parse output like "2 files changed, 10 insertions(+), 5 deletions(-)"
		const filesMatch = output.match(/(\d+) file/)
		const addMatch = output.match(/(\d+) insertion/)
		const delMatch = output.match(/(\d+) deletion/)

		return {
			files: filesMatch ? Number.parseInt(filesMatch[1], 10) : 0,
			additions: addMatch ? Number.parseInt(addMatch[1], 10) : 0,
			deletions: delMatch ? Number.parseInt(delMatch[1], 10) : 0,
		}
	} catch {
		return null
	}
}
