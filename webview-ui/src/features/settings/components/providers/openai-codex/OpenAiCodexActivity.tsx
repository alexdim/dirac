import type { OpenAiCodexUsageSnapshot } from "@shared/openai-codex-usage"
import { ChevronDownIcon } from "lucide-react"
import { useMemo, useState } from "react"
import {
	formatOpenAiCodexActivityDate,
	formatOpenAiCodexDuration,
	formatOpenAiCodexFreshness,
	formatOpenAiCodexNumber,
} from "./formatOpenAiCodexUsage"

interface OpenAiCodexActivityProps {
	activity: OpenAiCodexUsageSnapshot["activity"]
	activityFetchedAt?: number
	activityError?: string
}

export function OpenAiCodexActivity({ activity, activityFetchedAt, activityError }: OpenAiCodexActivityProps) {
	const [expanded, setExpanded] = useState(false)
	const buckets = useMemo(() => (activity?.dailyUsageBuckets ?? []).slice(-21), [activity?.dailyUsageBuckets])
	const peak = Math.max(1, ...buckets.map((bucket) => bucket.tokens))

	return (
		<div className="border-t border-(--vscode-panel-border) pt-2">
			<button
				aria-expanded={expanded}
				className="flex w-full items-center justify-between gap-2 border-0 bg-transparent px-0 py-1 text-left text-xs text-(--vscode-foreground)"
				onClick={() => setExpanded((current) => !current)}
				type="button">
				<span>Account token activity</span>
				<ChevronDownIcon className={expanded ? "rotate-180 transition-transform" : "transition-transform"} size={14} />
			</button>
			{expanded && (
				<div className="space-y-3 pb-1 pt-2">
					<p className="m-0 text-[11px] leading-4 text-(--vscode-descriptionForeground)">
						Token activity is account history and does not directly represent quota remaining.
					</p>
					<p className="m-0 text-[10px] leading-4 text-(--vscode-descriptionForeground)">
						{formatOpenAiCodexFreshness(activityFetchedAt)}
					</p>
					{activity ? (
						<>
							<div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
								<ActivityFact label="Lifetime tokens" value={formatOpenAiCodexNumber(activity.lifetimeTokens)} />
								<ActivityFact label="Peak daily tokens" value={formatOpenAiCodexNumber(activity.peakDailyTokens)} />
								<ActivityFact label="Current streak" value={formatDays(activity.currentStreakDays)} />
								<ActivityFact label="Longest streak" value={formatDays(activity.longestStreakDays)} />
								<ActivityFact label="Longest turn" value={formatOpenAiCodexDuration(activity.longestRunningTurnSec)} />
							</div>
							{buckets.length > 0 && (
								<div>
									<p className="mb-2 mt-0 text-[11px] text-(--vscode-descriptionForeground)">Recent daily token activity</p>
									<div
										aria-label="Recent daily token activity"
										className="flex h-24 items-end gap-1 rounded-sm border border-(--vscode-panel-border) px-2 pb-2 pt-3"
										role="img">
										{buckets.map((bucket) => {
											const dateLabel = formatOpenAiCodexActivityDate(bucket.startDate)
											return (
												<div
													aria-label={`${dateLabel}: ${bucket.tokens.toLocaleString()} tokens`}
													className="min-w-0 flex-1 rounded-t-[2px] bg-code-foreground/60"
													key={`${bucket.startDate}-${bucket.tokens}`}
													style={{ height: `${Math.max(3, (bucket.tokens / peak) * 100)}%` }}
													title={`${dateLabel}: ${bucket.tokens.toLocaleString()} tokens`}
												/>
											)
										})}
									</div>
								</div>
							)}
						</>
					) : (
						<p className="m-0 text-xs text-(--vscode-descriptionForeground)">
							{activityError || "Account activity is not available yet."}
						</p>
					)}
				</div>
			)}
		</div>
	)
}

function ActivityFact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<p className="m-0 text-[10px] text-(--vscode-descriptionForeground)">{label}</p>
			<p className="m-0 tabular-nums text-(--vscode-foreground)">{value}</p>
		</div>
	)
}

function formatDays(value: number | undefined): string {
	if (value === undefined) return "Unavailable"
	return `${Math.round(value)} day${Math.round(value) === 1 ? "" : "s"}`
}
