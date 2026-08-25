import type { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import { type ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { BannerService } from "@/services/banner/BannerService"
import { DiracExtensionContext } from "@/shared/dirac"
import { Logger } from "@/shared/services/Logger"
import { StateManager } from "../storage/StateManager"
import { cleanupLegacyCheckpoints } from "@integrations/checkpoints/CheckpointMigration"
import { Task } from "../task"
import { WorkspaceController } from "./workspace/WorkspaceController"
import { AuthController } from "./auth/AuthController"
import { StateController } from "./state/StateController"
import { checkCliInstallation } from "./state/checkCliInstallation"
import { sendChatButtonClickedEvent } from "./ui/subscribeToChatButtonClicked"
import { getStateToPostToWebview as getUiState } from "./ui/UiController"
import { sendStateUpdate } from "./state/subscribeToState"
import { StatePublicationQueue } from "./state/StatePublicationQueue"
import { SkillMetadata } from "@/shared/skills"
import { TaskController } from "./task/TaskController"
import { GoalController } from "@core/goal/GoalController"
import { isGoalHistoryItem, type GoalHistoryItem } from "@shared/HistoryItem"
import { HostProvider } from "@hosts/host-provider"

import type { TaskInitializationOptions } from "./task/TaskController"
import { fingerprintAvailableTools } from "@shared/utils/tool-fingerprint"
import { Initializer, type InitializerConfig } from "./index-initializer"

import { openAiCodexUsageService } from "@/integrations/openai-codex/OpenAiCodexUsageService"

export type ControllerOptions = {
	workspaceCwd?: string
	goalRoutingEnabled?: boolean
}

export class Controller {
	public discoveredSkillsCache?: SkillMetadata[]
	readonly stateManager: StateManager
	private availableToolsFingerprint?: string

	// NEW: Add workspace manager (optional initially)
	private workspaceManager?: WorkspaceRootManager

	private authController!: AuthController
	private stateController!: StateController
	private workspaceController!: WorkspaceController
	private taskController!: TaskController
	private taskHistoryController!: import("./TaskHistoryController").TaskHistoryController
	private initializerConfig!: InitializerConfig
	private readonly goalController: GoalController
	private goalRoutingEnabled: boolean

	get task(): Task | undefined {
		return this.goalController?.coordinator ?? this.taskController?.task
	}

	set task(value: Task | undefined) {
		this.taskController.task = value
	}

	// Promise for the in-flight task run; created inside TaskController.initTask (from main).
	get taskRunPromise(): Promise<void> | undefined {
		return this.taskController?.taskRunPromise
	}

	onTaskReplaced(listener: (taskId: string) => void | Promise<void>): () => void {
		return this.taskController.onTaskReplaced(listener)
	}

	private readonly statePublicationQueue = new StatePublicationQueue(
		() => this.getStateToPostToWebview(),
		(state, sequenceNumber) => sendStateUpdate(state, sequenceNumber),
	)

	private openAiCodexUsageUnsubscribe?: () => void

	// Public getter for workspace manager with lazy initialization - To get workspaces when task isn't initialized (Used by file mentions)
	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		const manager = await this.workspaceController.ensureWorkspaceManager()
		if (manager && !this.workspaceManager) {
			this.workspaceManager = manager
		}
		return this.workspaceManager
	}

	// Synchronous getter for workspace manager
	getWorkspaceManager(): WorkspaceRootManager | undefined {
		const tm = this.taskController.workspaceManager
		if (tm) {
			this.workspaceManager = tm
		}
		return this.workspaceManager || this.taskController.workspaceManager
	}

	constructor(
		readonly context: DiracExtensionContext,
		options: ControllerOptions = {},
	) {
		const initializer = new Initializer(context)
		this.initializerConfig = initializer.createConfig(this, options.workspaceCwd)
		Object.assign(this, this.initializerConfig)
		this.stateManager = this.initializerConfig.stateManager
		this.goalRoutingEnabled = options.goalRoutingEnabled ?? HostProvider.get().diracType === "extension"
		this.goalController = new GoalController({
			controller: this,
			stateManager: this.stateManager,
			getStandaloneTask: () => this.taskController.task,
			clearStandaloneTask: () => this.taskController.clearTask(),
			updateGoalHistory: (item) => this.taskHistoryController.updateGoalHistory(item),
			postState: () => this.postStateToWebview(),
		})

		this.openAiCodexUsageUnsubscribe = openAiCodexUsageService.subscribe(() => {
			void this.postStateToWebview()
		})

		BannerService.initialize(this)

		// Clean up legacy checkpoints
		cleanupLegacyCheckpoints().catch((error) => {
			Logger.error("Failed to cleanup legacy checkpoints:", error)
		})

		// Check CLI installation status once on startup
		checkCliInstallation(this)

		// Initialize workspace manager in background
		this.ensureWorkspaceManager()
			.then(() => {
				this.postStateToWebview()
			})
			.catch((error) => {
				Logger.error("Failed to initialize workspace manager:", error)
			})
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		this.openAiCodexUsageUnsubscribe?.()
		this.openAiCodexUsageUnsubscribe = undefined
		await this.goalController.dispose()
		await this.taskController.clearTask()

		Logger.error("Controller disposed")
	}

	// Task lifecycle delegation (via TaskController)

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: any,
		conversationUlid?: string,
		_watcherFactory?: any,
		initializationOptions?: TaskInitializationOptions,
	): Promise<string> {
		if (!historyItem && task !== undefined) {
			const goalRequest = parseGoalRequest(task)
			if (goalRequest.matched) {
				if (!this.goalRoutingEnabled) {
					throw new Error(
						"Goals require the interactive VS Code or CLI surface; ACP and unattended CLI are unsupported.",
					)
				}
				if (images?.length || files?.length) throw new Error("/goal currently accepts a text objective only")
				return this.goalController.start(goalRequest.objective)
			}
		}
		if (historyItem && isGoalHistoryItem(historyItem)) {
			this.assertGoalSurfaceSupported()
			await this.goalController.select(historyItem.id)
			return historyItem.id
		}
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after starting another run")
		}
		return this.taskController.initTask(
			task,
			images,
			files,
			historyItem,
			taskSettings,
			conversationUlid,
			_watcherFactory,
			initializationOptions,
		)
	}

	async reinitExistingTaskFromId(taskId: string, initializationOptions?: TaskInitializationOptions): Promise<void> {
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after loading another run")
		}
		return this.taskController.reinitExistingTaskFromId(taskId, initializationOptions)
	}

	async cancelTask(): Promise<void> {
		if (this.goalController.active && this.goalController.selectedGoalId) {
			await this.goalController.pause(this.goalController.selectedGoalId, "Paused by cancel control")
			return
		}
		return this.taskController.cancelTask()
	}

	updateBackgroundCommandState(running: boolean, taskId?: string): void {
		this.taskController.updateBackgroundCommandState(running, taskId)
	}

	get backgroundCommandRunning(): boolean {
		return this.taskController.backgroundCommandRunning
	}

	get backgroundCommandTaskId(): string | undefined {
		return this.taskController.backgroundCommandTaskId
	}

	async cancelBackgroundCommand(): Promise<void> {
		return this.taskController.cancelBackgroundCommand()
	}

	async clearTask(): Promise<void> {
		if (this.goalController.selectedGoalId) {
			await this.goalController.pauseAndDeselect("Paused after leaving the Goal")
			return
		}
		await this.taskController.clearTask()
	}

	async createTask(prompt: string) {
		await sendChatButtonClickedEvent()
		await this.initTask(prompt)
	}

	// OpenRouter

	async completeOpenRouterAuth(code: string) {
		return this.authController.completeOpenRouterAuth(code)
	}

	// GitHub Copilot
	async completeGithubLogin() {
		return this.authController.completeGithubLogin()
	}

	// Requesty

	async completeRequestyAuth(code: string) {
		return this.authController.completeRequestyAuth(code)
	}

	// Read OpenRouter models from disk cache (delegates to TaskHistoryController)
	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		return this.taskHistoryController.readOpenRouterModels()
	}

	// Task history (delegates to TaskHistoryController)

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		return this.taskHistoryController.getTaskWithId(id)
	}

	async exportTaskWithId(id: string) {
		return this.taskHistoryController.exportTaskWithId(id)
	}

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		const updated = await this.taskHistoryController.deleteTaskFromState(id)
		await this.postStateToWebview()
		return updated
	}

	async postStateToWebview(): Promise<void> {
		await this.statePublicationQueue.requestPublication()
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		const previousAvailableToolsFingerprint = this.availableToolsFingerprint

		const goal = await this.goalController.inspect()
		const goalMessages = goal ? await this.goalController.selectedMessages() : undefined
		const state = await getUiState({
			stateManager: this.stateManager,
			task: this.task,
			workspaceManager: this.workspaceManager,
			backgroundCommandRunning: this.backgroundCommandRunning,
			backgroundCommandTaskId: this.backgroundCommandTaskId,
			goal,
			goalMessages,
		})

		const nextAvailableToolsFingerprint = await fingerprintAvailableTools(state.availableTools)
		if (this.task && previousAvailableToolsFingerprint !== nextAvailableToolsFingerprint) {
			this.task.markToolsDirty("settings_refresh_detected_change")
		}
		this.availableToolsFingerprint = nextAvailableToolsFingerprint

		return state
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		return this.taskHistoryController.updateTaskHistory(item)
	}

	async updateGoalHistory(item: GoalHistoryItem): Promise<HistoryItem[]> {
		return this.taskHistoryController.updateGoalHistory(item)
	}

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting): Promise<void> {
		return this.stateController.updateTelemetrySetting(telemetrySetting)
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		if (this.goalController.selectedGoalId) throw new Error("Mode switching is disabled while a Goal is active.")
		return this.stateController.toggleActModeForYoloMode()
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		if (this.goalController.selectedGoalId) throw new Error("Mode switching is disabled while a Goal is active.")
		return this.stateController.togglePlanActMode(modeToSwitchTo, chatContent)
	}

	enableInteractiveGoals(): void {
		this.goalRoutingEnabled = true
	}

	get selectedGoalId(): string | undefined {
		return this.goalController.selectedGoalId
	}

	get hasActiveGoal(): boolean {
		return this.goalController.active
	}

	async selectGoal(goalId: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.select(goalId)
	}

	async resumeGoal(goalId: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.resume(goalId)
	}

	async pauseGoal(goalId: string, reason?: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.pause(goalId, reason)
	}

	async stopGoal(goalId: string, reason?: string) {
		this.assertGoalSurfaceSupported()
		return this.goalController.stop(goalId, reason)
	}

	async steerGoal(goalId: string, message: string): Promise<void> {
		this.assertGoalSurfaceSupported()
		return this.goalController.steer(goalId, message)
	}

	private assertGoalSurfaceSupported(): void {
		if (!this.goalRoutingEnabled) {
			throw new Error("Goals require the interactive VS Code or CLI surface; ACP and unattended CLI are unsupported.")
		}
	}
}

function parseGoalRequest(text: string): { matched: false } | { matched: true; objective: string } {
	const match = text.match(/^\s*\/goal(?:\s+([\s\S]*))?\s*$/)
	if (!match) return { matched: false }
	const objective = match[1]?.trim() ?? ""
	if (!objective) throw new Error("/goal requires a non-empty objective")
	return { matched: true, objective }
}
