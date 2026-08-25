import type { StateManager } from "@core/storage/StateManager"
import { Task } from "@core/task"
import { projectUIActionState } from "@core/task/utils/ui-projector"
import { detectWorkspaceRoots } from "@core/workspace/detection"
import { setupWorkspaceManager } from "@core/workspace/setup"
import type { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { type ExtensionState, TaskStatus } from "@shared/ExtensionMessage"
import { assembleAuthState } from "./assembleAuthState"
import { assembleModelState } from "./assembleModelState"
import { assembleRuntimeState } from "./assembleRuntimeState"
import { assembleToolState } from "./assembleToolState"
import { discoverAvailableSkills } from "./discoverAvailableSkills"
import { processTaskHistory } from "./processTaskHistory"
import type { GoalViewState } from "@shared/goal"
import type { DiracMessage } from "@shared/ExtensionMessage"

export async function getStateToPostToWebview(deps: {
	stateManager: StateManager
	task?: Task | undefined
	workspaceManager?: WorkspaceRootManager | undefined
	backgroundCommandRunning: boolean
	backgroundCommandTaskId?: string | undefined
	goal?: GoalViewState
	goalMessages?: DiracMessage[]
}): Promise<ExtensionState> {
	const { stateManager, task, workspaceManager, backgroundCommandRunning, backgroundCommandTaskId, goal, goalMessages } = deps

	const resolvedWorkspaceManager =
		workspaceManager ?? (await setupWorkspaceManager({ stateManager, detectRoots: detectWorkspaceRoots }))
	const primaryRootPath = resolvedWorkspaceManager?.getPrimaryRoot()?.path
	const cwd = task?.cwd || primaryRootPath || process.cwd()

	const modelState = assembleModelState(stateManager)
	const authState = await assembleAuthState(stateManager)
	const { latestAnnouncementId, ...runtimeState } = await assembleRuntimeState()
	const toolState = await assembleToolState(stateManager, primaryRootPath, task?.taskId)
	const apiConfiguration = stateManager.getApiConfiguration()
	const mode = stateManager.getGlobalSettingsKey("mode")
	const configuredProviderId =
		(mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider) ??
		apiConfiguration.apiProvider
	const supportsNativeWebSearch = task
		? task.api?.supportsNativeWebSearch?.() === true
		: configuredProviderId === "openai-codex"
	const availableSkills = await discoverAvailableSkills(stateManager, cwd, task?.taskState || {}, {
		native_web_search: supportsNativeWebSearch,
	})

	const taskHistory = stateManager.getGlobalStateKey("taskHistory")
	const lastShownAnnouncementId = stateManager.getGlobalStateKey("lastShownAnnouncementId")
	const maxConsecutiveMistakes = stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
	const diracMessages = goalMessages ?? [...(task?.messageStateHandler.getDiracMessages() || [])]
	const selectedRunId = goal?.id ?? task?.taskId
	const currentTaskItem = selectedRunId ? (taskHistory || []).find((item) => item.id === selectedRunId) : undefined

	return {
		...modelState,
		...authState,
		...runtimeState,
		...toolState,
		...(goal ? { goal, mode: "act" as const } : {}),
		availableSkills,
		currentTaskItem,
		diracMessages,
		checkpointManagerErrorMessage: task?.taskState?.checkpointManagerErrorMessage,
		taskHistory: processTaskHistory(taskHistory, primaryRootPath),
		shouldShowAnnouncement: lastShownAnnouncementId !== latestAnnouncementId,
		backgroundCommandRunning,
		backgroundCommandTaskId,
		workspaceRoots: resolvedWorkspaceManager?.getRoots() ?? [],
		primaryRootIndex: resolvedWorkspaceManager?.getPrimaryIndex() ?? 0,
		isMultiRootWorkspace: (resolvedWorkspaceManager?.getRoots().length ?? 0) > 1,
		activeVoiceStreamId: task?.taskState.activeVoiceStreamId,
		taskStatus: task?.taskState.status || TaskStatus.IDLE,
		isApiRequestActive: task?.taskState.isApiRequestActive || false,
		uiActionState: projectUIActionState(task?.taskState, diracMessages, maxConsecutiveMistakes),
	}
}
