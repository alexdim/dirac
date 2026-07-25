import { getOpenRouterEndpoints, type OpenRouterEndpoint } from "@/core/api/openrouter/openrouter-endpoints"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { COLORS } from "../../../constants/colors"
import { useStdinContext } from "../../../context/StdinContext"
import { useScrollableList } from "../../../hooks/useScrollableList"
import { fuzzyFilter } from "../../../utils/fuzzy-search"
import { isMouseEscapeSequence } from "../../../utils/input"

interface OpenRouterRoutingPageProps {
	isActive: boolean
	modelId: string
	savedProviders: string[]
	onSave: (providers: string[]) => void
	onCancel: () => void
}

interface EndpointListState {
	status: "loading" | "fresh" | "stale" | "unavailable"
	endpoints: OpenRouterEndpoint[]
	errorMessage?: string
}

const MAX_VISIBLE_ENDPOINTS = 6

export const OpenRouterRoutingPage: React.FC<OpenRouterRoutingPageProps> = ({
	isActive,
	modelId,
	savedProviders,
	onSave,
	onCancel,
}) => {
	const { isRawModeSupported } = useStdinContext()
	const [selectedProviders, setSelectedProviders] = useState(() => new Set(savedProviders))
	const [search, setSearch] = useState("")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [endpointState, setEndpointState] = useState<EndpointListState>({ status: "loading", endpoints: [] })
	const requestRevision = useRef(0)

	const loadEndpoints = useCallback(
		async (forceRefresh: boolean) => {
			const revision = ++requestRevision.current
			setEndpointState((current) => ({ status: "loading", endpoints: current.endpoints }))
			try {
				const result = await getOpenRouterEndpoints(modelId, { forceRefresh })
				if (revision !== requestRevision.current) return
				setEndpointState({
					status: result.status,
					endpoints: result.endpoints,
					errorMessage: result.errorMessage,
				})
			} catch (error) {
				if (revision !== requestRevision.current) return
				setEndpointState({
					status: "unavailable",
					endpoints: [],
					errorMessage: error instanceof Error ? error.message : "Endpoint metadata is unavailable",
				})
			}
		},
		[modelId],
	)

	useEffect(() => {
		void loadEndpoints(false)
		return () => {
			requestRevision.current++
		}
	}, [loadEndpoints])

	const displayedEndpoints = useMemo(() => {
		const endpointsByTag = new Map(endpointState.endpoints.map((endpoint) => [endpoint.tag, endpoint]))
		for (const tag of selectedProviders) {
			if (!endpointsByTag.has(tag)) {
				endpointsByTag.set(tag, { tag, providerName: "Unavailable upstream" })
			}
		}
		return [...endpointsByTag.values()]
	}, [endpointState.endpoints, selectedProviders])

	const filteredEndpoints = useMemo(
		() => fuzzyFilter(displayedEndpoints, search, (endpoint) => `${endpoint.providerName} ${endpoint.tag}`),
		[displayedEndpoints, search],
	)

	useEffect(() => {
		setSelectedIndex(0)
	}, [search])

	useEffect(() => {
		setSelectedIndex((current) => Math.min(current, Math.max(0, filteredEndpoints.length - 1)))
	}, [filteredEndpoints.length])

	const { visibleStart, visibleCount, showTopIndicator, showBottomIndicator } = useScrollableList(
		filteredEndpoints.length,
		selectedIndex,
		MAX_VISIBLE_ENDPOINTS,
	)
	const visibleEndpoints = filteredEndpoints.slice(visibleStart, visibleStart + visibleCount)
	const endpointEditingDisabled = endpointState.status === "unavailable"

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return
			if (key.escape) {
				onCancel()
				return
			}
			if (key.return) {
				onSave([...selectedProviders])
				return
			}
			if (key.ctrl && input === "r") {
				void loadEndpoints(true)
				return
			}
			if (key.upArrow) {
				setSelectedIndex((current) => Math.max(0, current - 1))
				return
			}
			if (key.downArrow) {
				setSelectedIndex((current) => Math.min(filteredEndpoints.length - 1, current + 1))
				return
			}
			if (input === " ") {
				const endpoint = filteredEndpoints[selectedIndex]
				if (!endpoint || endpointEditingDisabled) return
				setSelectedProviders((current) => {
					const next = new Set(current)
					if (next.has(endpoint.tag)) next.delete(endpoint.tag)
					else next.add(endpoint.tag)
					return next
				})
				return
			}
			if (key.backspace || key.delete) {
				setSearch((current) => current.slice(0, -1))
				return
			}
			if (input && !key.ctrl && !key.meta) {
				setSearch((current) => current + input)
			}
		},
		{ isActive: isRawModeSupported && isActive },
	)

	return (
		<Box flexDirection="column">
			<Text bold>Allowed upstream providers</Text>
			<Text color="gray">{modelId}</Text>
			<Text> </Text>
			<Box>
				<Text color="gray">Search: </Text>
				<Text>{search}</Text>
				<Text inverse> </Text>
			</Box>
			<Text> </Text>

			{endpointState.status === "loading" && (
				<Text color="gray">
					<Spinner type="dots" />{" "}
					{endpointState.endpoints.length > 0 ? "Refreshing upstream providers…" : "Loading upstream providers…"}
				</Text>
			)}
			{endpointState.status === "stale" && (
				<Text color="yellow">
					{endpointState.errorMessage || "Showing cached endpoint metadata"} · Ctrl+R to retry
				</Text>
			)}
			{endpointState.status === "unavailable" && (
				<Box flexDirection="column">
					<Text color="red">{endpointState.errorMessage || "Endpoint metadata is unavailable"}</Text>
					<Text color="gray">Saved pins are read-only · Ctrl+R to retry</Text>
				</Box>
			)}

			{showTopIndicator && <Text color="gray">… {visibleStart} more above</Text>}
			{visibleEndpoints.map((endpoint, visibleIndex) => {
				const index = visibleStart + visibleIndex
				const isFocused = index === selectedIndex
				const isUnavailable = !endpointState.endpoints.some((current) => current.tag === endpoint.tag)
				return (
					<Box flexDirection="column" key={endpoint.tag}>
						<Text color={isFocused ? COLORS.primaryBlue : undefined}>
							{isFocused ? "❯ " : "  "}
							{selectedProviders.has(endpoint.tag) ? "[x]" : "[ ]"} {endpoint.providerName}
							{isUnavailable ? " (unavailable)" : ""}
						</Text>
						<Text color="gray">    {formatEndpointMetadata(endpoint)}</Text>
					</Box>
				)
			})}
			{showBottomIndicator && (
				<Text color="gray">… {filteredEndpoints.length - visibleStart - visibleCount} more below</Text>
			)}
			{endpointState.status !== "loading" && filteredEndpoints.length === 0 && (
				<Text color="gray">{search ? `No matches for "${search}"` : "No upstream providers available"}</Text>
			)}

			<Text> </Text>
			<Text color="gray">
				{endpointEditingDisabled
					? "Providers read-only · Enter save · Escape cancel"
					: "Space toggle · Enter save · Escape cancel"}
				{selectedProviders.size > 0 ? ` · ${selectedProviders.size} allowed` : " · unrestricted"}
			</Text>
		</Box>
	)
}

function formatEndpointMetadata(endpoint: OpenRouterEndpoint): string {
	const details = [endpoint.tag]
	if (endpoint.quantization) details.push(endpoint.quantization)
	if (endpoint.status !== undefined) details.push(endpoint.status === 0 ? "operational" : `status ${endpoint.status}`)
	if (endpoint.uptimeLast30m !== undefined) details.push(`${endpoint.uptimeLast30m.toFixed(1)}% uptime`)
	if (endpoint.latencyLast30m !== undefined) details.push(`${endpoint.latencyLast30m.toFixed(2)}s latency`)
	if (endpoint.throughputLast30m !== undefined) details.push(`${endpoint.throughputLast30m.toFixed(1)} tok/s`)
	return details.join(" · ")
}
