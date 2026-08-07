import type { HistoryItem } from "@shared/HistoryItem"

/** Filters/sorts/caps task history for the active workspace root. */
export function processTaskHistory(taskHistory: HistoryItem[], primaryRootPath: string | undefined): HistoryItem[] {
	return taskHistory
		.filter((item) => {
			if (!item.ts || !item.task) return false
			if (!primaryRootPath) return true
			return !item.workspaceRootPath || item.workspaceRootPath === primaryRootPath
		})
		.sort((a, b) => b.ts - a.ts)
		.slice(0, 100)
}
