import type { ApiHandler, ApiProviderInfo } from "@core/api"
import {
	getGlobalDiracRules,
	getLocalDiracRules,
	refreshDiracRulesToggles,
} from "@core/context/instructions/user-instructions/dirac-rules"
import {
	getLocalAgentsRules,
	getLocalCursorRules,
	getLocalWindsurfRules,
	refreshExternalRulesToggles,
} from "@core/context/instructions/user-instructions/external-rules"
import { formatResponse } from "@core/formatResponse"
import { ensureRulesDirectoryExists, ensureTaskDirectoryExists } from "@core/storage/disk"
import { createDefaultTextCondensationTemplateRegistry, TASK_HANDOFF_TEMPLATE_ID } from "@core/text-condensation/templates"
import { isUtilityTextCondensationAvailable } from "@core/text-condensation/UtilityTextCondensationAvailability"
import { getConfiguredUtilityModelSelection } from "@core/utility-model/UtilityModelSelection"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { HostProvider } from "@hosts/host-provider"
import { featureFlagsService } from "@services/feature-flags"
import { DiracClient } from "@shared/dirac"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, type LanguageDisplay } from "@shared/Languages"
import * as path from "path"
import { filterSkillsByProviderCapabilities } from "@/shared/skills"
import { getAvailableCores } from "@/utils/os"
import { detectBestShell } from "@/utils/shell-detection"
import type { ContextManager } from "../context/context-management/ContextManager"
import { RuleContextBuilder } from "../context/instructions/user-instructions/RuleContextBuilder"
import { getOrDiscoverSkills } from "../context/instructions/user-instructions/skills"
import type { DiracIgnoreController } from "../ignore/DiracIgnoreController"
import type { SystemPromptContext } from "../prompts/system-prompt"
import { getSystemPrompt } from "../prompts/system-prompt"
import type { StateManager } from "../storage/StateManager"
import type { WorkspaceRootManager } from "../workspace/WorkspaceRootManager"
import type { ApiConversationManager } from "./ApiConversationManager"
import type { MessageStateHandler } from "./message-state"
import type { TaskMessenger } from "./TaskMessenger"
import type { TaskState } from "./TaskState"
import type { ToolExecutor } from "./ToolExecutor"

export interface TaskRequestBuilderContext {
	taskId: string
	cwd: string
	terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	api: ApiHandler
	stateManager: StateManager
	messageStateHandler: MessageStateHandler
	taskMessenger: TaskMessenger
	toolExecutor: ToolExecutor
	contextManager: ContextManager
	apiConversationManager: ApiConversationManager
	diracIgnoreController: DiracIgnoreController
	workspaceManager?: WorkspaceRootManager
	taskState: TaskState
	getCurrentProviderInfo: () => ApiProviderInfo
	isParallelToolCallingEnabled: () => boolean
	writePromptMetadataArtifacts: (params: {
		systemPrompt: string
		providerInfo: ApiProviderInfo
		tools: any[]
		fullHistory: any[]
		deletedRange?: [number, number]
	}) => Promise<void>
}

export async function buildApiRequestParams(
	ctx: TaskRequestBuilderContext,
	params: { previousApiReqIndex: number; shouldCompact?: boolean },
): Promise<{
	systemPrompt: string
	toolSnapshot: Awaited<ReturnType<ToolExecutor["getSnapshotForRequest"]>>
	contextManagementMetadata: Awaited<ReturnType<ContextManager["getNewContextMessagesAndMetadata"]>>
	providerInfo: ApiProviderInfo
}> {
	const providerInfo = ctx.getCurrentProviderInfo()
	const host = await HostProvider.env.getHostVersion({})
	const ide = host?.platform || "Unknown"
	const isCliEnvironment = host.diracType === DiracClient.Cli
	const browserSettings = ctx.stateManager.getGlobalSettingsKey("browserSettings")
	const disableBrowserTool = browserSettings?.disableToolUse ?? false
	const modelSupportsBrowserUse = providerInfo.model.info.supportsImages ?? false

	const supportsBrowserUse = modelSupportsBrowserUse && !disableBrowserTool
	const preferredLanguageRaw = ctx.stateManager.getGlobalSettingsKey("preferredLanguage")
	const preferredLanguage = getLanguageKey(preferredLanguageRaw as LanguageDisplay)
	const preferredLanguageInstructions =
		preferredLanguage && preferredLanguage !== DEFAULT_LANGUAGE_SETTINGS
			? `# Preferred Language\n\nSpeak in ${preferredLanguage}.`
			: ""

	const { globalToggles, localToggles } = await refreshDiracRulesToggles(ctx.stateManager, ctx.cwd)
	const { windsurfLocalToggles, cursorLocalToggles, agentsLocalToggles } = await refreshExternalRulesToggles(
		ctx.stateManager,
		ctx.cwd,
	)

	const evaluationContext = await new RuleContextBuilder().buildEvaluationContext({
		cwd: ctx.cwd,
		messageStateHandler: ctx.messageStateHandler,
		workspaceManager: ctx.workspaceManager,
	})

	const globalDiracRulesFilePath = await ensureRulesDirectoryExists()
	const globalRules = await getGlobalDiracRules(globalDiracRulesFilePath, globalToggles, { evaluationContext })
	const globalDiracRulesFileInstructions = globalRules.instructions
	const localRules = await getLocalDiracRules(ctx.cwd, localToggles, { evaluationContext })
	const localDiracRulesFileInstructions = localRules.instructions
	const [localCursorRulesFileInstructions, localCursorRulesDirInstructions] = await getLocalCursorRules(
		ctx.cwd,
		cursorLocalToggles,
	)
	const localWindsurfRulesFileInstructions = await getLocalWindsurfRules(ctx.cwd, windsurfLocalToggles)
	const localAgentsRulesFileInstructions = await getLocalAgentsRules(ctx.cwd, agentsLocalToggles)
	ctx.diracIgnoreController.yoloMode = !!ctx.stateManager.getGlobalSettingsKey("yoloModeToggled")
	const isYolo = !!ctx.stateManager.getGlobalSettingsKey("yoloModeToggled")
	const diracIgnoreContent = ctx.diracIgnoreController.diracIgnoreContent
	let diracIgnoreInstructions: string | undefined
	if (diracIgnoreContent && !isYolo) {
		diracIgnoreInstructions = formatResponse.diracIgnoreInstructions(diracIgnoreContent)
	}

	let workspaceRoots: Array<{ path: string; name: string; vcs?: string }> | undefined
	const multiRootEnabled = isMultiRootEnabled(ctx.stateManager)
	if (multiRootEnabled && ctx.workspaceManager) {
		workspaceRoots = ctx.workspaceManager.getRoots().map((root) => ({
			path: root.path,
			name: root.name || path.basename(root.path),
			vcs: root.vcs as string | undefined,
		}))
	}

	const resolvedSkills = await getOrDiscoverSkills(ctx.cwd, ctx.taskState)
	const providerSkills = filterSkillsByProviderCapabilities(resolvedSkills, {
		native_web_search: providerInfo.supportsNativeWebSearch === true,
	})
	const globalSkillsToggles = ctx.stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
	const localSkillsToggles = ctx.stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {}
	const availableSkills = providerSkills.filter((skill) => {
		if (ctx.stateManager.getGlobalSettingsKey("yoloModeToggled") && skill.interactiveOnly) return false
		if (skill.source === "builtin") return true
		const toggles = skill.source === "global" ? globalSkillsToggles : localSkillsToggles
		return toggles[skill.path] !== false
	})
	ctx.taskState.availableSkills = availableSkills

	const openTabPaths = (await HostProvider.window.getOpenTabs({})).paths || []
	const visibleTabPaths = (await HostProvider.window.getVisibleTabs({})).paths || []
	const cap = 50
	const editorTabs = {
		open: openTabPaths.slice(0, cap),
		visible: visibleTabPaths.slice(0, cap),
	}
	const shellInfo = detectBestShell()
	const taskHandoffCondensationAvailable = isUtilityTextCondensationAvailable(
		{
			utilityModelEnabled: ctx.stateManager.getGlobalSettingsKey("utilityModelEnabled"),
			utilityModelUseCondense: ctx.stateManager.getGlobalSettingsKey("utilityModelUseCondense"),
			utilityModelUseNewTask: ctx.stateManager.getGlobalSettingsKey("utilityModelUseNewTask"),
			utilityModelSelection: ctx.stateManager.getGlobalSettingsKey("utilityModelSelection"),
		},
		TASK_HANDOFF_TEMPLATE_ID,
		createDefaultTextCondensationTemplateRegistry(),
	)

	const promptContext: SystemPromptContext = {
		cwd: ctx.cwd,
		ide,
		providerInfo,
		editorTabs,
		supportsBrowserUse,
		taskHandoffCondensationAvailable,
		utilityModelConfigured:
			getConfiguredUtilityModelSelection(ctx.stateManager.getGlobalSettingsKey("utilityModelSelection")) !== undefined,
		skills: availableSkills,
		globalDiracRulesFileInstructions,
		localDiracRulesFileInstructions,
		localCursorRulesFileInstructions,
		localCursorRulesDirInstructions,
		localWindsurfRulesFileInstructions,
		localAgentsRulesFileInstructions,
		diracIgnoreInstructions,
		preferredLanguageInstructions,
		browserSettings: ctx.stateManager.getGlobalSettingsKey("browserSettings"),
		yoloModeToggled: ctx.stateManager.getGlobalSettingsKey("yoloModeToggled"),
		subagentsEnabled: ctx.stateManager.getGlobalSettingsKey("subagentsEnabled"),
		diracWebToolsEnabled:
			ctx.stateManager.getGlobalSettingsKey("diracWebToolsEnabled") && featureFlagsService.getWebtoolsEnabled(),
		isMultiRootEnabled: multiRootEnabled,
		workspaceRoots,
		isSubagentRun: false,
		isCliEnvironment,
		enableParallelToolCalling: ctx.isParallelToolCallingEnabled(),
		terminalExecutionMode: ctx.terminalExecutionMode,
		activeShellType: shellInfo.type,
		activeShellPath: shellInfo.path,
		activeShellIsPosix: shellInfo.isPosix,
		availableCores: getAvailableCores(),
		shouldCompact: params.shouldCompact,
	}

	const activatedConditionalRules = [...globalRules.activatedConditionalRules, ...localRules.activatedConditionalRules]
	if (activatedConditionalRules.length > 0) {
		await ctx.taskMessenger.upsertText(JSON.stringify({ rules: activatedConditionalRules }))
	}

	const ruleLoadErrors = [...(globalRules.errors ?? []), ...(localRules.errors ?? [])]
	if (ruleLoadErrors.length > 0) {
		await ctx.taskMessenger.upsertText(JSON.stringify({ ruleLoadErrors }))
	}

	const toolSnapshot = await ctx.toolExecutor.getSnapshotForRequest(promptContext)
	const { systemPrompt } = await getSystemPrompt(promptContext, toolSnapshot)
	ctx.toolExecutor.activateSnapshot(toolSnapshot)
	ctx.taskState.useNativeToolCalls = toolSnapshot.nativeTools.length > 0
	const contextManagementMetadata = await ctx.contextManager.getNewContextMessagesAndMetadata(
		ctx.messageStateHandler.getApiConversationHistory(),
		ctx.messageStateHandler.getDiracMessages(),
		ctx.api,
		ctx.taskState.conversationHistoryDeletedRange,
		params.previousApiReqIndex,
		await ensureTaskDirectoryExists(ctx.taskId),
		ctx.stateManager.getGlobalSettingsKey("useAutoCondense"),
	)

	if (contextManagementMetadata.updatedConversationHistoryDeletedRange) {
		const previousConversationHistoryDeletedRange = ctx.taskState.conversationHistoryDeletedRange
		const conversationHistoryDeletedRange = contextManagementMetadata.conversationHistoryDeletedRange
		if (!conversationHistoryDeletedRange) {
			throw new Error("Context management reported a truncation update without a deleted range.")
		}
		ctx.taskState.conversationHistoryDeletedRange = conversationHistoryDeletedRange
		await ctx.apiConversationManager.scheduleProviderConversationCompaction(
			previousConversationHistoryDeletedRange,
			conversationHistoryDeletedRange,
		)
		await ctx.messageStateHandler.saveDiracMessagesAndUpdateHistory()
	}

	const useAutoCondense = ctx.stateManager.getGlobalSettingsKey("useAutoCondense")
	if (!useAutoCondense) {
		const lastMessage =
			contextManagementMetadata.truncatedConversationHistory[
			contextManagementMetadata.truncatedConversationHistory.length - 1
			]
		if (lastMessage && lastMessage.role === "user") {
			const notice = formatResponse.contextTruncationNotice()
			if (typeof lastMessage.content === "string") {
				lastMessage.content += `\n\n${notice}`
			} else if (Array.isArray(lastMessage.content)) {
				lastMessage.content.push({
					type: "text",
					text: notice,
				})
			}
		}
	}

	await ctx.writePromptMetadataArtifacts({
		systemPrompt,
		providerInfo,
		tools: toolSnapshot.nativeTools,
		fullHistory: ctx.messageStateHandler.getApiConversationHistory(),
		deletedRange: ctx.taskState.conversationHistoryDeletedRange,
	})
	return { systemPrompt, toolSnapshot, contextManagementMetadata, providerInfo }
}
