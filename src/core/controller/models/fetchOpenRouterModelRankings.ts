import { EmptyRequest, StringArray } from "@shared/proto/dirac/common"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

const OPENROUTER_RANKINGS_URL = "https://openrouter.ai/api/frontend/v1/rankings/model-rankings-chart"
const OPENROUTER_RANKINGS_TIMEOUT_MS = 2_000
const OTHERS_RANKING_KEY = "Others"
const MAX_POPULAR_MODELS = 10

interface OpenRouterRankingBucket {
	x: string
	ys: Record<string, number>
}

export async function fetchOpenRouterModelRankings(_controller: Controller, _request: EmptyRequest): Promise<StringArray> {
	try {
		const response = await axios.get(OPENROUTER_RANKINGS_URL, {
			timeout: OPENROUTER_RANKINGS_TIMEOUT_MS,
			...getAxiosSettings(),
		})
		const buckets = response.data?.data?.data
		if (!Array.isArray(buckets) || buckets.length === 0) {
			throw new Error("OpenRouter returned no ranking buckets")
		}
		const latestBucket = parseRankingBucket(buckets.at(-1))
		return StringArray.create({ values: getRankedCanonicalSlugs(latestBucket) })
	} catch (error) {
		Logger.verbose("OpenRouter rankings unavailable; displaying the canonical model list without popularity ordering", error)
		return StringArray.create({ values: [] })
	}
}

function parseRankingBucket(value: unknown): OpenRouterRankingBucket {
	if (!value || typeof value !== "object") {
		throw new Error("OpenRouter returned a malformed ranking bucket")
	}
	const bucket = value as Partial<OpenRouterRankingBucket>
	if (typeof bucket.x !== "string" || !bucket.ys || typeof bucket.ys !== "object" || Array.isArray(bucket.ys)) {
		throw new Error("OpenRouter returned a malformed ranking bucket")
	}
	for (const [modelId, usage] of Object.entries(bucket.ys)) {
		if (typeof modelId !== "string" || typeof usage !== "number" || !Number.isFinite(usage) || usage < 0) {
			throw new Error("OpenRouter returned malformed ranking values")
		}
	}
	return bucket as OpenRouterRankingBucket
}

function getRankedCanonicalSlugs(bucket: OpenRouterRankingBucket): string[] {
	return Object.entries(bucket.ys)
		.filter(([modelId]) => modelId !== OTHERS_RANKING_KEY)
		.sort(([, usageA], [, usageB]) => usageB - usageA)
		.slice(0, MAX_POPULAR_MODELS)
		.map(([modelId]) => modelId)
}
