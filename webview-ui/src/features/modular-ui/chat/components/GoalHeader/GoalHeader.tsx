import type { GoalAccounting, GoalStatus, GoalTaskSummary, GoalViewState } from "@shared/goal"
import { GoalControlRequest } from "@shared/proto/dirac/goal"
import { ChevronDownIcon, ChevronRightIcon, CirclePauseIcon, CirclePlayIcon, CircleStopIcon, GoalIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { GoalServiceClient } from "@/shared/api/grpc-client"
import { formatLargeNumber } from "@/shared/lib/format"
import { Badge, type BadgeProps } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"

type GoalAction = "resume" | "pause" | "stop"

const STATUS_VARIANTS: Record<GoalStatus, BadgeProps["variant"]> = {
	working: "info",
	waiting: "warning",
	paused: "outline",
	blocked: "danger",
	achieved: "success",
	stopped: "outline",
}

function formatDuration(durationMs: number | undefined): string {
	if (durationMs === undefined) return "—"
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
	const hours = Math.floor(totalSeconds / 3_600)
	const minutes = Math.floor((totalSeconds % 3_600) / 60)
	const seconds = totalSeconds % 60
	if (hours > 0) return `${hours}h ${minutes}m`
	if (minutes > 0) return `${minutes}m ${seconds}s`
	return `${seconds}s`
}

function formatTokens(value: number | undefined): string {
	return value === undefined ? "—" : formatLargeNumber(value)
}

function formatCost(value: number | undefined): string {
	return value === undefined ? "—" : `$${value.toFixed(4)}`
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-2">
			<span className="text-description">{label}</span>
			<span className="truncate font-mono text-foreground">{value}</span>
		</div>
	)
}

function AccountingMetrics({ accounting }: { accounting: GoalAccounting }) {
	return (
		<div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-sm border border-foreground/5 bg-foreground/5 p-2 text-xs">
			<Metric label="Tokens" value={formatTokens(accounting.totalTokens)} />
			<Metric label="Input" value={formatTokens(accounting.inputTokens)} />
			<Metric label="Output" value={formatTokens(accounting.outputTokens)} />
			<Metric label="Reasoning" value={formatTokens(accounting.reasoningTokens)} />
			<Metric label="Cache read" value={formatTokens(accounting.cacheReadTokens)} />
			<Metric label="Cache write" value={formatTokens(accounting.cacheWriteTokens)} />
			<Metric label="Cost" value={formatCost(accounting.cost)} />
		</div>
	)
}

function ChildSummary({ child }: { child: GoalTaskSummary }) {
	return (
		<li className="rounded-sm border border-foreground/5 bg-foreground/5 px-2 py-1.5">
			<div className="flex min-w-0 items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-xs font-medium">{child.title}</span>
				<Badge className="shrink-0 capitalize" type="default" variant="outline">
					{child.role}
				</Badge>
				<Badge className="shrink-0 capitalize" type="default" variant="outline">
					{child.status}
				</Badge>
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-description">
				{child.runningDurationMs !== undefined && <span>Running {formatDuration(child.runningDurationMs)}</span>}
				<span>Idle {formatDuration(child.idleDurationMs)}</span>
				{child.pendingInteraction && <span className="text-warning">Needs {child.pendingInteraction.kind}</span>}
			</div>
			{child.terminalSummary && <p className="mb-0 mt-1 line-clamp-2 text-xs text-description">{child.terminalSummary}</p>}
		</li>
	)
}

interface GoalHeaderProps {
	goal: GoalViewState
}

const GoalHeader = ({ goal }: GoalHeaderProps) => {
	const isExpanded = useSettingsStore((state) => state.expandTaskHeader)
	const setIsExpanded = useSettingsStore((state) => state.setExpandTaskHeader)
	const [pendingAction, setPendingAction] = useState<GoalAction>()
	const [controlError, setControlError] = useState<string>()
	const detailsId = `goal-details-${goal.id}`
	const canResume = goal.status === "paused" || goal.status === "blocked"
	const canPause = goal.status === "working" || goal.status === "waiting"
	const canStop = goal.status !== "achieved" && goal.status !== "stopped"

	const runControl = useCallback(
		async (action: GoalAction) => {
			setPendingAction(action)
			setControlError(undefined)
			try {
				const request = GoalControlRequest.create({
					goalId: goal.id,
					...(action === "pause" ? { reason: "Paused from the Goal header" } : {}),
					...(action === "stop" ? { reason: "Stopped from the Goal header" } : {}),
				})
				if (action === "resume") await GoalServiceClient.resumeGoal(request)
				if (action === "pause") await GoalServiceClient.pauseGoal(request)
				if (action === "stop") await GoalServiceClient.stopGoal(request)
			} catch (error) {
				console.error(`[GoalHeader] Failed to ${action} Goal ${goal.id}:`, error)
				const pastTense = action === "resume" ? "resumed" : action === "pause" ? "paused" : "stopped"
				setControlError(`Goal could not be ${pastTense}.`)
			} finally {
				setPendingAction(undefined)
			}
		},
		[goal.id],
	)

	return (
		<div className="flex flex-col gap-1 px-4 py-2">
			<div className="relative z-10 flex flex-col gap-2 overflow-hidden rounded-md border border-foreground/10 bg-(--vscode-toolbar-hoverBackground)/40 px-3 py-2.5">
				<div className="flex min-w-0 items-center gap-2">
					<button
						aria-controls={detailsId}
						aria-expanded={isExpanded}
						aria-label={isExpanded ? "Collapse Goal details" : "Expand Goal details"}
						className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm bg-transparent text-left focus-visible:outline-2 focus-visible:outline-ring"
						onClick={() => setIsExpanded(!isExpanded)}
						type="button">
						{isExpanded ? (
							<ChevronDownIcon className="shrink-0" size={16} />
						) : (
							<ChevronRightIcon className="shrink-0" size={16} />
						)}
						<GoalIcon className="shrink-0 text-link" size={15} />
						<span className="min-w-0 flex-1 truncate text-sm font-medium ph-no-capture">
							{goal.objective.markdown}
						</span>
						<Badge className="shrink-0">Goal · r{goal.objective.revision}</Badge>
						<Badge className="shrink-0 capitalize" variant={STATUS_VARIANTS[goal.status]}>
							{goal.status}
						</Badge>
					</button>
				</div>

				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-[10px] text-description">
					<span>Active {formatDuration(goal.activeDurationMs)}</span>
					<span>Wall {formatDuration(goal.wallDurationMs)}</span>
					<span>{formatCost(goal.accounting.cost)}</span>
					{goal.pendingInteractionCount > 0 && (
						<span className="text-warning">
							{goal.pendingInteractionCount} pending interaction{goal.pendingInteractionCount === 1 ? "" : "s"}
						</span>
					)}
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{canResume && (
							<Button
								aria-label="Resume Goal"
								disabled={pendingAction !== undefined}
								onClick={() => void runControl("resume")}
								size="xs"
								title={`Resume Goal ${goal.id}`}
								variant="success">
								<CirclePlayIcon /> Resume
							</Button>
						)}
						{canPause && (
							<Button
								aria-label="Pause Goal"
								disabled={pendingAction !== undefined}
								onClick={() => void runControl("pause")}
								size="xs"
								title={`Pause Goal ${goal.id}`}
								variant="outline">
								<CirclePauseIcon /> Pause
							</Button>
						)}
						{canStop && (
							<Button
								aria-label="Stop Goal"
								disabled={pendingAction !== undefined}
								onClick={() => void runControl("stop")}
								size="xs"
								title={`Stop Goal ${goal.id}`}
								variant="danger">
								<CircleStopIcon /> Stop
							</Button>
						)}
					</div>
				</div>

				{goal.statusReason && <p className="mb-0 mt-0 pl-6 text-xs text-description">{goal.statusReason}</p>}
				{controlError && (
					<p className="mb-0 mt-0 text-xs text-error" role="alert">
						{controlError}
					</p>
				)}

				{isExpanded && (
					<div className="flex max-h-[48vh] flex-col gap-3 overflow-y-auto pt-1 custom-scrollbar" id={detailsId}>
						<section>
							<div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium">
								<span>Objective</span>
								<span className="font-normal text-description">Revision {goal.objective.revision}</span>
							</div>
							<p className="mb-0 whitespace-pre-wrap break-words rounded-sm border border-foreground/5 bg-foreground/5 p-2 text-sm ph-no-capture">
								{goal.objective.markdown}
							</p>
						</section>

						<section>
							<h3 className="mb-1 mt-0 text-xs font-medium">Authoritative accounting</h3>
							<AccountingMetrics accounting={goal.accounting} />
						</section>

						{goal.latestVerification && (
							<section className="rounded-sm border border-foreground/10 p-2 text-xs">
								<div className="flex items-center justify-between gap-2">
									<span className="font-medium">Latest verification</span>
									<Badge className="capitalize" variant="outline">
										{goal.latestVerification.status}
									</Badge>
								</div>
								<p className="mb-0 mt-1 text-description">
									{goal.latestVerification.terminalSummary ?? goal.latestVerification.title}
								</p>
							</section>
						)}

						<section>
							<div className="mb-1 flex items-center justify-between gap-2">
								<h3 className="m-0 text-xs font-medium">Contained Tasks</h3>
								<span className="text-[10px] text-description">{goal.children.length} total</span>
							</div>
							{goal.children.length > 0 ? (
								<ul className="m-0 flex list-none flex-col gap-1 p-0">
									{goal.children.map((child) => (
										<ChildSummary child={child} key={child.id} />
									))}
								</ul>
							) : (
								<p className="mb-0 mt-0 text-xs text-description">No contained Tasks yet.</p>
							)}
						</section>
					</div>
				)}
			</div>
		</div>
	)
}

export default GoalHeader
