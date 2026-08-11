import type { ModelInfo } from "@shared/api"

export interface ModelCacheEntry {
	data: Record<string, ModelInfo>
	timestamp: number
}

export type ModelCache = Record<string, ModelCacheEntry | null>

// Cache TTL: 1 hour - long enough to prevent duplicate fetches, short enough to see new models
export const MODEL_CACHE_TTL_MS = 60 * 60 * 1000

export function setModelsCache(
	cache: ModelCache,
	provider: string,
	models: Record<string, ModelInfo>,
	timestamp = Date.now(),
): void {
	const cacheKey = `${provider}Models`
	cache[cacheKey] = { data: models, timestamp }
}

export function getModelsCache(cache: ModelCache, provider: string): Record<string, ModelInfo> | null {
	const cacheKey = `${provider}Models`
	const cached = cache[cacheKey]
	if (!cached) return null
	if (Date.now() - cached.timestamp > MODEL_CACHE_TTL_MS) {
		cache[cacheKey] = null
		return null
	}
	return cached.data
}

export function getModelInfo(cache: ModelCache, provider: string, modelId: string): ModelInfo | undefined {
	const models = getModelsCache(cache, provider)
	if (!models) return undefined
	return models[modelId]
}
