import { stripOpenRouterPreset } from "@shared/api"
import { normalizeLegacySynthetic1mModelId } from "@shared/storage/legacy-model-id-migration"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"

export interface OpenRouterEndpoint {
	tag: string
	providerName: string
	quantization?: string
	status?: number
	uptimeLast30m?: number
	latencyLast30m?: number
	throughputLast30m?: number
	inputPricing: string
	outputPricing: string
	cachePricing: string
}

export type OpenRouterEndpointsResult =
	| {
			modelId: string
			endpoints: OpenRouterEndpoint[]
			status: "fresh"
			errorMessage?: undefined
	  }
	| {
			modelId: string
			endpoints: OpenRouterEndpoint[]
			status: "stale"
			errorMessage: string
	  }
	| {
			modelId: string
			endpoints: []
			status: "unavailable"
			errorMessage: string
	  }

interface OpenRouterRawEndpoint {
	tag: string
	provider_name: string
	quantization?: string | null
	status?: number | null
	uptime_last_30m?: number | null
	latency_last_30m?: number | null
	throughput_last_30m?: number | null
	pricing?: {
		prompt?: string
		completion?: string
		input_cache_read?: string | null
	}
}

type CachedOpenRouterEndpointsResult = Exclude<OpenRouterEndpointsResult, { status: "unavailable" }>

const endpointCache = new Map<string, CachedOpenRouterEndpointsResult>()
const pendingRequests = new Map<string, Promise<OpenRouterEndpointsResult>>()

export async function getOpenRouterEndpoints(
	modelId: string,
	options: { forceRefresh?: boolean } = {},
): Promise<OpenRouterEndpointsResult> {
	const canonicalModelId = normalizeLegacySynthetic1mModelId(modelId)
	const cached = endpointCache.get(canonicalModelId)
	if (cached && !options.forceRefresh) {
		return cached
	}

	const pending = pendingRequests.get(canonicalModelId)
	if (pending) return pending

	const request = fetchOpenRouterEndpoints(canonicalModelId, cached?.endpoints).finally(() => {
		pendingRequests.delete(canonicalModelId)
	})
	pendingRequests.set(canonicalModelId, request)
	return request
}

async function fetchOpenRouterEndpoints(
	modelId: string,
	cached: OpenRouterEndpoint[] | undefined,
): Promise<OpenRouterEndpointsResult> {
	try {
		const endpointUrl = buildOpenRouterEndpointsUrl(modelId)
		const response = await axios.get(endpointUrl, {
			timeout: 10_000,
			...getAxiosSettings(),
		})
		const rawEndpoints = response.data?.data?.endpoints
		if (!Array.isArray(rawEndpoints)) {
			throw new Error("OpenRouter returned an invalid endpoint list")
		}

		const endpoints = parseOpenRouterEndpoints(rawEndpoints)
		const result = { modelId, endpoints, status: "fresh" as const }
		endpointCache.set(modelId, result)
		return result
	} catch (error) {
		const errorMessage = formatEndpointFetchError(error)
		if (cached) {
			const result = { modelId, endpoints: cached, status: "stale" as const, errorMessage }
			endpointCache.set(modelId, result)
			return result
		}
		return { modelId, endpoints: [], status: "unavailable", errorMessage }
	}
}

function buildOpenRouterEndpointsUrl(modelId: string): string {
	const modelWithoutPreset = stripOpenRouterPreset(modelId)
	const slashIndex = modelWithoutPreset.indexOf("/")
	if (slashIndex <= 0 || slashIndex === modelWithoutPreset.length - 1) {
		throw new Error("Endpoint metadata is unavailable for this custom model or preset")
	}

	const author = modelWithoutPreset.slice(0, slashIndex)
	const slug = modelWithoutPreset.slice(slashIndex + 1)
	return `https://openrouter.ai/api/v1/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`
}

function parseOpenRouterEndpoints(rawEndpoints: unknown[]): OpenRouterEndpoint[] {
	const endpointsByTag = new Map<string, OpenRouterEndpoint>()
	for (const endpoint of rawEndpoints) {
		if (!endpoint || typeof endpoint !== "object") {
			throw new Error("OpenRouter returned malformed endpoint metadata")
		}
		const rawEndpoint = endpoint as Partial<OpenRouterRawEndpoint>
		if (typeof rawEndpoint.tag !== "string" || typeof rawEndpoint.provider_name !== "string") {
			throw new Error("OpenRouter returned endpoint metadata without a tag or provider name")
		}
		const pricing = parseEndpointPricing(rawEndpoint)
		endpointsByTag.set(rawEndpoint.tag, {
			tag: rawEndpoint.tag,
			providerName: rawEndpoint.provider_name,
			quantization: rawEndpoint.quantization ?? undefined,
			status: rawEndpoint.status ?? undefined,
			uptimeLast30m: rawEndpoint.uptime_last_30m ?? undefined,
			latencyLast30m: rawEndpoint.latency_last_30m ?? undefined,
			throughputLast30m: rawEndpoint.throughput_last_30m ?? undefined,
			inputPricing: pricing.inputPricing,
			outputPricing: pricing.outputPricing,
			cachePricing: pricing.cachePricing,
		})
	}
	return [...endpointsByTag.values()]
}

function parseEndpointPricing(rawEndpoint: Partial<OpenRouterRawEndpoint>): {
	inputPricing: string
	outputPricing: string
	cachePricing: string
} {
	const pricing = rawEndpoint.pricing
	if (!pricing || typeof pricing.prompt !== "string" || typeof pricing.completion !== "string") {
		throw new Error("OpenRouter returned endpoint metadata without input or output pricing")
	}
	const inputPricing = parseEndpointPricingValue(pricing.prompt)
	const outputPricing = parseEndpointPricingValue(pricing.completion)
	const cachePricing =
		pricing.input_cache_read === null || pricing.input_cache_read === undefined
			? inputPricing
			: parseEndpointPricingValue(pricing.input_cache_read)
	return { inputPricing, outputPricing, cachePricing }
}

function parseEndpointPricingValue(price: string): string {
	const numericPricing = Number(price)
	if (!Number.isFinite(numericPricing) || numericPricing < 0) {
		throw new Error("OpenRouter returned invalid endpoint pricing")
	}
	return price
}

function formatEndpointFetchError(error: unknown): string {
	if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : String(error)
	if (error.code === "ECONNABORTED") return "OpenRouter endpoint metadata timed out"
	const status = error.response?.status
	if (status === 404) return "Endpoint metadata is unavailable for this custom model or preset"
	return status ? `OpenRouter endpoint metadata request failed (${status})` : "Unable to reach OpenRouter"
}
