import { DeleteAllTaskHistoryCount } from "@shared/proto/dirac/task"
import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "../../../utils/fs"
import { Controller } from ".."

/**
 * Deletes all task history, with an option to preserve favorites
 * @param controller The controller instance
 * @returns Results with count of deleted tasks
 */
export async function deleteAllTaskHistory(controller: Controller): Promise<DeleteAllTaskHistoryCount> {
	try {
		const initialTaskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
		const userChoice = (
			await HostProvider.window.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.WARNING,
					message: "What would you like to delete?",
					options: {
						modal: true,
						items: ["Delete All Except Favorites", "Delete Everything"],
					},
				}),
			)
		).selectedOption

		if (userChoice === undefined) {
			return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
		}

		const preserveFavorites = userChoice === "Delete All Except Favorites"
		let deleteEverythingConfirmed = userChoice === "Delete Everything"
		if (preserveFavorites && !initialTaskHistory.some((task) => task.isFavorited === true)) {
			deleteEverythingConfirmed = await confirmDeleteAllTasks()
			if (!deleteEverythingConfirmed) {
				return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
			}
		}

		await controller.clearTask()
		const currentTaskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
		const totalTasks = currentTaskHistory.length

		if (preserveFavorites) {
			const favoritedTasks = currentTaskHistory.filter((task) => task.isFavorited === true)
			if (favoritedTasks.length > 0) {
				controller.stateManager.setGlobalState("taskHistory", favoritedTasks)
				await cleanupTaskFiles(favoritedTasks.map((task) => task.id))

				try {
					await controller.postStateToWebview()
				} catch (webviewErr) {
					Logger.error("Error posting to webview:", webviewErr)
				}

				return DeleteAllTaskHistoryCount.create({
					tasksDeleted: totalTasks - favoritedTasks.length,
				})
			}
			if (!deleteEverythingConfirmed && !(await confirmDeleteAllTasks())) {
				await controller.postStateToWebview()
				return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
			}
		}

		controller.stateManager.setGlobalState("taskHistory", [])

		try {
			const taskDirPath = path.join(HostProvider.get().globalStorageFsPath, "tasks")
			if (await fileExistsAtPath(taskDirPath)) {
				await fs.rm(taskDirPath, { recursive: true, force: true })
			}

			const checkpointsDirPath = path.join(HostProvider.get().globalStorageFsPath, "checkpoints")
			if (await fileExistsAtPath(checkpointsDirPath)) {
				await fs.rm(checkpointsDirPath, { recursive: true, force: true })
			}
		} catch (error) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Encountered error while deleting task history, there may be some files left behind. Error: ${error instanceof Error ? error.message : String(error)}`,
			})
		}

		try {
			await controller.postStateToWebview()
		} catch (webviewErr) {
			Logger.error("Error posting to webview:", webviewErr)
		}

		return DeleteAllTaskHistoryCount.create({ tasksDeleted: totalTasks })
	} catch (error) {
		Logger.error("Error in deleteAllTaskHistory:", error)
		throw error
	}
}

async function confirmDeleteAllTasks(): Promise<boolean> {
	const answer = (
		await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: "No favorited tasks found. Would you like to delete all tasks anyway?",
			options: {
				modal: true,
				items: ["Delete All Tasks"],
			},
		})
	).selectedOption

	return answer === "Delete All Tasks"
}

/**
 * Helper function to cleanup task files while preserving specified tasks
 */
async function cleanupTaskFiles(preserveTaskIds: string[]) {
	const taskDirPath = path.join(HostProvider.get().globalStorageFsPath, "tasks")

	try {
		if (await fileExistsAtPath(taskDirPath)) {
			const taskDirs = await fs.readdir(taskDirPath)
			Logger.debug(`[cleanupTaskFiles] Found ${taskDirs.length} task directories`)

			// Delete only non-preserved task directories
			for (const dir of taskDirs) {
				if (!preserveTaskIds.includes(dir)) {
					// Task dir path is not workspace specific
					await fs.rm(path.join(taskDirPath, dir), {
						recursive: true,
						force: true,
					})
				}
			}
		}
	} catch (error) {
		Logger.error("Error cleaning up task files:", error)
	}

	return true
}
