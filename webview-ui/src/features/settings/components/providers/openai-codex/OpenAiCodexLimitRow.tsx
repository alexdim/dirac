import type { OpenAiCodexRateLimitWindow } from "@shared/openai-codex-usage"
import { Progress } from "@/shared/ui/progress"
import { formatOpenAiCodexRemaining, formatOpenAiCodexReset, getOpenAiCodexRemainingPercent } from "./formatOpenAiCodexUsage"

interface OpenAiCodexLimitRowProps {
	label: string
	window: OpenAiCodexRateLimitWindow
	now: number
	compact?: boolean
}

export function OpenAiCodexLimitRow({ label, window, now, compact = false }: OpenAiCodexLimitRowProps) {
	const remaining = getOpenAiCodexRemainingPercent(window.usedPercent)
	const remainingLabel = formatOpenAiCodexRemaining(window.usedPercent)

	return (
		<div className="space-y-1.5 py-2">
			<div className="flex items-baseline justify-between gap-3 text-xs">
				<span className="min-w-0 truncate font-medium text-(--vscode-foreground)">{label}</span>
				<span className="shrink-0 tabular-nums text-[var(--dirac-limit-remaining)]">{remainingLabel}</span>
			</div>
			<Progress
				aria-label={`${label}: ${remainingLabel}`}
				className="h-1.5 bg-[var(--dirac-limit-track)]"
				indicatorClassName="bg-[var(--dirac-limit-remaining)]"
				value={remaining}
			/>
			<p className="m-0 text-[11px] leading-4 text-(--vscode-descriptionForeground)">
				{formatOpenAiCodexReset(window.resetsAt, now)}
			</p>
			{!compact && window.windowMinutes !== undefined && (
				<p className="m-0 text-[10px] text-(--vscode-descriptionForeground)">
					Backend window: {Math.round(window.windowMinutes).toLocaleString()} minutes
				</p>
			)}
		</div>
	)
}
