import type { HistoryItem, TaskHistoryItem } from "@shared/HistoryItem"
import { GetTaskHistoryRequest } from "@shared/proto/dirac/task"
import { expect } from "chai"
import { describe, it } from "mocha"
import type { Controller } from ".."
import { getTaskHistory } from "./getTaskHistory"

function task(id: string, workspace: Partial<TaskHistoryItem> = {}): TaskHistoryItem {
	return {
		id,
		ts: 1,
		task: id,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		...workspace,
	}
}

function controllerWithHistory(history: HistoryItem[], primaryRootPath = "/workspace/current"): Controller {
	return {
		stateManager: {
			getGlobalStateKey: () => history,
		},
		ensureWorkspaceManager: async () => ({
			getPrimaryRoot: () => ({ path: primaryRootPath }),
		}),
	} as unknown as Controller
}

describe("getTaskHistory workspace filtering", () => {
	const history = [
		task("root", { workspaceRootPath: "/workspace/current/" }),
		task("cwd", { cwdOnTaskInitialization: "/workspace/current" }),
		task("shadow", { shadowGitConfigWorkTree: "/workspace/current" }),
		task("other", { workspaceRootPath: "/workspace/other" }),
		task("unattributed"),
		task("authoritative-root", {
			workspaceRootPath: "/workspace/other",
			cwdOnTaskInitialization: "/workspace/current",
		}),
	]

	it("returns only records attributable to the current workspace when requested", async () => {
		const result = await getTaskHistory(
			controllerWithHistory(history),
			GetTaskHistoryRequest.create({ currentWorkspaceOnly: true }),
		)

		expect(result.tasks.map((item) => item.id)).to.deep.equal(["root", "cwd", "shadow"])
	})

	it("retains an explicit all-workspaces view", async () => {
		const result = await getTaskHistory(
			controllerWithHistory(history),
			GetTaskHistoryRequest.create({ currentWorkspaceOnly: false }),
		)

		expect(result.tasks.map((item) => item.id)).to.have.members(history.map((item) => item.id))
	})
})
