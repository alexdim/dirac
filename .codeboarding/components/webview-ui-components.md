---
component_id: 16
component_name: Webview UI Components
---

# Webview UI Components

## Component Description

Provides React components for the webview interface, including history view items and modular chat preview components.

---

## Key References:

### /Users/highlands/pools/Development/dirac/webview-ui/src/features/history/components/HistoryViewItem.tsx (lines 35-253)
```
const HistoryViewItem = ({
	item,
	pendingFavoriteToggles,
	handleDeleteHistoryItem,
	toggleFavorite,
	handleHistorySelect,
	isSelected,
	isDeleting,
	actionsDisabled,
}: HistoryViewItemProps) => {
	const navigateToChat = useAppStore((state) => state.navigateToChat)
	const [expanded, setExpanded] = useState(false)
	const [isOpening, setIsOpening] = useState(false)
	const [openError, setOpenError] = useState<string>()
	const detailsId = `history-details-${item.id}`
	const isGoal = isGoalHistoryItem(item)
	const displayText = isGoal ? item.objectivePreview : item.task
	const displayCost = isGoal ? item.accounting.cost : item.totalCost
	const inputTokens = isGoal ? item.accounting.inputTokens : item.tokensIn
	const outputTokens = isGoal ? item.accounting.outputTokens : item.tokensOut
	const cacheWrites = isGoal ? item.accounting.cacheWriteTokens : item.cacheWrites
	const cacheReads = isGoal ? item.accounting.cacheReadTokens : item.cacheReads

	const isFavoritedItem = useMemo(
		() => pendingFavoriteToggles[item.id] ?? item.isFavorited,
		[item.id, item.isFavorited, pendingFavoriteToggles],
	)

	const showRun = useCallback(async () => {
		setIsOpening(true)
		setOpenError(undefined)
		try {
			if (isGoal) {
				await GoalServiceClient.selectGoal(GoalControlRequest.create({ goalId: item.id }))
			} else {
				await TaskServiceClient.showTaskWithId(StringRequest.create({ value: item.id }))
			}
			navigateToChat()
		} catch (error) {
			console.error("Error showing history run:", error)
			setOpenError(
				error instanceof Error
					? error.message
					: `This ${isGoal ? "Goal" : "task"} could not be opened. Its saved history may be unavailable or unreadable.`,
			)
		} finally {
			setIsOpening(false)
		}
	}, [isGoal, item.id, navigateToChat])

	const formatDate = useCallback((timestamp: number) => {
		const date = new Date(timestamp)
		const today = new Date()
		const options: Intl.DateTimeFormatOptions =
			today.toDateString() === date.toDateString()
				? { hour: "numeric", minute: "2-digit", hour12: true }
				: { month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }
		return date.toLocaleString("en-US", options).replace(", ", " ").replace(" at", ",")
	}, [])

	return (
		<article
			aria-busy={isDeleting || isOpening}
			className={cn(
				"history-item group mb-1 flex border-b border-accent/10 hover:bg-list-hover",
				isDeleting && "opacity-50",
			)}>
			<VSCodeCheckbox
				aria-label={`Select ${isGoal ? "Goal" : "task"}: ${displayText}`}
				checked={isSelected}
				className="mt-3 self-start py-auto pl-3 pr-1"
				disabled={actionsDisabled}
				onChange={(event) => handleHistorySelect(item.id, (event.target as HTMLInputElement).checked)}
			/>

			<div className="relative flex min-w-0 flex-grow flex-col gap-2 py-2 pl-2 pr-3">
				<div className="flex items-center gap-2">
					<button
						className="min-w-0 flex-1 cursor-pointer overflow-hidden border-0 bg-transparent p-0 text-left focus-visible:outline-1 focus-visible:outline-ring"
						disabled={actionsDisabled || isOpening}
						onClick={showRun}
						title={`Open ${isGoal ? "Goal" : "task"}`}
						type="button">
						<span className="flex min-w-0 items-center gap-2">
							{isGoal && <Badge className="shrink-0">Goal</Badge>}
							<span className="ph-no-capture line-clamp-1 break-words whitespace-pre-wrap">{displayText}</span>
						</span>
					</button>
					<div className="flex flex-shrink-0 gap-2">
						<Button
							aria-label={`Delete ${isGoal ? "Goal" : "task"}`}
							className="p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
							disabled={isFavoritedItem || actionsDisabled}
							onClick={() => handleDeleteHistoryItem(item.id)}
							title={
								isFavoritedItem
									? `Remove this ${isGoal ? "Goal" : "task"} from favorites before deleting it`
									: `Delete ${isGoal ? "Goal" : "task"}`
							}
							variant="ghost">
							<TrashIcon className="stroke-1" />
						</Button>
						<Button
							aria-label={isFavoritedItem ? "Remove from favorites" : "Add to favorites"}
							className="p-0"
							disabled={pendingFavoriteToggles[item.id] !== undefined || actionsDisabled}
							onClick={() => toggleFavorite(item.id, Boolean(isFavoritedItem))}
							variant="icon">
							<StarIcon
								className={cn("opacity-70", {
									"fill-button-background text-button-background opacity-100": isFavoritedItem,
								})}
							/>
						</Button>
					</div>
				</div>

				{openError && (
					<div className="rounded-xs bg-error/10 px-2 py-1 text-xs text-error" role="alert">
						{openError}
					</div>
				)}

				<Button
					aria-controls={detailsId}
					aria-expanded={expanded}
					aria-label={
						expanded ? `Hide ${isGoal ? "Goal" : "task"} details` : `Show ${isGoal ? "Goal" : "task"} details`
					}
					className="w-full p-0"
					onClick={() => setExpanded((current) => !current)}
					variant="icon">
					<span className="flex w-full items-center justify-between">
						<span className="text-xs uppercase text-description">{formatDate(item.ts)}</span>
						<span className="flex items-center text-xs">
							<span className="text-description">
								{displayCost === undefined ? "—" : `$${displayCost.toFixed(4)}`}
							</span>
							{expanded ? (
								<ChevronsDownUpIcon className="text-description" />
							) : (
								<ChevronsUpDownIcon className="text-description opacity-60 group-hover:opacity-100" />
							)}
						</span>
					</span>
				</Button>

				{expanded && (
					<div className="m-0 w-full rounded-xs bg-accent/10 p-2 text-xs" id={detailsId}>
						<div className="flex w-full flex-col gap-1 text-xs">
							{isGoal && (
								<>
									<div className="flex w-full items-start justify-between gap-2">
										<span className="font-medium text-description">Status:</span>
										<span className="text-right capitalize text-description">{item.status}</span>
									</div>
									<div className="flex w-full items-start justify-between gap-2">
										<span className="font-medium text-description">Revision:</span>
										<span className="text-right text-description">{item.objectiveRevision}</span>
									</div>
								</>
							)}
							<div className="flex w-full items-center justify-between gap-1">
								<span className="font-medium text-description">Tokens:</span>
								<span className="flex items-center gap-1 text-xs text-description">
									<span className="flex items-center gap-1">
										<ArrowUpIcon className="!size-1" />
										{inputTokens === undefined ? "—" : formatLargeNumber(inputTokens)}
									</span>
									<span className="flex items-center gap-1">
										<ArrowDownIcon className="!size-1" />
										{outputTokens === undefined ? "—" : formatLargeNumber(outputTokens)}
									</span>
									{cacheWrites !== undefined && (
										<span className="flex items-center gap-1">
											<ArrowRightIcon className="!size-1" />
											{formatLargeNumber(cacheWrites)}
										</span>
									)}
									{cacheReads !== undefined && (
										<span className="flex items-center gap-1">
											<ArrowLeftIcon className="!size-1" />
											{formatLargeNumber(cacheReads)}
										</span>
									)}
								</span>
							</div>

							{item.modelId && (
								<div className="flex w-full items-start justify-between gap-2">
									<span className="font-medium text-description">Model:</span>
									<span className="break-all text-right text-description">{item.modelId}</span>
								</div>
							)}

							{!isGoal && <div className="flex w-full items-center justify-between gap-1">
								<span className="font-medium text-description">Size:</span>
								<span className="flex items-center gap-2 text-description">
									{formatSize(item.size)}
									<Button
										aria-label="Export task"
										className="m-0 p-0"
										onClick={() =>
											TaskServiceClient.exportTaskWithId(
												StringRequest.create({ value: item.id }),
											).catch((error) => console.error("Failed to export task:", error))
										}
										variant="ghost">
										<DownloadIcon />
									</Button>
								</span>
							</div>}
						</div>
					</div>
				)}
			</div>
		</article>
	)
}
```

### /Users/highlands/pools/Development/dirac/webview-ui/src/features/modular-ui/chat/components/HistoryPreview.tsx (lines 14-226)
```
const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const taskHistory = useTaskStore((state) => state.taskHistory)
	const [openError, setOpenError] = useState<string>()
	const quote = useMemo(() => getRandomQuote(), [])
	const recentRuns = taskHistory.filter((item) => item.ts && item.task)
	const handleHistorySelect = (item: HistoryItem) => {
		setOpenError(undefined)
		const openRun = isGoalHistoryItem(item)
			? GoalServiceClient.selectGoal(GoalControlRequest.create({ goalId: item.id }))
			: TaskServiceClient.showTaskWithId(StringRequest.create({ value: item.id }))
		openRun.catch((error) => {
			console.error("Error showing history run:", error)
			setOpenError(error instanceof Error ? error.message : "This run could not be opened.")
		})
	}

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date?.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
		})
	}

	return (
		<div style={{ flexShrink: 0 }}>
			<style>
				{`
					.history-preview-item {
						background-color: var(--dirac-surface-raised);
						border-radius: 4px;
						position: relative;
						overflow: hidden;
						cursor: pointer;
						margin-bottom: 8px;
						padding: 10px 12px;
						display: flex;
						align-items: flex-start;
						gap: 12px;
					}
					.history-preview-item:hover {
						background-color: var(--dirac-surface-hover);
						pointer-events: auto;
					}
					.history-task-content {
						flex: 1;
						display: flex;
						align-items: flex-start;
						gap: 8px;
						min-width: 0;
					}
					.history-task-description {
						flex: 1;
						overflow: hidden;
						display: -webkit-box;
						-webkit-line-clamp: 2;
						-webkit-box-orient: vertical;
						color: var(--vscode-foreground);
						font-size: var(--vscode-font-size);
						line-height: 1.4;
					}
					.history-meta-stack {
						display: flex;
						flex-direction: column;
						align-items: center;
						gap: 4px;
						flex-shrink: 0;
					}
					.history-date {
						color: var(--vscode-descriptionForeground);
						font-size: 0.85em;
						white-space: nowrap;
					}
					.history-cost-chip {
						background-color: color-mix(in srgb, var(--vscode-badge-background) 42%, transparent);
						border: 1px solid color-mix(in srgb, var(--vscode-badge-foreground) 22%, transparent);
						color: var(--vscode-foreground);
						padding: 2px 8px;
						border-radius: 12px;
						font-size: 0.85em;
						font-weight: 600;
						white-space: nowrap;
					}
					.history-view-all-btn {
						background: none;
						border: none;
						padding: 4px 0 4px 8px;
						cursor: pointer;
						font-size: 0.85em;
						font-weight: 500;
						color: var(--vscode-descriptionForeground);
						white-space: nowrap;
						display: flex;
						align-items: center;
						gap: 2px;
					.history-view-all-btn .codicon {
						font-size: 1.2em;
					}
					.history-view-all-btn:hover {
						color: var(--vscode-foreground);
					}
				`}
			</style>

			<div
				className="history-header"
				style={{
					color: "var(--vscode-descriptionForeground)",
					margin: "10px 16px 10px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span
						className="codicon codicon-comment-discussion"
						style={{
							marginRight: "4px",
							transform: "scale(0.9)",
						}}
					/>
					<span
						style={{
							fontWeight: 500,
							fontSize: "0.85em",
							textTransform: "uppercase",
						}}>
						Recent
					</span>
				</div>
				{recentRuns.length > 0 && (
					<button
						aria-label="View all history"
						className="history-view-all-btn"
						onClick={() => showHistoryView()}
						type="button">
						View All
						<span className="codicon codicon-chevron-right" />
					</button>
				)}
			</div>
			<div className="px-4">
				<div className="flex justify-center py-3 pb-5">
					<div className="flex flex-col items-center gap-2">
						<div className="dirac-logo-aura">
							<DiracLogoVariable transparentBackground />
						</div>
						<div className="text-[0.9em] text-(--vscode-descriptionForeground) italic text-center max-w-[80%] leading-[1.4]">
							"{quote}"
						</div>
					</div>
				</div>
			</div>

			{openError && (
				<div className="mx-4 mb-2 rounded-xs bg-error/10 px-2 py-1 text-xs text-error" role="alert">
					{openError}
				</div>
			)}

			{
				<div className="px-4">
					{recentRuns.length > 0 ? (
						recentRuns.slice(0, 3).map((item) => (
							<div className="history-preview-item" key={item.id} onClick={() => handleHistorySelect(item)}>
								<div className="history-task-content">
									{item.isFavorited && (
										<span
											aria-label="Favorited"
											className="codicon codicon-star-full"
											style={{
												color: "var(--vscode-button-background)",
												flexShrink: 0,
											}}
										/>
									)}
									<div className="history-task-description ph-no-capture">
										{isGoalHistoryItem(item) && (
											<span className="mr-1 rounded bg-(--vscode-badge-background) px-1.5 py-0.5 text-[10px] font-medium text-(--vscode-badge-foreground)">
												Goal
											</span>
										)}
										{isGoalHistoryItem(item) ? item.objectivePreview : item.task}
									</div>
								</div>
								<div className="history-meta-stack">
									<span className="history-date">{formatDate(item.ts)}</span>
									<span className="history-cost-chip">
										{isGoalHistoryItem(item)
											? item.accounting.cost === undefined
												? "—"
												: `$${item.accounting.cost.toFixed(2)}`
											: `$${item.totalCost.toFixed(2)}`}
									</span>
								</div>
							</div>
						))
					) : (
						<div
							style={{
								textAlign: "center",
								color: "var(--vscode-descriptionForeground)",
								fontSize: "var(--vscode-font-size)",
								padding: "10px 0",
							}}>
							No recent runs
						</div>
					)}
				</div>
			}
		</div>
	)
}
```


## Source Files:

- `webview-ui/src/features/history/components/HistoryViewItem.tsx`
- `webview-ui/src/features/modular-ui/chat/components/HistoryPreview.tsx`

