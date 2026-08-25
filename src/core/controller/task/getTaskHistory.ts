import type { HistoryItem } from "@shared/HistoryItem"
import { isGoalHistoryItem } from "@shared/HistoryItem"
import { GetTaskHistoryRequest, TaskHistoryArray, TaskItem } from "@shared/proto/dirac/task"
import { Logger } from "@/shared/services/Logger"
import { arePathsEqual, getWorkspacePath } from "../../../utils/path"
import { Controller } from ".."

export function historyItemToTaskItem(item: HistoryItem): TaskItem {
	const base = {
		id: item.id,
		task: item.task,
		ts: item.ts,
		isFavorited: item.isFavorited ?? false,
		size: item.size ?? 0,
		modelId: item.modelId ?? "",
	}
	if (!isGoalHistoryItem(item)) {
		return TaskItem.create({
			...base,
			totalCost: item.totalCost,
			tokensIn: item.tokensIn,
			tokensOut: item.tokensOut,
			cacheWrites: item.cacheWrites ?? 0,
			cacheReads: item.cacheReads ?? 0,
		})
	}
	return TaskItem.create({
		...base,
		runKind: "goal",
		conversationUlid: item.conversationUlid,
		initialDisplayText: item.initialDisplayText,
		objectivePreview: item.objectivePreview,
		objectiveRevision: item.objectiveRevision,
		status: item.status,
		statusReason: item.statusReason,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
		activeDurationMs: item.activeDurationMs,
		accounting: item.accounting,
	})
}

/**
 * Gets filtered task history
 * @param controller The controller instance
 * @param request Filter parameters for task history
 * @returns TaskHistoryArray with filtered task list
 */
export async function getTaskHistory(controller: Controller, request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
	try {
		const { favoritesOnly, currentWorkspaceOnly, searchQuery, sortBy } = request

		// Get task history from global state
		const taskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
		const workspacePath = await getWorkspacePath()

		// Apply filters
		let filteredTasks = taskHistory.filter((item) => {
			const primaryRootPath = controller.getWorkspaceManager()?.getPrimaryRoot()?.path
			// Basic filter: must have timestamp and task content
			const hasRequiredFields = item.ts && item.task
			const isInCurrentWorkspace = !primaryRootPath || !item.workspaceRootPath || item.workspaceRootPath === primaryRootPath
			if (!hasRequiredFields || !isInCurrentWorkspace) {
				return false
			}

			// Apply favorites filter if requested
			if (favoritesOnly && !item.isFavorited) {
				return false
			}

			// Apply current workspace filter if requested
			if (currentWorkspaceOnly) {
				let isInWorkspace = item.workspaceRootPath ? arePathsEqual(item.workspaceRootPath, workspacePath) : false

				// First check the cwdOnTaskInitialization property - Only present on tasks from this change forward
				if (!isInWorkspace && item.cwdOnTaskInitialization) {
					if (arePathsEqual(item.cwdOnTaskInitialization, workspacePath)) {
						isInWorkspace = true
					}
				}

				// For tasks without cwdOnTaskInitialization, check the older shadowGitConfigWorkTree property
				if (!isInWorkspace && item.shadowGitConfigWorkTree) {
					if (arePathsEqual(item.shadowGitConfigWorkTree, workspacePath)) {
						isInWorkspace = true
					}
				}

				if (!isInWorkspace) {
					return false
				}
			}

			return true
		})

		// Apply search if provided
		if (searchQuery) {
			// Simple search implementation
			const query = searchQuery.toLowerCase()
			filteredTasks = filteredTasks.filter((item) => {
				const text = isGoalHistoryItem(item) ? item.objectivePreview : item.task
				return text.toLowerCase().includes(query)
			})
		}

		// Calculate total count before sorting
		const totalCount = filteredTasks.length

		// Apply sorting
		if (sortBy) {
			filteredTasks.sort((a, b) => {
				switch (sortBy) {
					case "oldest":
						return a.ts - b.ts
					case "mostExpensive":
						return historyCost(b) - historyCost(a)
					case "mostTokens":
						return historyTokens(b) - historyTokens(a)
					case "newest":
					default:
						return b.ts - a.ts
				}
			})
		} else {
			// Default sort by newest
			filteredTasks.sort((a, b) => b.ts - a.ts)
		}

		// Map to response format
		const tasks = filteredTasks.map(historyItemToTaskItem)

		return TaskHistoryArray.create({
			tasks,
			totalCount,
		})
	} catch (error) {
		Logger.error("Error in getTaskHistory:", error)
		throw error
	}
}

function historyCost(item: import("@shared/HistoryItem").HistoryItem): number {
	return isGoalHistoryItem(item) ? (item.accounting.cost ?? 0) : item.totalCost
}

function historyTokens(item: import("@shared/HistoryItem").HistoryItem): number {
	if (isGoalHistoryItem(item)) return item.accounting.totalTokens ?? 0
	return item.tokensIn + item.tokensOut + (item.cacheWrites ?? 0) + (item.cacheReads ?? 0)
}
