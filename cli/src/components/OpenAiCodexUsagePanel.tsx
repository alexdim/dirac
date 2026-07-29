import type {
	OpenAiCodexRateLimitBucket,
	OpenAiCodexRateLimitWindow,
	OpenAiCodexUsageSnapshot,
} from "@shared/openai-codex-usage"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EmptyRequest } from "@shared/proto/dirac/common"
import { fromProtobufOpenAiCodexUsage } from "@shared/proto-conversions/openai-codex-usage"
import { refreshOpenAiCodexUsage } from "@/core/controller/models/refreshOpenAiCodexUsage"
import { theme } from "../constants/theme"
import { useStdinContext } from "../context/StdinContext"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { shouldIgnoreTerminalInput } from "../utils/input"
import { Panel } from "./Panel"

const STALE_AFTER_MS = 15 * 60 * 1000
const SHORT_FRESHNESS_MS = 60 * 1000

interface OpenAiCodexUsagePanelProps {
	controller?: any
	isAuthenticated: boolean
	onClose: () => void
	snapshot?: OpenAiCodexUsageSnapshot
}

interface DisplayWindow {
	bucket: OpenAiCodexRateLimitBucket
	kind: "primary" | "secondary"
	window: OpenAiCodexRateLimitWindow
}

export function getOpenAiCodexRemainingPercent(usedPercent: number): number {
	return Math.max(0, Math.min(100, 100 - usedPercent))
}

function formatRemainingPercent(usedPercent: number): string {
	const remaining = getOpenAiCodexRemainingPercent(usedPercent)
	if (remaining > 0 && remaining < 1) return "<1% remaining"
	return `${Math.round(remaining)}% remaining`
}

function matchesDuration(minutes: number | undefined, expected: number): boolean {
	return minutes !== undefined && Math.abs(minutes - expected) <= expected * 0.05
}

export function formatOpenAiCodexWindowDuration(
	minutes: number | undefined,
	kind: "primary" | "secondary",
	bucket?: OpenAiCodexRateLimitBucket,
): string {
	if (matchesDuration(minutes, 300)) return "5-hour"
	if (matchesDuration(minutes, 1440)) return "Daily"
	if (matchesDuration(minutes, 10080)) return "Weekly"
	if (matchesDuration(minutes, 43200)) return "Monthly"
	if (matchesDuration(minutes, 525600)) return "Annual"
	if (bucket?.limitId !== "codex") return humanize(bucket?.limitName || bucket?.limitId || "Additional usage")
	return kind === "primary" ? "Usage limit" : "Secondary usage"
}

function humanize(value: string): string {
	return value
		.replace(/[_-]+/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase())
		.trim()
}

export function formatOpenAiCodexPlan(planType: string | undefined): string | undefined {
	if (!planType) return undefined
	const labels: Record<string, string> = {
		ent26: "Enterprise",
		enterprise_cbp_usage_based: "Enterprise usage-based",
		free_workspace: "Free workspace",
		self_serve_business_prolite: "Business Pro Lite",
		self_serve_business_usage_based: "Business usage-based",
		prolite: "Pro Lite",
	}
	return labels[planType] || humanize(planType)
}

function formatRelativeDuration(milliseconds: number): string {
	const minutes = Math.max(0, Math.round(milliseconds / 60000))
	if (minutes < 60) return `in ${Math.max(1, minutes)}m`
	const hours = Math.floor(minutes / 60)
	const remainingMinutes = minutes % 60
	if (hours < 48) return remainingMinutes ? `in ${hours}h ${remainingMinutes}m` : `in ${hours}h`
	return `in ${Math.round(hours / 24)}d`
}

export function formatOpenAiCodexReset(resetsAt: number | undefined, now = Date.now()): string {
	if (!resetsAt) return "Reset time unavailable"
	const resetDate = new Date(resetsAt * 1000)
	if (!Number.isFinite(resetDate.getTime())) return "Reset time unavailable"
	const relative = formatRelativeDuration(resetDate.getTime() - now)
	const sameDay = resetDate.toDateString() === new Date(now).toDateString()
	const time = resetDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
	if (sameDay) return resetDate.getTime() <= now ? `Reset scheduled for today at ${time}` : `Resets today at ${time} · ${relative}`
	if (resetDate.getTime() - now < 7 * 24 * 60 * 60 * 1000 && resetDate.getTime() > now) {
		return `Resets ${resetDate.toLocaleDateString(undefined, { weekday: "long" })} at ${time} · ${relative}`
	}
	return `Resets ${resetDate.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: resetDate.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
		hour: "numeric",
		minute: "2-digit",
	})}`
}

export function formatOpenAiCodexFreshness(fetchedAt: number | undefined, now = Date.now()): string {
	if (!fetchedAt) return "Update time unavailable"
	const age = Math.max(0, now - fetchedAt)
	let text = "Updated just now"
	if (age >= 60 * 60 * 1000) text = `Updated ${Math.floor(age / (60 * 60 * 1000))}h ago`
	else if (age >= 60 * 1000) text = `Updated ${Math.floor(age / (60 * 1000))}m ago`
	if (age > STALE_AFTER_MS) text += " · May be outdated"
	return text
}

function getDisplayWindows(snapshot?: OpenAiCodexUsageSnapshot): DisplayWindow[] {
	if (!snapshot) return []
	return [...snapshot.rateLimits]
		.sort((left, right) => {
			if (left.limitId === "codex") return -1
			if (right.limitId === "codex") return 1
			return (left.limitName || left.limitId).localeCompare(right.limitName || right.limitId)
		})
		.flatMap((bucket) =>
			(["primary", "secondary"] as const)
				.map((kind) => ({ bucket, kind, window: bucket[kind] }))
				.filter((entry): entry is DisplayWindow => entry.window !== undefined),
		)
		.sort((left, right) => {
			if (left.bucket.limitId !== right.bucket.limitId) return 0
			return (left.window.windowMinutes ?? Number.MAX_SAFE_INTEGER) - (right.window.windowMinutes ?? Number.MAX_SAFE_INTEGER)
		})
}

function RemainingBar({ usedPercent, width = 20 }: { usedPercent: number; width?: number }) {
	const remaining = getOpenAiCodexRemainingPercent(usedPercent)
	const filled = Math.round((remaining / 100) * width)
	return (
		<Text>
			<Text color={theme.primary}>{"█".repeat(filled)}</Text>
			<Text color={theme.subtle}>{"░".repeat(Math.max(0, width - filled))}</Text>
		</Text>
	)
}

function UsageWindowRow({ entry, now, barWidth }: { entry: DisplayWindow; now: number; barWidth: number }) {
	const { bucket, kind, window } = entry
	return (
		<Box flexDirection="column">
			<Text>
				<Text color={theme.text}>{formatOpenAiCodexWindowDuration(window.windowMinutes, kind, bucket)}</Text>
				<Text color={theme.muted}> · {formatRemainingPercent(window.usedPercent)}</Text>
			</Text>
			<Text>
				<RemainingBar usedPercent={window.usedPercent} width={barWidth} />
				<Text color={theme.muted}> {formatOpenAiCodexReset(window.resetsAt, now)}</Text>
			</Text>
		</Box>
	)
}

function formatTokenCount(tokens: number | undefined): string {
	return tokens === undefined ? "Unavailable" : tokens.toLocaleString()
}

function formatActivityDate(startDate: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate)
	if (!match) {
		const parsed = new Date(startDate)
		return Number.isNaN(parsed.getTime())
			? startDate
			: parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" })
	}
	const [, year, month, day] = match
	return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	})
}

function getRecentActivityRowLimit(columns: number, rows: number, windowCount: number): number {
	const preferredRows = columns >= 120 ? 30 : columns >= 100 ? 21 : 14
	const remainingRows = rows - (22 + windowCount * 3)
	return Math.max(0, Math.min(preferredRows, remainingRows))
}

export const OpenAiCodexUsagePanel: React.FC<OpenAiCodexUsagePanelProps> = ({
	controller,
	isAuthenticated,
	onClose,
	snapshot,
}) => {
	const { isRawModeSupported } = useStdinContext()
	const { columns, rows } = useTerminalSize()
	const [displaySnapshot, setDisplaySnapshot] = useState(snapshot)
	const [refreshing, setRefreshing] = useState(false)
	const [refreshError, setRefreshError] = useState<string>()
	const [now, setNow] = useState(Date.now())
	const refreshedResets = useRef(new Set<number>())
	const initialFetchAttempted = useRef(false)

	useEffect(() => setDisplaySnapshot(snapshot), [snapshot])
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60 * 1000)
		return () => clearInterval(timer)
	}, [])

	const refresh = useCallback(async () => {
		if (!controller || !isAuthenticated || refreshing) return
		setRefreshing(true)
		setRefreshError(undefined)
		try {
			const response = await refreshOpenAiCodexUsage(controller, EmptyRequest.create())
			setDisplaySnapshot(fromProtobufOpenAiCodexUsage(response))
		} catch (error) {
			setRefreshError(error instanceof Error ? error.message : "Usage data is temporarily unavailable")
		} finally {
			setRefreshing(false)
		}
	}, [controller, isAuthenticated, refreshing])

	useEffect(() => {
		if (!controller || !isAuthenticated || initialFetchAttempted.current) return
		const quotaNeedsRefresh =
			!displaySnapshot?.quotaFetchedAt || Date.now() - displaySnapshot.quotaFetchedAt > SHORT_FRESHNESS_MS
		const activityNeedsRefresh =
			!displaySnapshot?.activityFetchedAt || Date.now() - displaySnapshot.activityFetchedAt > SHORT_FRESHNESS_MS
		if (quotaNeedsRefresh || activityNeedsRefresh) {
			initialFetchAttempted.current = true
			void refresh()
		}
	}, [
		controller,
		displaySnapshot?.activityFetchedAt,
		displaySnapshot?.quotaFetchedAt,
		isAuthenticated,
		refresh,
	])

	const windows = useMemo(() => getDisplayWindows(displaySnapshot), [displaySnapshot])
	useEffect(() => {
		const passedReset = windows.find(({ window }) => {
			if (!window.resetsAt || refreshedResets.current.has(window.resetsAt)) return false
			const resetMs = window.resetsAt * 1000
			return resetMs <= now && resetMs > (displaySnapshot?.quotaFetchedAt || 0)
		})?.window.resetsAt
		if (passedReset) {
			refreshedResets.current.add(passedReset)
			void refresh()
		}
	}, [displaySnapshot?.quotaFetchedAt, now, refresh, windows])

	useInput(
		(input, key) => {
			if (shouldIgnoreTerminalInput(input, key)) return
			if (key.escape) onClose()
			else if (input.toLowerCase() === "r") void refresh()
		},
		{ isActive: isRawModeSupported },
	)

	if (!isAuthenticated) {
		return (
			<Panel label="ChatGPT usage">
				<Box flexDirection="column" gap={1}>
					<Text color={theme.text}>Sign in with ChatGPT to view subscription usage.</Text>
					<Text color={theme.muted}>Open API settings and authenticate the openai-codex provider.</Text>
				</Box>
			</Panel>
		)
	}

	const plan = formatOpenAiCodexPlan(displaySnapshot?.planType)
	const individualLimit = displaySnapshot?.spendControl?.individualLimit
	const barWidth = Math.max(8, Math.min(24, columns - 48))
	const activityBuckets = displaySnapshot?.activity?.dailyUsageBuckets ?? []
	const recentActivityRowLimit = getRecentActivityRowLimit(columns, rows, windows.length)
	const recentDays = recentActivityRowLimit > 0 ? activityBuckets.slice(-recentActivityRowLimit) : []
	const showActivitySummary = rows >= 28
	const showQuotaMetadata = rows >= 24

	return (
		<Panel label="ChatGPT usage">
			<Box flexDirection="column" gap={1}>
				<Box flexDirection="column">
					<Text>
						<Text bold color={theme.text}>ChatGPT subscription</Text>
						{plan && <Text color={theme.muted}> · {plan}</Text>}
					</Text>
					<Text color={theme.muted}>
						{formatOpenAiCodexFreshness(displaySnapshot?.quotaFetchedAt, now)} · {refreshing ? "Refreshing…" : "r to refresh"}
					</Text>
				</Box>

				{windows.length > 0 ? (
					<Box flexDirection="column" gap={1}>
						{windows.map((entry) => (
							<UsageWindowRow
								barWidth={barWidth}
								entry={entry}
								key={`${entry.bucket.limitId}-${entry.kind}`}
								now={now}
							/>
						))}
					</Box>
				) : (
					<Text color={theme.muted}>Quota data is not available yet.</Text>
				)}

				{showQuotaMetadata && displaySnapshot?.credits && (
					<Box flexDirection="column">
						<Text color={theme.text}>Credits</Text>
						<Text color={theme.muted}>
							{displaySnapshot.credits.unlimited
								? "Unlimited"
								: displaySnapshot.credits.balance !== undefined
									? `Balance ${displaySnapshot.credits.balance}`
									: displaySnapshot.credits.hasCredits
										? "Available"
										: "No credit balance reported"}
						</Text>
						{displaySnapshot.resetCreditsAvailable !== undefined && (
							<Text color={theme.muted}>Reset credits available: {displaySnapshot.resetCreditsAvailable}</Text>
						)}
					</Box>
				)}

				{showQuotaMetadata && displaySnapshot?.spendControl && (
					<Box flexDirection="column">
						<Text color={theme.text}>Spend control</Text>
						<Text color={theme.muted}>Status: {displaySnapshot.spendControl.reached ? "Reached" : "Within limit"}</Text>
						{individualLimit && (
							<Text color={theme.muted}>
								Used {individualLimit.used} of {individualLimit.limit}
								{individualLimit.remaining !== undefined ? ` · ${individualLimit.remaining} remaining` : ""}
								{individualLimit.resetsAt ? ` · ${formatOpenAiCodexReset(individualLimit.resetsAt, now)}` : ""}
							</Text>
						)}
					</Box>
				)}

				{showQuotaMetadata && displaySnapshot?.rateLimitReachedType && (
					<Text color={theme.muted}>Account limit status: {humanize(displaySnapshot.rateLimitReachedType)}</Text>
				)}

				<Box flexDirection="column">
					<Text bold color={theme.text}>Account token activity</Text>
					<Text color={theme.muted}>Token activity is account history and does not directly represent quota remaining.</Text>
					{displaySnapshot?.activity ? (
						<React.Fragment>
							{showActivitySummary && (
								<React.Fragment>
									<Text color={theme.muted}>
										Lifetime {formatTokenCount(displaySnapshot.activity.lifetimeTokens)} · Peak day{" "}
										{formatTokenCount(displaySnapshot.activity.peakDailyTokens)}
									</Text>
									<Text color={theme.muted}>
										Current streak {displaySnapshot.activity.currentStreakDays ?? "Unavailable"} days · Longest streak{" "}
										{displaySnapshot.activity.longestStreakDays ?? "Unavailable"} days
									</Text>
									{displaySnapshot.activity.longestRunningTurnSec !== undefined && (
										<Text color={theme.muted}>
											Longest turn {Math.round(displaySnapshot.activity.longestRunningTurnSec)}s
										</Text>
									)}
								</React.Fragment>
							)}
							{recentDays.map((bucket) => (
								<Text color={theme.muted} key={bucket.startDate}>
									{formatActivityDate(bucket.startDate)}: {bucket.tokens.toLocaleString()} tokens
								</Text>
							))}
							<Text color={theme.muted}>{formatOpenAiCodexFreshness(displaySnapshot.activityFetchedAt, now)}</Text>
						</React.Fragment>
					) : (
						<Text color={theme.muted}>Activity history is not available yet.</Text>
					)}
				</Box>

				{(displaySnapshot?.quotaError || displaySnapshot?.activityError || refreshError) && (
					<Box flexDirection="column">
						{displaySnapshot?.quotaError && <Text color={theme.muted}>Quota update: {displaySnapshot.quotaError}</Text>}
						{displaySnapshot?.activityError && <Text color={theme.muted}>Activity update: {displaySnapshot.activityError}</Text>}
						{refreshError && <Text color={theme.muted}>Refresh: {refreshError}</Text>}
					</Box>
				)}
			</Box>
		</Panel>
	)
}
