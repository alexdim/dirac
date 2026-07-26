/**
 * Stateful wrapper for ConfigView that handles toggle operations
 */

import fs from "node:fs/promises"
import path from "node:path"

import { RuleScope } from "@shared/proto/dirac/file"
import type { GlobalStateAndSettings, GlobalStateAndSettingsKey, LocalState, LocalStateKey } from "@shared/storage/state-keys"
import React, { useCallback, useEffect, useState } from "react"

import type { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { StdinProvider } from "../context/StdinContext"
import { ConfigView } from "./ConfigView"

interface HookInfo {
	name: string
	enabled: boolean
	absolutePath: string
}

interface WorkspaceHooks {
	workspaceName: string
	hooks: HookInfo[]
}

interface SkillInfo {
	name: string
	description: string
	path: string
	enabled: boolean
}

interface ConfigViewWrapperProps {
	controller: Controller
	dataDir: string
	globalState: Record<string, unknown>
	workspaceState: Record<string, unknown>
	hooksEnabled: boolean
	skillsEnabled: boolean
	isRawModeSupported?: boolean
}

export const ConfigViewWrapper: React.FC<ConfigViewWrapperProps> = ({
	controller,
	dataDir,
	globalState: initialGlobalState,
	workspaceState: initialWorkspaceState,
	hooksEnabled,
	skillsEnabled,
	isRawModeSupported = true,
}) => {
	// Settings state (managed locally for UI updates)
	const [globalStateLocal, setGlobalStateLocal] = useState<Record<string, unknown>>(initialGlobalState)
	const [workspaceStateLocal, setWorkspaceStateLocal] = useState<Record<string, unknown>>(initialWorkspaceState)

	// Rules state
	const [globalDiracRulesToggles, setGlobalDiracRulesToggles] = useState<Record<string, boolean>>({})
	const [localDiracRulesToggles, setLocalDiracRulesToggles] = useState<Record<string, boolean>>({})
	const [localCursorRulesToggles, setLocalCursorRulesToggles] = useState<Record<string, boolean>>({})
	const [localWindsurfRulesToggles, setLocalWindsurfRulesToggles] = useState<Record<string, boolean>>({})
	const [localAgentsRulesToggles, setLocalAgentsRulesToggles] = useState<Record<string, boolean>>({})

	// Workflow state
	const [globalWorkflowToggles, setGlobalWorkflowToggles] = useState<Record<string, boolean>>({})
	const [localWorkflowToggles, setLocalWorkflowToggles] = useState<Record<string, boolean>>({})

	// Hooks state
	const [globalHooks, setGlobalHooks] = useState<HookInfo[]>([])
	const [workspaceHooksState, setWorkspaceHooksState] = useState<WorkspaceHooks[]>([])

	// Skills state
	const [globalSkills, setGlobalSkills] = useState<SkillInfo[]>([])
	const [localSkills, setLocalSkills] = useState<SkillInfo[]>([])
	const [interactionError, setInteractionError] = useState<string | null>(null)

	// Load initial data
	useEffect(() => {
		let cancelled = false
		const loadData = async () => {
			try {
				const { refreshRules } = await import("@/core/controller/file/refreshRules")
				const { refreshHooks } = await import("@/core/controller/file/refreshHooks")
				const { refreshSkills } = await import("@/core/controller/file/refreshSkills")

				const rulesData = await refreshRules(controller, {})
				if (cancelled) return
				setGlobalDiracRulesToggles(rulesData.globalDiracRulesToggles?.toggles || {})
				setLocalDiracRulesToggles(rulesData.localDiracRulesToggles?.toggles || {})
				setLocalCursorRulesToggles(rulesData.localCursorRulesToggles?.toggles || {})
				setLocalWindsurfRulesToggles(rulesData.localWindsurfRulesToggles?.toggles || {})
				setLocalAgentsRulesToggles(rulesData.localAgentsRulesToggles?.toggles || {})
				setGlobalWorkflowToggles(rulesData.globalWorkflowToggles?.toggles || {})
				setLocalWorkflowToggles(rulesData.localWorkflowToggles?.toggles || {})

				if (hooksEnabled) {
					const hooksData = await refreshHooks(controller, {})
					if (cancelled) return
					setGlobalHooks(hooksData.globalHooks || [])
					setWorkspaceHooksState(hooksData.workspaceHooks || [])
				}

				if (skillsEnabled) {
					const skillsData = await refreshSkills(controller)
					if (cancelled) return
					setGlobalSkills(skillsData.globalSkills || [])
					setLocalSkills(skillsData.localSkills || [])
				}
				setInteractionError(null)
			} catch (error) {
				Logger.error("Failed to load configuration data:", error)
				if (!cancelled) setInteractionError(error instanceof Error ? error.message : String(error))
			}
		}
		loadData()
		return () => {
			cancelled = true
		}
	}, [controller, hooksEnabled, skillsEnabled])

	// Toggle handlers
	const handleToggleRule = useCallback(
		async (isGlobal: boolean, rulePath: string, enabled: boolean, ruleType: string) => {
			setInteractionError(null)
			const { toggleDiracRule } = await import("@/core/controller/file/toggleDiracRule")

			// Determine scope based on isGlobal and rule type
			const scope = isGlobal ? RuleScope.GLOBAL : RuleScope.LOCAL

			// For non-dirac rules, we need different toggle functions
			if (ruleType === "cursor") {
				// Update local state optimistically
				setLocalCursorRulesToggles((prev) => ({ ...prev, [rulePath]: enabled }))
				// Cursor rules use toggleCursorRule but we'll just update the state manager directly
				const toggles = { ...(controller.stateManager.getWorkspaceStateKey("localCursorRulesToggles") || {}), [rulePath]: enabled }
				controller.stateManager.setWorkspaceState("localCursorRulesToggles", toggles)
			} else if (ruleType === "windsurf") {
				setLocalWindsurfRulesToggles((prev) => ({ ...prev, [rulePath]: enabled }))
				const toggles = { ...(controller.stateManager.getWorkspaceStateKey("localWindsurfRulesToggles") || {}), [rulePath]: enabled }
				controller.stateManager.setWorkspaceState("localWindsurfRulesToggles", toggles)
			} else if (ruleType === "agents") {
				setLocalAgentsRulesToggles((prev) => ({ ...prev, [rulePath]: enabled }))
				const toggles = { ...(controller.stateManager.getWorkspaceStateKey("localAgentsRulesToggles") || {}), [rulePath]: enabled }
				controller.stateManager.setWorkspaceState("localAgentsRulesToggles", toggles)
			} else {
				// Dirac rules
				const result = await toggleDiracRule(controller, { metadata: undefined, rulePath, enabled, scope })
				if (result.globalDiracRulesToggles?.toggles) {
					setGlobalDiracRulesToggles(result.globalDiracRulesToggles.toggles)
				}
				if (result.localDiracRulesToggles?.toggles) {
					setLocalDiracRulesToggles(result.localDiracRulesToggles.toggles)
				}
			}
			await controller.postStateToWebview()
		},
		[controller],
	)

	const handleToggleWorkflow = useCallback(
		async (isGlobal: boolean, workflowPath: string, enabled: boolean) => {
			const { toggleWorkflow } = await import("@/core/controller/file/toggleWorkflow")
			const scope = isGlobal ? RuleScope.GLOBAL : RuleScope.LOCAL

			const result = await toggleWorkflow(controller, { metadata: undefined, workflowPath, enabled, scope })
			if (isGlobal) setGlobalWorkflowToggles(result.toggles)
			else setLocalWorkflowToggles(result.toggles)
		},
		[controller],
	)

	const handleToggleHook = useCallback(
		async (isGlobal: boolean, hookName: string, enabled: boolean, workspaceName?: string) => {
			const { toggleHook } = await import("@/core/controller/file/toggleHook")

			const result = await toggleHook(controller, { metadata: undefined, hookName, isGlobal, enabled, workspaceName })
			if (result.hooksToggles) {
				setGlobalHooks(result.hooksToggles.globalHooks || [])
				setWorkspaceHooksState(result.hooksToggles.workspaceHooks || [])
			}
		},
		[controller],
	)

	const handleToggleSkill = useCallback(
		async (isGlobal: boolean, skillPath: string, enabled: boolean) => {
			const { toggleSkill } = await import("@/core/controller/file/toggleSkill")

			await toggleSkill(controller, { metadata: undefined, skillPath, isGlobal, enabled })
			if (isGlobal) setGlobalSkills((prev) => prev.map((s) => (s.path === skillPath ? { ...s, enabled } : s)))
			else setLocalSkills((prev) => prev.map((s) => (s.path === skillPath ? { ...s, enabled } : s)))
		},
		[controller],
	)

	const handleOpenFolder = useCallback(
		async (folderType: "rules" | "workflows" | "hooks" | "skills", isGlobal: boolean) => {
			let folderPath: string

			if (isGlobal) {
				// Global folders are in dataDir (e.g., ~/.dirac/)
				const subFolder = folderType === "rules" ? "rules" : folderType
				folderPath = path.join(dataDir, subFolder)
			} else {
				// Local folders are in the workspace
				const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
				const primaryWorkspace = workspacePaths.paths[0]
				if (!primaryWorkspace) {
					return
				}
				// Local rules/workflows/hooks/skills are in .diracrules or .dirac
				const subFolder = folderType === "rules" ? "rules" : folderType
				folderPath = path.join(primaryWorkspace, ".diracrules", subFolder)
			}

			await fs.mkdir(folderPath, { recursive: true })
			const open = (await import("open")).default
			const child = await open(folderPath)
			child.once("error", (error) => {
				Logger.error("Failed to open configuration folder:", error)
				setInteractionError(error.message)
			})
		},
		[dataDir],
	)

	// Settings update handlers
	const handleUpdateGlobal = useCallback(
		async (key: GlobalStateAndSettingsKey, value: GlobalStateAndSettings[GlobalStateAndSettingsKey]) => {
			// Update local state for immediate UI feedback
			setGlobalStateLocal((prev) => ({ ...prev, [key]: value }))
			// Persist to state manager
			controller.stateManager.setGlobalState(key, value)
			await controller.stateManager.flushPendingState()
		},
		[controller],
	)

	const handleUpdateWorkspace = useCallback(
		async (key: LocalStateKey, value: LocalState[LocalStateKey]) => {
			// Update local state for immediate UI feedback
			setWorkspaceStateLocal((prev) => ({ ...prev, [key]: value }))
			// Persist to state manager
			controller.stateManager.setWorkspaceState(key, value)
			await controller.stateManager.flushPendingState()
		},
		[controller],
	)

	return (
		<StdinProvider isRawModeSupported={isRawModeSupported}>
			<ConfigView
				dataDir={dataDir}
				errorMessage={interactionError}
				globalDiracRulesToggles={globalDiracRulesToggles}
				globalHooks={globalHooks}
				globalSkills={globalSkills}
				globalState={globalStateLocal}
				globalWorkflowToggles={globalWorkflowToggles}
				hooksEnabled={hooksEnabled}
				localAgentsRulesToggles={localAgentsRulesToggles}
				localDiracRulesToggles={localDiracRulesToggles}
				localCursorRulesToggles={localCursorRulesToggles}
				localSkills={localSkills}
				localWindsurfRulesToggles={localWindsurfRulesToggles}
				localWorkflowToggles={localWorkflowToggles}
				onOpenFolder={handleOpenFolder}
				onToggleHook={handleToggleHook}
				onToggleRule={handleToggleRule}
				onToggleSkill={handleToggleSkill}
				onToggleWorkflow={handleToggleWorkflow}
				onUpdateGlobal={handleUpdateGlobal}
				onUpdateWorkspace={handleUpdateWorkspace}
				skillsEnabled={skillsEnabled}
				workspaceHooks={workspaceHooksState}
				workspaceState={workspaceStateLocal}
			/>
		</StdinProvider>
	)
}
