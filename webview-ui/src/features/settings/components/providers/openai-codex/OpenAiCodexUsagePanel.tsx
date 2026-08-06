import type { OpenAiCodexUsageSnapshot } from "@shared/openai-codex-usage"
import { RefreshCwIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/shared/ui/button"
import { Separator } from "@/shared/ui/separator"
import { OpenAiCodexActivity } from "./OpenAiCodexActivity"
import { OpenAiCodexLimitRow } from "./OpenAiCodexLimitRow"
import {
	formatOpenAiCodexFreshness,
	formatOpenAiCodexPlan,
	getOpenAiCodexQuotaFetchedAt,
	selectOpenAiCodexDisplayWindows,
} from "./formatOpenAiCodexUsage"

interface OpenAiCodexUsagePanelProps {
	snapshot?: OpenAiCodexUsageSnapshot
	isRefreshing: boolean
	refreshError?: string
	isPopup?: boolean
	onRefresh: (force?: boolean) => Promise<void>
	onViewDetails?: () => void
}

export function OpenAiCodexUsagePanel({
	snapshot,
	isRefreshing,
	refreshError,
	isPopup = false,
	onRefresh,
	onViewDetails,
}: OpenAiCodexUsagePanelProps) {
	const [now, setNow] = useState(() => Date.now())
	const refreshedResetKeys = useRef(new Set<string>())
	const windows = useMemo(() => selectOpenAiCodexDisplayWindows(snapshot), [snapshot])
	const displayedWindows = isPopup ? windows.filter((window) => window.bucket.limitId === "codex") : windows
	const fetchedAt = getOpenAiCodexQuotaFetchedAt(snapshot)

	useEffect(() => {
		const interval = window.setInterval(() => setNow(Date.now()), 60_000)
		return () => window.clearInterval(interval)
	}, [])

	useEffect(() => {
		for (const displayWindow of displayedWindows) {
			const resetsAt = displayWindow.window.resetsAt
			if (!resetsAt || resetsAt * 1_000 > now) continue
			const key = `${displayWindow.bucket.limitId}:${displayWindow.kind}:${resetsAt}`
			if (refreshedResetKeys.current.has(key)) continue
			refreshedResetKeys.current.add(key)
			void onRefresh(true)
			break
		}
	}, [displayedWindows, now, onRefresh])

	return (
		<section className="openai-codex-usage rounded-md border border-(--vscode-panel-border) p-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="m-0 text-sm font-medium text-(--vscode-foreground)">Subscription usage</h3>
					<p className="mb-0 mt-1 text-[11px] text-(--vscode-descriptionForeground)">
						{formatOpenAiCodexFreshness(fetchedAt, now)}
					</p>
				</div>
				<Button
					aria-label="Refresh ChatGPT usage"
					disabled={isRefreshing}
					onClick={() => void onRefresh(true)}
					size="xs"
					type="button"
					variant="ghost">
					<RefreshCwIcon size={12} />
					Refresh
				</Button>
			</div>

			{snapshot && displayedWindows.length > 0 ? (
				<div className="mt-2 divide-y divide-(--vscode-panel-border)">
					{displayedWindows.map((displayWindow) => (
						<OpenAiCodexLimitRow
							compact={isPopup}
							key={`${displayWindow.bucket.limitId}-${displayWindow.kind}`}
							label={
								displayWindow.bucket.limitId === "codex"
									? displayWindow.label
									: `${displayWindow.bucket.limitName || displayWindow.bucket.limitId} · ${displayWindow.label}`
							}
							now={now}
							window={displayWindow.window}
						/>
					))}
				</div>
			) : (
				<p className="mb-0 mt-3 text-xs leading-5 text-(--vscode-descriptionForeground)">
					{isRefreshing ? "Loading subscription usage…" : "Usage details are not available yet."}
				</p>
			)}

			{snapshot && (
				<>
					<Separator className="my-2" />
					<div className="space-y-1.5 text-xs">
						{snapshot.planType && <FactRow label="Plan" value={formatOpenAiCodexPlan(snapshot.planType) || snapshot.planType} />}
						{snapshot.credits && (
							<FactRow
								label="Credits"
								value={
									snapshot.credits.unlimited
										? "Unlimited"
										: snapshot.credits.balance !== undefined
											? snapshot.credits.balance
											: snapshot.credits.hasCredits
												? "Available"
												: "None available"
								}
							/>
						)}
						{snapshot.spendControl?.individualLimit && (
							<>
								<FactRow label="Spend limit" value={snapshot.spendControl.individualLimit.limit} />
								<FactRow label="Used" value={snapshot.spendControl.individualLimit.used} />
								{snapshot.spendControl.individualLimit.remaining !== undefined && (
									<FactRow label="Remaining" value={snapshot.spendControl.individualLimit.remaining} />
								)}
							</>
						)}
						{snapshot.rateLimitReachedType && <FactRow label="Account status" value={snapshot.rateLimitReachedType.replace(/_/g, " ")} />}
						{snapshot.resetCreditsAvailable !== undefined && (
							<FactRow label="Reset credits available" value={snapshot.resetCreditsAvailable.toLocaleString()} />
						)}
					</div>
				</>
			)}

			{(snapshot?.quotaError || refreshError) && (
				<p className="mb-0 mt-2 text-[11px] leading-4 text-(--vscode-descriptionForeground)">
					{snapshot?.quotaError || refreshError} Existing values are still shown.
				</p>
			)}

			{!isPopup && snapshot && (
				<OpenAiCodexActivity
					activity={snapshot.activity}
					activityError={snapshot.activityError}
					activityFetchedAt={snapshot.activityFetchedAt}
				/>
			)}
			{isPopup && onViewDetails && (
				<Button className="mt-2 px-0" onClick={onViewDetails} size="xs" type="button" variant="link">
					View usage details
				</Button>
			)}
		</section>
	)
}

function FactRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-start justify-between gap-4">
			<span className="text-(--vscode-descriptionForeground)">{label}</span>
			<span className="max-w-[65%] break-words text-right text-(--vscode-foreground)">{value}</span>
		</div>
	)
}
