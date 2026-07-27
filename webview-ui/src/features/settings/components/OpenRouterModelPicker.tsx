import type { ModelInfo } from "@shared/api"
import type { Mode } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/dirac/common"
import { VSCodeButton, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import type React from "react"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { StateServiceClient } from "@/shared/api/grpc-client"
import { highlight } from "../../history/components/HistoryView/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import { OpenRouterProviderSelector, OpenRouterRoutingControls } from "./OpenRouterRoutingControls"
import ReasoningEffortSelector from "./ReasoningEffortSelector"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import { filterOpenRouterModelIds, getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

// Star icon for favorites
const StarIcon = ({ isFavorite, onClick }: { isFavorite: boolean; onClick: (e: React.MouseEvent) => void }) => {
	return (
		<div
			onClick={onClick}
			style={{
				cursor: "pointer",
				color: isFavorite ? "var(--vscode-terminal-ansiBlue)" : "var(--vscode-descriptionForeground)",
				marginLeft: "8px",
				fontSize: "16px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				userSelect: "none",
				WebkitUserSelect: "none",
			}}>
			{isFavorite ? "★" : "☆"}
		</div>
	)
}

export interface OpenRouterModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
	isPendingProviderSelection?: boolean
	onModelSelected?: (modelId: string, modelInfo: ModelInfo | undefined) => Promise<boolean>
	onCancelProviderSelection?: () => void
}

function resolveRankedModelIds(rankedCanonicalSlugs: string[], models: Record<string, { canonicalSlug?: string }>): string[] {
	const resolvedModelIds: string[] = []
	const resolvedModelIdSet = new Set<string>()
	for (const rankedCanonicalSlug of rankedCanonicalSlugs) {
		const modelId = resolveRankedModelId(rankedCanonicalSlug, models)
		if (!modelId || resolvedModelIdSet.has(modelId)) continue
		resolvedModelIds.push(modelId)
		resolvedModelIdSet.add(modelId)
	}
	return resolvedModelIds
}

function resolveRankedModelId(
	rankedCanonicalSlug: string,
	models: Record<string, { canonicalSlug?: string }>,
): string | undefined {
	if (models[rankedCanonicalSlug]) return rankedCanonicalSlug
	const isFreeRanking = rankedCanonicalSlug.endsWith(":free")
	const canonicalSlug = isFreeRanking ? rankedCanonicalSlug.slice(0, -":free".length) : rankedCanonicalSlug
	return Object.entries(models).find(
		([modelId, modelInfo]) => modelInfo.canonicalSlug === canonicalSlug && modelId.endsWith(":free") === isFreeRanking,
	)?.[0]
}

const OpenRouterModelPicker: React.FC<OpenRouterModelPickerProps> = ({
	isPopup,
	currentMode,
	isPendingProviderSelection = false,
	onModelSelected,
	onCancelProviderSelection,
}) => {
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const {
		apiConfiguration,
		favoritedModelIds,
		openRouterModels,
		openRouterModelRankings,
		refreshOpenRouterModels,
		refreshOpenRouterModelRankings,
	} = useSettingsStore()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.openRouterModelId || "")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const [customModelAdvancedExpanded, setCustomModelAdvancedExpanded] = useState(false)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = async (newModelId: string) => {
		if (!newModelId) return
		setSearchTerm(newModelId)
		const modelInfo = openRouterModels[newModelId]
		if (onModelSelected) {
			await onModelSelected(newModelId, modelInfo)
			return
		}
		await handleModeFieldsChange(
			{
				openRouterModelId: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
				openRouterModelInfo: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
			},
			{
				openRouterModelId: newModelId,
				openRouterModelInfo: modelInfo,
			},
			currentMode,
		)
	}

	const selectedModelId = modeFields.openRouterModelId || ""
	const selectedModelInfo = modeFields.openRouterModelInfo || { supportsPromptCache: false }

	useMount(() => {
		refreshOpenRouterModels()
		refreshOpenRouterModelRankings()
	})

	// Sync external changes when the modelId changes
	useEffect(() => {
		if (isPendingProviderSelection) return
		setSearchTerm(modeFields.openRouterModelId || "")
	}, [isPendingProviderSelection, modeFields.openRouterModelId])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [])

	const modelIds = useMemo(() => {
		const filteredModelIds = filterOpenRouterModelIds(Object.keys(openRouterModels), "openrouter")
		const filteredModelIdSet = new Set(filteredModelIds)
		const alphabetizedModelIds = filteredModelIds.sort((a, b) => a.localeCompare(b))
		const rankedModelIds = resolveRankedModelIds(openRouterModelRankings, openRouterModels).filter((id) =>
			filteredModelIdSet.has(id),
		)
		const rankedModelIdSet = new Set(rankedModelIds)
		return [...rankedModelIds, ...alphabetizedModelIds.filter((id) => !rankedModelIdSet.has(id))]
	}, [openRouterModelRankings, openRouterModels])

	const searchableItems = useMemo(() => {
		return modelIds.map((id) => ({
			id,
			html: id,
		}))
	}, [modelIds])

	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["html"], // highlight function will update this
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [searchableItems])

	const modelSearchResults = useMemo(() => {
		// IMPORTANT: highlightjs has a bug where if you use sort/localCompare - "// results.sort((a, b) => a.id.localeCompare(b.id)) ...sorting like this causes ids in objects to be reordered and mismatched"

		// First, get all favorited models
		const favoritedModels = searchableItems.filter((item) => favoritedModelIds.includes(item.id))

		// Then get search results for non-favorited models
		const searchResults = searchTerm
			? highlight(fuse.search(searchTerm), "model-item-highlight").filter((item) => !favoritedModelIds.includes(item.id))
			: searchableItems.filter((item) => !favoritedModelIds.includes(item.id))

		// Combine favorited models with search results
		return [...favoritedModels, ...searchResults]
	}, [searchableItems, searchTerm, fuse, favoritedModelIds])

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < modelSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < modelSearchResults.length) {
					void handleModelChange(modelSearchResults[selectedIndex].id)
					setIsDropdownVisible(false)
				} else {
					void handleModelChange(searchTerm)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				event.preventDefault()
				if (isPendingProviderSelection) onCancelProviderSelection?.()
				else setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	const hasInfo = useMemo(() => {
		try {
			return modelIds.some((id) => id.toLowerCase() === searchTerm.toLowerCase())
		} catch {
			return false
		}
	}, [modelIds, searchTerm])

	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	const showReasoningEffort = selectedModelInfo.supportsReasoningEffort === true
	const showBudgetSlider = !showReasoningEffort && !!selectedModelInfo.thinkingConfig

	return (
		<div style={{ width: "100%", paddingBottom: 2 }}>
			<style>
				{`
				.model-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<div style={{ display: "flex", flexDirection: "column" }}>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
					<label htmlFor="model-search">
						<span style={{ fontWeight: 500 }}>Model</span>
					</label>
					{isPendingProviderSelection && (
						<VSCodeButton appearance="secondary" onClick={onCancelProviderSelection} type="button">
							Cancel
						</VSCodeButton>
					)}
				</div>

				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="model-search"
						onBlur={() => {
							if (!isPendingProviderSelection && searchTerm && searchTerm !== selectedModelId) {
								void handleModelChange(searchTerm)
							}
						}}
						onFocus={() => setIsDropdownVisible(true)}
						onInput={(e) => {
							setSearchTerm((e.target as HTMLInputElement)?.value || "")
							setIsDropdownVisible(true)
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search and select a model..."
						role="combobox"
						style={{
							width: "100%",
							zIndex: OPENROUTER_MODEL_PICKER_Z_INDEX,
							position: "relative",
						}}
						value={searchTerm}>
						{searchTerm && (
							<div
								aria-label="Clear search"
								className="input-icon-button codicon codicon-close"
								onClick={() => {
									setSearchTerm("")
									setIsDropdownVisible(true)
								}}
								slot="end"
								style={{
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									height: "100%",
								}}
							/>
						)}
					</VSCodeTextField>
					{isDropdownVisible && (
						<DropdownList ref={dropdownListRef} role="listbox">
							{modelSearchResults.map((item, index) => {
								const isFavorite = (favoritedModelIds || []).includes(item.id)
								return (
									<DropdownItem
										isSelected={index === selectedIndex}
										key={item.id}
										onClick={() => {
											void handleModelChange(item.id)
											setIsDropdownVisible(false)
										}}
										onMouseEnter={() => setSelectedIndex(index)}
										ref={(el) => (itemRefs.current[index] = el)}
										role="option">
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
											<span dangerouslySetInnerHTML={{ __html: item.html }} />
											<StarIcon
												isFavorite={isFavorite}
												onClick={(e) => {
													e.stopPropagation()
													StateServiceClient.toggleFavoriteModel(
														StringRequest.create({ value: item.id }),
													).catch((error) => console.error("Failed to toggle favorite model:", error))
												}}
											/>
										</div>
									</DropdownItem>
								)
							})}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>
			{selectedModelId && <OpenRouterProviderSelector modelId={selectedModelId} />}

			{hasInfo ? (
				<>
					{showBudgetSlider && <ThinkingBudgetSlider currentMode={currentMode} />}
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}

					<ModelInfoView
						advancedContent={selectedModelId ? <OpenRouterRoutingControls /> : undefined}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			) : (
				<p
					style={{
						fontSize: "12px",
						marginTop: 0,
						color: "var(--vscode-descriptionForeground)",
					}}>
					The extension automatically fetches the latest list of models available on{" "}
					<VSCodeLink href="https://openrouter.ai/models" style={{ display: "inline", fontSize: "inherit" }}>
						OpenRouter.
					</VSCodeLink>
					If you're unsure which model to choose, Dirac works best with{" "}
					<VSCodeLink
						onClick={() => void handleModelChange("anthropic/claude-sonnet-4.6")}
						style={{ display: "inline", fontSize: "inherit" }}>
						anthropic/claude-sonnet-4.6.
					</VSCodeLink>
					You can also try searching "free" for no-cost options currently available.
				</p>
			)}
			{!hasInfo && !isPendingProviderSelection && (
				<>
					<AdvancedToggle
						aria-expanded={customModelAdvancedExpanded}
						onClick={() => setCustomModelAdvancedExpanded((expanded) => !expanded)}
						type="button">
						<AdvancedArrow $isExpanded={customModelAdvancedExpanded}>▶</AdvancedArrow>
						Advanced
					</AdvancedToggle>
					<AdvancedContent $isExpanded={customModelAdvancedExpanded}>
						<OpenRouterRoutingControls />
					</AdvancedContent>
				</>
			)}
		</div>
	)
}

export default OpenRouterModelPicker

// Dropdown

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

export const OPENROUTER_MODEL_PICKER_Z_INDEX = 1_000

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${OPENROUTER_MODEL_PICKER_Z_INDEX - 1};
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
`

const DropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 5px 10px;
	cursor: pointer;
	word-break: break-all;
	white-space: normal;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`

const AdvancedToggle = styled.button`
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 12px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--vscode-descriptionForeground);
	cursor: pointer;
	font-family: inherit;
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.5px;
	text-transform: uppercase;

	&:hover {
		color: var(--vscode-foreground);
	}
`

const AdvancedArrow = styled.span<{ $isExpanded: boolean }>`
	font-size: 10px;
	transition: transform 0.15s ease;
	transform: rotate(${({ $isExpanded }) => ($isExpanded ? "90deg" : "0deg")});
`

const AdvancedContent = styled.div<{ $isExpanded: boolean }>`
	max-height: ${({ $isExpanded }) => ($isExpanded ? "600px" : "0")};
	overflow: ${({ $isExpanded }) => ($isExpanded ? "visible" : "hidden")};
	transition: max-height 0.2s ease;
`
