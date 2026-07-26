import { theme } from "../constants/theme"
/**
 * Skills panel content for inline display in ChatView
 * Shows installed skills with toggle and use functionality
 */

import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { Controller } from "@/core/controller"
import { refreshSkills } from "@/core/controller/file/refreshSkills"
import { toggleSkill } from "@/core/controller/file/toggleSkill"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { shouldIgnoreTerminalInput } from "../utils/input"
import { Panel } from "./Panel"

const SKILLS_MARKETPLACE_URL = "https://skills.sh/"

interface SkillInfo {
	name: string
	description: string
	path: string
	enabled: boolean
}

interface SkillsPanelContentProps {
	controller: Controller
	onClose: () => void
	onUseSkill: (skillPath: string) => void
}

const MAX_VISIBLE = 8

export const SkillsPanelContent: React.FC<SkillsPanelContentProps> = ({ controller, onClose, onUseSkill }) => {
	const { isRawModeSupported } = useStdinContext()
	const [globalSkills, setGlobalSkills] = useState<SkillInfo[]>([])
	const [localSkills, setLocalSkills] = useState<SkillInfo[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isLoading, setIsLoading] = useState(true)
	const [interactionError, setInteractionError] = useState<string | null>(null)
	const [pendingSkillPath, setPendingSkillPath] = useState<string | null>(null)

	// Load skills on mount
	useEffect(() => {
		let cancelled = false
		const loadSkills = async () => {
			setInteractionError(null)
			try {
				const skillsData = await refreshSkills(controller)
				if (cancelled) return
				setGlobalSkills(skillsData.globalSkills || [])
				setLocalSkills(skillsData.localSkills || [])
			} catch (error) {
				Logger.error("Failed to load skills:", error)
				if (cancelled) return
				setInteractionError(error instanceof Error ? error.message : String(error))
			} finally {
				if (!cancelled) setIsLoading(false)
			}
		}
		loadSkills()
		return () => {
			cancelled = true
		}
	}, [controller])

	// Build flat list of skills with source info (global first, then local, alphabetical within each)
	const skillEntries = useMemo(() => {
		const entries: { skill: SkillInfo; isGlobal: boolean }[] = []
		globalSkills.forEach((skill) => entries.push({ skill, isGlobal: true }))
		localSkills.forEach((skill) => entries.push({ skill, isGlobal: false }))
		return entries.sort((a, b) => {
			if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1
			return a.skill.name.localeCompare(b.skill.name)
		})
	}, [globalSkills, localSkills])

	// Handle toggle
	const handleToggle = useCallback(async () => {
		const entry = skillEntries[selectedIndex]
		if (!entry || pendingSkillPath) return

		const newEnabled = !entry.skill.enabled
		const setter = entry.isGlobal ? setGlobalSkills : setLocalSkills
		const update = (enabled: boolean) =>
			setter((prev) => prev.map((s) => (s.path === entry.skill.path ? { ...s, enabled } : s)))

		// Optimistic update
		setInteractionError(null)
		setPendingSkillPath(entry.skill.path)
		update(newEnabled)

		try {
			await toggleSkill(controller, {
				metadata: undefined,
				skillPath: entry.skill.path,
				isGlobal: entry.isGlobal,
				enabled: newEnabled,
			})
		} catch (error) {
			// Revert on failure
			update(!newEnabled)
			Logger.error("Failed to toggle skill:", error)
			setInteractionError(error instanceof Error ? error.message : String(error))
		} finally {
			setPendingSkillPath(null)
		}
	}, [controller, pendingSkillPath, skillEntries, selectedIndex])

	// Handle use skill (insert @ mention)
	const handleUse = useCallback(() => {
		const entry = skillEntries[selectedIndex]
		if (!entry) return
		onUseSkill(entry.skill.path)
	}, [skillEntries, selectedIndex, onUseSkill])

	// Handle opening the marketplace URL
	const openMarketplace = useCallback(async () => {
		setInteractionError(null)
		try {
			await openExternal(SKILLS_MARKETPLACE_URL)
		} catch (error) {
			Logger.error("Failed to open skills marketplace:", error)
			setInteractionError(error instanceof Error ? error.message : String(error))
		}
	}, [])

	// Total items = skills + 1 for marketplace link
	const totalItems = skillEntries.length + 1
	const isMarketplaceSelected = selectedIndex === skillEntries.length

	useEffect(() => {
		setSelectedIndex((currentIndex) => Math.min(currentIndex, totalItems - 1))
	}, [totalItems])

	useInput(
		(input, key) => {
			if (shouldIgnoreTerminalInput(input, key)) {
				return
			}
			if (key.escape) {
				onClose()
				return
			}

			// Navigation
			if (key.upArrow || input === "k") {
				setSelectedIndex((i) => (i > 0 ? i - 1 : totalItems - 1))
				return
			}
			if (key.downArrow || input === "j") {
				setSelectedIndex((i) => (i < totalItems - 1 ? i + 1 : 0))
				return
			}

			// Actions
			if (key.return) {
				if (isMarketplaceSelected) {
					void openMarketplace()
				} else {
					handleUse()
				}
				return
			}
			if (input === " " && !isMarketplaceSelected) {
				handleToggle()
				return
			}
		},
		{ isActive: isRawModeSupported },
	)

	// Scrolling window (includes marketplace row)
	const halfVisible = Math.floor(MAX_VISIBLE / 2)
	const startIndex = Math.max(0, Math.min(selectedIndex - halfVisible, totalItems - MAX_VISIBLE))

	if (isLoading) {
		return (
			<Panel label="Skills">
				<Text color={theme.muted}>Loading skills...</Text>
			</Panel>
		)
	}

	// Check if marketplace row is in visible window
	const marketplaceIndex = skillEntries.length
	const showMarketplace = marketplaceIndex >= startIndex && marketplaceIndex < startIndex + MAX_VISIBLE

	return (
		<Panel label="Skills">
			<Box flexDirection="column" gap={1}>
				{interactionError && <Text color={theme.error}>Skills error: {interactionError}</Text>}
				{skillEntries.length === 0 ? (
					<Box flexDirection="column" gap={1}>
						<Text color={theme.muted}>No skills installed.</Text>
						<Text>
							Install skills with: <Text color={theme.text}>npx skills add owner/repo</Text>
						</Text>
					</Box>
				) : (
					<Box flexDirection="column">
						{skillEntries
							.slice(startIndex, Math.min(startIndex + MAX_VISIBLE, skillEntries.length))
							.map((entry, idx) => {
								const actualIndex = startIndex + idx
								const prevEntry = skillEntries[actualIndex - 1]
								const showHeader = actualIndex === 0 || (prevEntry && prevEntry.isGlobal !== entry.isGlobal)

								return (
									<React.Fragment key={entry.skill.path}>
										{showHeader && (
											<Box marginTop={actualIndex > 0 ? 1 : 0}>
												<Text bold color={theme.muted}>
													{entry.isGlobal ? "Global Skills:" : "Workspace Skills:"}
												</Text>
											</Box>
										)}
										<SkillRow
											isPending={pendingSkillPath === entry.skill.path}
											isSelected={actualIndex === selectedIndex}
											skill={entry.skill}
										/>
									</React.Fragment>
								)
							})}
					</Box>
				)}

				{/* Marketplace link - selectable */}
				{showMarketplace && (
					<Box marginTop={1}>
						<Text color={isMarketplaceSelected ? theme.info : undefined}>
							{isMarketplaceSelected ? "❯ " : "  "}
							<Text color={COLORS.primaryBlue}>Browse more skills at https://skills.sh/</Text>
						</Text>
					</Box>
				)}

				{/* Help text */}
				<Box marginTop={1}>
					<Text color={theme.muted}>
						↑/↓ Navigate • Enter {isMarketplaceSelected ? "Open" : "Use"}
						{!isMarketplaceSelected && " • Space Toggle"}
					</Text>
				</Box>
			</Box>
		</Panel>
	)
}

const SkillRow: React.FC<{ skill: SkillInfo; isSelected: boolean; isPending: boolean }> = ({
	skill,
	isSelected,
	isPending,
}) => {
	return (
		<Box flexDirection="column">
			<Box>
				<Text color={isSelected ? theme.info : undefined}>
					{isSelected ? "❯ " : "  "}
					<Text color={isPending ? theme.warning : skill.enabled ? theme.success : theme.error}>
						{isPending ? "◌" : skill.enabled ? "●" : "○"}
					</Text>
					<Text> </Text>
					<Text bold color={theme.text}>
						{skill.name}
					</Text>
				</Text>
			</Box>
			{skill.description && (
				<Box marginLeft={4}>
					<Text color={theme.muted}>
						{skill.description.length > 60 ? skill.description.slice(0, 57) + "..." : skill.description}
					</Text>
				</Box>
			)}
		</Box>
	)
}
