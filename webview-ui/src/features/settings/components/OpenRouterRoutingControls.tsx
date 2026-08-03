import type { OpenRouterEndpoint } from "@shared/proto/dirac/models"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { SquareCheckBig, SquareX } from "lucide-react"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import styled from "styled-components"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export function OpenRouterProviderSelector({ modelId }: { modelId: string }) {
	const apiConfiguration = useSettingsStore((state) => state.apiConfiguration)
	const endpointState = useSettingsStore((state) => state.openRouterEndpointStates[modelId]) || {
		status: "loading" as const,
		endpoints: [],
	}
	const fetchOpenRouterEndpoints = useSettingsStore((state) => state.fetchOpenRouterEndpoints)
	const { handleFieldChange } = useApiConfigurationHandlers()
	const pinnedProviders: string[] = apiConfiguration?.openRouterPinnedProviders?.[modelId] || []
	const [searchTerm, setSearchTerm] = useState("")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const dropdownListRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])

	useEffect(() => {
		void fetchOpenRouterEndpoints(modelId)
	}, [fetchOpenRouterEndpoints, modelId])

	useEffect(() => {
		setSearchTerm("")
		setIsDropdownVisible(false)
		setSelectedIndex(-1)
	}, [modelId])

	useEffect(() => {
		const closeOnOutsideClick = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}

		document.addEventListener("mousedown", closeOnOutsideClick)
		return () => document.removeEventListener("mousedown", closeOnOutsideClick)
	}, [])

	const endpointsByTag = useMemo(
		() => new Map(endpointState.endpoints.map((endpoint) => [endpoint.tag, endpoint])),
		[endpointState.endpoints],
	)
	const availableEndpoints = useMemo(
		() =>
			endpointState.endpoints
				.filter((endpoint) => !pinnedProviders.includes(endpoint.tag))
				.sort(compareEndpointsByCachePricing),
		[endpointState.endpoints, pinnedProviders],
	)
	const matchingEndpoints = useMemo(() => {
		const normalizedSearchTerm = searchTerm.trim().toLowerCase()
		return availableEndpoints.filter((endpoint) => {
			if (!normalizedSearchTerm) return true
			return getEndpointSearchText(endpoint).includes(normalizedSearchTerm)
		})
	}, [availableEndpoints, searchTerm])

	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) dropdownListRef.current.scrollTop = 0
	}, [searchTerm, modelId])

	useEffect(() => {
		if (selectedIndex >= matchingEndpoints.length) setSelectedIndex(-1)
	}, [matchingEndpoints.length, selectedIndex])

	useEffect(() => {
		itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" })
	}, [selectedIndex])

	const updatePinnedProviders = (nextTags: string[]) => {
		const nextMap = { ...(apiConfiguration?.openRouterPinnedProviders || {}) }
		if (nextTags.length > 0) nextMap[modelId] = nextTags
		else delete nextMap[modelId]
		void handleFieldChange("openRouterPinnedProviders", Object.keys(nextMap).length > 0 ? nextMap : undefined)
	}

	const addProvider = (tag: string) => {
		if (pinnedProviders.includes(tag)) return
		updatePinnedProviders([...pinnedProviders, tag])
		setSearchTerm("")
		setSelectedIndex(-1)
		setIsDropdownVisible(false)
	}

	const removeProvider = (tag: string) => {
		updatePinnedProviders(pinnedProviders.filter((providerTag) => providerTag !== tag))
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setIsDropdownVisible(true)
				setSelectedIndex((current) => Math.min(current + 1, matchingEndpoints.length - 1))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((current) => Math.max(current - 1, 0))
				break
			case "Enter": {
				const endpoint = matchingEndpoints[selectedIndex] || matchingEndpoints[0]
				if (!endpoint) return
				event.preventDefault()
				addProvider(endpoint.tag)
				break
			}
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	const canSearch = availableEndpoints.length > 0
	const placeholder =
		endpointState.status === "loading" && endpointState.endpoints.length === 0
			? "Loading upstream providers…"
			: endpointState.status === "unavailable" && endpointState.endpoints.length === 0
				? "Upstream providers unavailable"
				: availableEndpoints.length === 0
					? "All available upstreams are selected"
					: "Search upstreams by provider, tag, or detail…"

	return (
		<ProviderSection>
			<ProviderHeader>
				<FieldLabel htmlFor="openrouter-provider-search">Allowed upstream providers</FieldLabel>
				{pinnedProviders.length > 0 && <SelectionCount>{pinnedProviders.length} allowed</SelectionCount>}
			</ProviderHeader>
			<HelpText>
				You can pin providers for this model! Leaving empty will fallback to your 'Sort upstreams' setting under Advanced.
			</HelpText>

			{pinnedProviders.length > 0 && (
				<SelectedProviders>
					{pinnedProviders.map((tag) => {
						const endpoint = endpointsByTag.get(tag)
						return (
							<SelectedProvider key={tag}>
								<SelectedProviderText>
									<SelectedProviderName>{endpoint?.providerName || tag}</SelectedProviderName>
									{endpoint ? (
										<SelectedProviderTag>{tag}</SelectedProviderTag>
									) : endpointState.status !== "loading" ? (
										<UnavailableBadge>Unavailable</UnavailableBadge>
									) : null}
								</SelectedProviderText>
								<RemoveProviderButton
									aria-label={`Remove ${endpoint?.providerName || tag}`}
									onClick={() => removeProvider(tag)}
									type="button">
									<span className="codicon codicon-close" />
								</RemoveProviderButton>
							</SelectedProvider>
						)
					})}
				</SelectedProviders>
			)}

			<DropdownWrapper ref={dropdownRef}>
				<VSCodeTextField
					disabled={!canSearch}
					id="openrouter-provider-search"
					onFocus={() => canSearch && setIsDropdownVisible(true)}
					onInput={(event) => {
						setSearchTerm((event.target as HTMLInputElement).value)
						setIsDropdownVisible(true)
					}}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					role="combobox"
					style={{ width: "100%" }}
					value={searchTerm}>
					<span className="codicon codicon-search" slot="start" />
				</VSCodeTextField>

				{isDropdownVisible && matchingEndpoints.length > 0 && (
					<EndpointList ref={dropdownListRef} role="listbox">
						{matchingEndpoints.map((endpoint, index) => (
							<EndpointOption
								$isSelected={index === selectedIndex}
								key={endpoint.tag}
								onClick={() => addProvider(endpoint.tag)}
								onMouseEnter={() => setSelectedIndex(index)}
								ref={(element) => (itemRefs.current[index] = element)}
								role="option">
								<EndpointName>{endpoint.providerName}</EndpointName>
								<EndpointSep> · </EndpointSep>
								<EndpointMeta>
									{endpoint.quantization && (
										<EndpointQuantization>{endpoint.quantization}</EndpointQuantization>
									)}
									{endpoint.quantization && endpoint.uptimeLast30m !== undefined && (
										<EndpointSep> · </EndpointSep>
									)}
									{endpoint.uptimeLast30m !== undefined && (
										<EndpointUptime>{endpoint.uptimeLast30m.toFixed(1)}% uptime</EndpointUptime>
									)}
									{endpoint.uptimeLast30m !== undefined && <EndpointSep> · </EndpointSep>}
									<EndpointPricing title="Input/output/cache price per million tokens">
										{formatEndpointPricing(endpoint)} 
									</EndpointPricing>
									<EndpointSep> · </EndpointSep>
									<EndpointStatus
										$operational={endpoint.status === 0}
										aria-label={formatEndpointStatus(endpoint.status)}
										role="img"
										title={formatEndpointStatus(endpoint.status)}>
										{endpoint.status === 0 ? (
											<SquareCheckBig aria-hidden="true" />
										) : (
											<SquareX aria-hidden="true" />
										)}
									</EndpointStatus>
								</EndpointMeta>
							</EndpointOption>
						))}
					</EndpointList>
				)}
			</DropdownWrapper>

			{endpointState.status === "loading" && (
				<StatusRow>
					<span className="codicon codicon-loading codicon-modifier-spin" />
					{endpointState.endpoints.length > 0 ? "Refreshing upstream providers…" : "Loading upstream providers…"}
				</StatusRow>
			)}

			{(endpointState.status === "stale" || endpointState.status === "unavailable") && (
				<Notice $warning={endpointState.status === "stale"}>
					<span>
						{endpointState.errorMessage ||
							(endpointState.status === "stale"
								? "Showing cached endpoint metadata"
								: "Endpoint metadata is unavailable")}
					</span>
					<VSCodeButton
						appearance="secondary"
						onClick={() => void fetchOpenRouterEndpoints(modelId, true)}
						type="button">
						Retry
					</VSCodeButton>
				</Notice>
			)}

			{endpointState.status === "fresh" && endpointState.endpoints.length === 0 && (
				<HelpText>OpenRouter did not report any upstream providers for this model.</HelpText>
			)}
		</ProviderSection>
	)
}

export function OpenRouterRoutingControls() {
	const apiConfiguration = useSettingsStore((state) => state.apiConfiguration)
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<RoutingSection>
			<SectionTitle>Routing through OpenRouter</SectionTitle>
			<FieldLabel htmlFor="openrouter-sort">Sort upstreams</FieldLabel>
			<VSCodeDropdown
				id="openrouter-sort"
				onChange={(event: any) => handleFieldChange("openRouterProviderSorting", event.target.value || undefined)}
				style={{ width: "100%" }}
				value={apiConfiguration?.openRouterProviderSorting || ""}>
				<VSCodeOption value="">Default</VSCodeOption>
				<VSCodeOption value="price">Price</VSCodeOption>
				<VSCodeOption value="throughput">Throughput</VSCodeOption>
				<VSCodeOption value="latency">Latency</VSCodeOption>
			</VSCodeDropdown>

			<FallbackRow>
				<VSCodeCheckbox
					checked={apiConfiguration?.openRouterPreventFallbacks || false}
					onChange={(event: any) => handleFieldChange("openRouterPreventFallbacks", event.target.checked || undefined)}>
					Prevent fallbacks
				</VSCodeCheckbox>
				<HelpText>Only try explicitly allowed or prioritized upstreams. This can reduce request recovery.</HelpText>
			</FallbackRow>
		</RoutingSection>
	)
}

function formatEndpointDetails(endpoint: OpenRouterEndpoint): string {
	const details = [endpoint.tag]
	if (endpoint.quantization) details.push(endpoint.quantization)
	details.push(formatEndpointStatus(endpoint.status))
	if (endpoint.uptimeLast30m !== undefined) details.push(`${endpoint.uptimeLast30m.toFixed(1)}% uptime`)
	if (endpoint.latencyLast30m !== undefined) details.push(`${endpoint.latencyLast30m.toFixed(2)}s latency`)
	if (endpoint.throughputLast30m !== undefined) details.push(`${endpoint.throughputLast30m.toFixed(1)} tok/s`)
	details.push(formatEndpointPricing(endpoint))
	return details.join(" · ")
}

function getEndpointSearchText(endpoint: OpenRouterEndpoint): string {
	return `${endpoint.providerName} ${formatEndpointDetails(endpoint)}`.toLowerCase()
}

function compareEndpointsByCachePricing(a: OpenRouterEndpoint, b: OpenRouterEndpoint): number {
	const cachePricingOrder = Number(a.cachePricing) - Number(b.cachePricing)
	if (cachePricingOrder !== 0) return cachePricingOrder
	const providerOrder = a.providerName.localeCompare(b.providerName)
	return providerOrder || a.tag.localeCompare(b.tag)
}

function formatEndpointPricing(endpoint: OpenRouterEndpoint): string {
	return [endpoint.inputPricing, endpoint.outputPricing, endpoint.cachePricing]
		.map((pricingValue) => `$${formatPricingPerMillion(pricingValue)}`)
		.join("/") + " I/O/C"
}

function formatPricingPerMillion(pricingPerToken: string): string {
	return (Number(pricingPerToken) * 1_000_000).toLocaleString("en-US", { maximumSignificantDigits: 4 })
}

function formatEndpointStatus(status: number | undefined): string {
	if (status === 0) return "Operational"
	return status === undefined ? "Status unavailable" : `Status ${status}`
}

const ProviderSection = styled.section`
	margin-top: 12px;
`

const RoutingSection = styled.section`
	margin-top: 12px;
	padding-top: 12px;
	border-top: 1px solid var(--vscode-widget-border);
`

const SectionTitle = styled.div`
	margin-bottom: 10px;
	color: var(--vscode-foreground);
	font-size: 12px;
	font-weight: 600;
`

const FieldLabel = styled.label`
	display: block;
	margin-bottom: 4px;
	color: var(--vscode-foreground);
	font-size: 12px;
	font-weight: 500;
`

const ProviderHeader = styled.div`
	display: flex;
	justify-content: space-between;
`

const SelectionCount = styled.span`
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
`

const HelpText = styled.p`
	margin: 3px 0 7px;
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	line-height: 1.4;
`

const SelectedProviders = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-bottom: 7px;
`

const SelectedProvider = styled.div`
	display: inline-flex;
	align-items: center;
	gap: 5px;
	max-width: 100%;
	padding: 3px 3px 3px 7px;
	border: 1px solid var(--vscode-widget-border);
	border-radius: 4px;
	background: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
`

const SelectedProviderText = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 5px;
	min-width: 0;
`

const SelectedProviderName = styled.span`
	overflow: hidden;
	font-size: 11px;
	font-weight: 500;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const SelectedProviderTag = styled.span`
	overflow: hidden;
	opacity: 0.8;
	font-family: var(--vscode-editor-font-family);
	font-size: 9px;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const RemoveProviderButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	padding: 0;
	border: 0;
	border-radius: 3px;
	background: transparent;
	color: inherit;
	cursor: pointer;

	&:hover {
		background: var(--vscode-toolbar-hoverBackground);
	}
`

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

const EndpointList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	z-index: 999;
	width: calc(100% - 2px);
	max-height: 230px;
	overflow-y: auto;
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	border-bottom-right-radius: 3px;
	border-bottom-left-radius: 3px;
	background-color: var(--vscode-dropdown-background);
`

const EndpointOption = styled.div<{ $isSelected: boolean }>`
	display: flex;
	align-items: center;
	gap: 5px;
	overflow: hidden;
	padding: 7px 8px;
	border-bottom: 1px solid var(--vscode-widget-border);
	background-color: ${({ $isSelected }) => ($isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};
	cursor: pointer;
	white-space: nowrap;

	&:last-child {
		border-bottom: 0;
	}

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`

const EndpointName = styled.span`
	min-width: 0;
	overflow: hidden;
	color: var(--vscode-foreground);
	font-size: 12px;
	font-weight: 500;
	text-overflow: ellipsis;
`

const EndpointMeta = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 0;
	flex-shrink: 0;
	font-family: var(--vscode-editor-font-family);
	font-size: 10px;
`

const EndpointSep = styled.span`
	color: var(--vscode-descriptionForeground);
	opacity: 0.4;
`

const EndpointQuantization = styled.span`
	color: var(--vscode-terminal-ansiBlue);
`

const EndpointUptime = styled.span`
	color: var(--vscode-charts-yellow);
`

const EndpointPricing = styled.span`
	color: var(--vscode-foreground);
`

const EndpointStatus = styled.span<{ $operational: boolean }>`
	display: inline-flex;
	align-items: center;
	color: ${({ $operational }) => ($operational ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)")};

	svg {
		width: 13px;
		height: 13px;
		stroke-width: 2;
	}
`

const UnavailableBadge = styled.span`
	padding: 1px 4px;
	border-radius: 3px;
	background: var(--vscode-descriptionForeground);
	color: var(--vscode-editor-background);
	font-size: 9px;
	text-transform: uppercase;
`

const StatusRow = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 0;
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
`

const Notice = styled.div<{ $warning: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin: 7px 0;
	padding: 7px 8px;
	border: 1px solid
		${({ $warning }) => ($warning ? "var(--vscode-editorWarning-foreground)" : "var(--vscode-editorError-foreground)")};
	border-radius: 4px;
	color: var(--vscode-foreground);
	font-size: 11px;
`

const FallbackRow = styled.div`
	margin-top: 12px;
`
