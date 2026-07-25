import { OpenRouterEndpoint } from "@shared/proto/dirac/models"
import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
} from "@vscode/webview-ui-toolkit/react"
import { useEffect, useMemo } from "react"
import styled from "styled-components"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export function OpenRouterRoutingControls({ modelId }: { modelId: string }) {
	const apiConfiguration = useSettingsStore((state) => state.apiConfiguration)
	const endpointState = useSettingsStore((state) => state.openRouterEndpointStates[modelId]) || {
		status: "loading" as const,
		endpoints: [],
	}
	const fetchOpenRouterEndpoints = useSettingsStore((state) => state.fetchOpenRouterEndpoints)
	const { handleFieldChange } = useApiConfigurationHandlers()
	const pinnedProviders: string[] = apiConfiguration?.openRouterPinnedProviders?.[modelId] || []

	useEffect(() => {
		void fetchOpenRouterEndpoints(modelId)
	}, [fetchOpenRouterEndpoints, modelId])

	const displayedEndpoints = useMemo(() => {
		const byTag = new Map(endpointState.endpoints.map((endpoint) => [endpoint.tag, endpoint]))
		for (const tag of pinnedProviders) {
			if (!byTag.has(tag)) byTag.set(tag, OpenRouterEndpoint.create({ tag, providerName: "Unavailable upstream" }))
		}
		return [...byTag.values()]
	}, [endpointState.endpoints, pinnedProviders])

	const toggleProvider = (tag: string, selected: boolean) => {
		const nextTags = selected
			? [...new Set([...pinnedProviders, tag])]
			: pinnedProviders.filter((providerTag) => providerTag !== tag)
		const nextMap = { ...(apiConfiguration?.openRouterPinnedProviders || {}) }
		if (nextTags.length > 0) nextMap[modelId] = nextTags
		else delete nextMap[modelId]
		handleFieldChange("openRouterPinnedProviders", Object.keys(nextMap).length > 0 ? nextMap : undefined)
	}

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

			<ProviderHeader>
				<FieldLabel>Allowed upstream providers</FieldLabel>
				{pinnedProviders.length > 0 && <SelectionCount>{pinnedProviders.length} allowed</SelectionCount>}
			</ProviderHeader>
			<HelpText>Leave every provider unchecked to let OpenRouter choose without an upstream filter.</HelpText>

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

			{endpointState.status === "unavailable" && pinnedProviders.length > 0 && (
				<HelpText>Saved providers are shown read-only until endpoint metadata is available.</HelpText>
			)}
			{endpointState.status === "fresh" && displayedEndpoints.length === 0 && (
				<HelpText>OpenRouter did not report any upstream providers for this model.</HelpText>
			)}

			{displayedEndpoints.length > 0 && (
				<EndpointList>
					{displayedEndpoints.map((endpoint) => {
						const unavailable = !endpointState.endpoints.some((current) => current.tag === endpoint.tag)
						return (
							<EndpointRow key={endpoint.tag}>
								<VSCodeCheckbox
									checked={pinnedProviders.includes(endpoint.tag)}
									disabled={endpointState.status === "unavailable"}
									onChange={(event: any) => toggleProvider(endpoint.tag, event.target.checked)}>
									<EndpointName>
										{endpoint.providerName}
										{unavailable && <UnavailableBadge>Unavailable</UnavailableBadge>}
									</EndpointName>
									<EndpointMeta>
										{endpoint.tag}
										{endpoint.quantization ? ` · ${endpoint.quantization}` : ""}
										{endpoint.status !== undefined
											? endpoint.status === 0
												? " · operational"
												: ` · status ${endpoint.status}`
											: ""}
										{endpoint.uptimeLast30m !== undefined
											? ` · ${endpoint.uptimeLast30m.toFixed(1)}% uptime`
											: ""}
										{endpoint.latencyLast30m !== undefined
											? ` · ${endpoint.latencyLast30m.toFixed(2)}s latency`
											: ""}
										{endpoint.throughputLast30m !== undefined
											? ` · ${endpoint.throughputLast30m.toFixed(1)} tok/s`
											: ""}
									</EndpointMeta>
								</VSCodeCheckbox>
							</EndpointRow>
						)
					})}
				</EndpointList>
			)}

			<FallbackRow>
				<VSCodeCheckbox
					checked={apiConfiguration?.openRouterPreventFallbacks || false}
					onChange={(event: any) =>
						handleFieldChange("openRouterPreventFallbacks", event.target.checked || undefined)
					}>
					Prevent fallbacks
				</VSCodeCheckbox>
				<HelpText>
					Only try explicitly allowed or prioritized upstreams. This can reduce request recovery.
				</HelpText>
			</FallbackRow>
		</RoutingSection>
	)
}

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
	margin-top: 12px;
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

const StatusRow = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 0;
	color: var(--vscode-descriptionForeground);
`

const Notice = styled.div<{ $warning: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin: 7px 0;
	padding: 7px 8px;
	border: 1px solid
		${({ $warning }) =>
			$warning ? "var(--vscode-editorWarning-foreground)" : "var(--vscode-editorError-foreground)"};
	border-radius: 4px;
	color: var(--vscode-foreground);
`

const EndpointList = styled.div`
	max-height: 230px;
	overflow-y: auto;
	border: 1px solid var(--vscode-widget-border);
	border-radius: 4px;
`

const EndpointRow = styled.div`
	padding: 7px 8px;
	border-bottom: 1px solid var(--vscode-widget-border);

	&:last-child {
		border-bottom: 0;
	}
`

const EndpointName = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--vscode-foreground);
	font-size: 12px;
`

const EndpointMeta = styled.span`
	display: block;
	margin-top: 2px;
	color: var(--vscode-descriptionForeground);
	font-family: var(--vscode-editor-font-family);
	font-size: 10px;
`

const UnavailableBadge = styled.span`
	padding: 1px 4px;
	border-radius: 3px;
	background: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
	font-size: 9px;
	text-transform: uppercase;
`

const FallbackRow = styled.div`
	margin-top: 12px;
`
