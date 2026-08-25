import type { GoalChildStatus, GoalViewState } from "@shared/goal"
import { Box, Text, useInput } from "ink"
import React, { useEffect, useMemo, useState } from "react"
import { theme } from "../constants/theme"
import { useStdinContext } from "../context/StdinContext"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { isResumableGoalStatus, isRunningGoalStatus } from "../utils/goals"
import { Markdown } from "./modular-ui/Markdown"

const ACTIVE_CHILD_STATUSES: readonly GoalChildStatus[] = ["starting", "running", "waiting"]
const CHILD_PAGE_SIZE = 5

function formatDuration(durationMs: number | undefined): string {
	if (durationMs === undefined) return ""
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
	if (totalSeconds < 60) return `${totalSeconds}s`
	const totalMinutes = Math.floor(totalSeconds / 60)
	if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`
	const totalHours = Math.floor(totalMinutes / 60)
	return `${totalHours}h ${totalMinutes % 60}m`
}

function statusColor(status: GoalViewState["status"] | GoalChildStatus): string {
	if (status === "achieved" || status === "completed") return theme.success
	if (status === "blocked" || status === "failed" || status === "stopped") return theme.error
	if (status === "waiting" || status === "paused" || status === "interrupted") return theme.warning
	if (status === "cancelled") return theme.muted
	return theme.link
}

function accountingSummary(goal: GoalViewState): string {
	const entries: string[] = []
	const accounting = goal.accounting
	if (accounting.totalTokens !== undefined) entries.push(`${accounting.totalTokens.toLocaleString()} tokens`)
	if (accounting.inputTokens !== undefined) entries.push(`${accounting.inputTokens.toLocaleString()} in`)
	if (accounting.outputTokens !== undefined) entries.push(`${accounting.outputTokens.toLocaleString()} out`)
	if (accounting.reasoningTokens !== undefined) entries.push(`${accounting.reasoningTokens.toLocaleString()} reasoning`)
	if (accounting.cacheReadTokens !== undefined) entries.push(`${accounting.cacheReadTokens.toLocaleString()} cache read`)
	if (accounting.cacheWriteTokens !== undefined) entries.push(`${accounting.cacheWriteTokens.toLocaleString()} cache write`)
	if (accounting.cost !== undefined) entries.push(`$${accounting.cost.toFixed(4)}`)
	return entries.length > 0 ? entries.join(" · ") : "Usage unavailable"
}

export const GoalSummary: React.FC<{
	goal: GoalViewState
	isProcessing: boolean
	isStopConfirmationPending: boolean
}> = ({ goal, isProcessing, isStopConfirmationPending }) => {
	const { isRawModeSupported } = useStdinContext()
	const { columns } = useTerminalSize()
	const [childPageIndex, setChildPageIndex] = useState(0)
	const childCounts = useMemo(() => {
		const counts = new Map<GoalChildStatus, number>()
		for (const child of goal.children) counts.set(child.status, (counts.get(child.status) ?? 0) + 1)
		return [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(" · ")
	}, [goal.children])
	const orderedChildren = useMemo(() => {
		const activeChildren = goal.children.filter((child) => ACTIVE_CHILD_STATUSES.includes(child.status))
		const terminalChildren = goal.children
			.filter((child) => !ACTIVE_CHILD_STATUSES.includes(child.status))
			.reverse()
		return [...activeChildren, ...terminalChildren]
	}, [goal.children])
	const childPageCount = Math.max(1, Math.ceil(orderedChildren.length / CHILD_PAGE_SIZE))
	const visibleChildren = orderedChildren.slice(
		childPageIndex * CHILD_PAGE_SIZE,
		(childPageIndex + 1) * CHILD_PAGE_SIZE,
	)

	useEffect(() => setChildPageIndex(0), [goal.id])
	useEffect(() => {
		setChildPageIndex((current) => Math.min(current, childPageCount - 1))
	}, [childPageCount])

	useInput(
		(_input, key) => {
			if (key.pageUp) setChildPageIndex((current) => Math.max(0, current - 1))
			if (key.pageDown) setChildPageIndex((current) => Math.min(childPageCount - 1, current + 1))
		},
		{ isActive: isRawModeSupported && childPageCount > 1 },
	)
	const controls = isRunningGoalStatus(goal.status)
		? "Ctrl+P pause · Ctrl+X stop"
		: isResumableGoalStatus(goal.status)
			? "Ctrl+R resume · Ctrl+X stop"
			: "Goal is terminal"

	return (
		<Box borderColor={theme.border} borderStyle="round" flexDirection="column" paddingX={1} width="100%">
			<Box justifyContent="space-between" width="100%">
				<Text bold color={theme.primary}>
					Goal
				</Text>
				<Text bold color={statusColor(goal.status)}>
					{goal.status.toUpperCase()}
				</Text>
			</Box>
			<Text color={theme.muted} wrap="truncate-end">
				{goal.id} · age {formatDuration(goal.wallDurationMs)} · active {formatDuration(goal.activeDurationMs)}
			</Text>
			{goal.statusReason && <Text color={theme.muted}>Reason: {goal.statusReason}</Text>}
			<Box marginTop={1}>
				<Text bold color={theme.strongText}>
					Objective (revision {goal.objective.revision})
				</Text>
			</Box>
			<Markdown color={theme.text} width={Math.max(1, columns - 4)}>
				{goal.objective.markdown}
			</Markdown>
			<Box>
				<Text bold color={theme.strongText}>
					Children
				</Text>
				<Text color={theme.muted}> · {goal.children.length === 0 ? "none" : childCounts}</Text>
				{goal.pendingInteractionCount > 0 && (
					<Text color={theme.warning}>
						{" "}
						· {goal.pendingInteractionCount} pending interaction{goal.pendingInteractionCount === 1 ? "" : "s"}
					</Text>
				)}
			</Box>
			{visibleChildren.map((child) => (
				<Box key={child.id}>
					<Text color={statusColor(child.status)}>• {child.status}</Text>
					<Text color={theme.muted}> · {child.role}</Text>
					<Text wrap="truncate-end">
						{" "}
						· {child.title} ({child.id})
					</Text>
					{child.runningDurationMs !== undefined && (
						<Text color={theme.muted}> · run {formatDuration(child.runningDurationMs)}</Text>
					)}
					<Text color={theme.muted}> · idle {formatDuration(child.idleDurationMs)}</Text>
				</Box>
			))}
			{childPageCount > 1 && (
				<Text color={theme.muted}>
					PgUp/PgDn inspect all children · page {childPageIndex + 1}/{childPageCount} · {visibleChildren.length} visible
				</Text>
			)}
			{goal.latestVerification && (
				<Box flexDirection="column">
					<Text bold color={theme.strongText}>Latest verification</Text>
					<Text color={statusColor(goal.latestVerification.status)}>
						{goal.latestVerification.status} · {goal.latestVerification.title}
					</Text>
					{goal.latestVerification.terminalSummary && (
						<Text color={theme.muted} wrap="truncate-end">{goal.latestVerification.terminalSummary}</Text>
					)}
				</Box>
			)}
			<Text color={theme.muted}>Accounting: {accountingSummary(goal)}</Text>
			<Text color={isStopConfirmationPending ? theme.warning : theme.muted}>
				{isProcessing
					? "Applying Goal control…"
					: isStopConfirmationPending
						? "Press Ctrl+X again to permanently stop this Goal"
						: controls}
			</Text>
		</Box>
	)
}
