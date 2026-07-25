import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import type { ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { DiracEnv } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { featureFlagsService } from "@/services/feature-flags"
import { getAxiosSettings } from "@/shared/net"
import { removeLegacySynthetic1mModelEntries } from "@/shared/storage/legacy-model-id-migration"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import { refreshOpenRouterModels } from "./refreshOpenRouterModels"

type DiracSupportedParams =
	| "frequency_penalty"
	| "include_reasoning"
	| "logit_bias"
	| "logprobs"
	| "max_tokens"
	| "min_p"
	| "presence_penalty"
	| "reasoning"
	| "repetition_penalty"
	| "response_format"
	| "seed"
	| "stop"
	| "temperature"
	| "tool_choice"
	| "tools"
	| "top_k"
	| "top_logprobs"
	| "top_p"
	| "structured_outputs"
	| "parallel_tool_calls"

/**
 * The raw model information returned by the Dirac API to list models
 */
interface DiracRawModelInfo {
	id: string
	name: string
	description: string | null
	context_length: number | null
	top_provider: {
		max_completion_tokens: number | null
		context_length: number | null
		is_moderated: boolean | null
	} | null
	architecture: {
		modality: string | string[]
		input_modalities?: string[]
		output_modalities?: string[]
		tokenizer?: string
		instruct_type?: string
	} | null
	pricing: {
		prompt: string
		completion: string
		request?: string
		image?: string
		audio?: string
		internal_reasoning?: string
		input_cache_read?: string
		input_cache_write?: string
	} | null
	supports_global_endpoint?: boolean | null
	tiers?: any[] | null
	supported_parameters?: DiracSupportedParams[] | null
}

// Track pending refresh promise to prevent duplicate concurrent fetches
let pendingRefresh: Promise<Record<string, ModelInfo>> | null = null

async function fetchRawDiracModels(): Promise<DiracRawModelInfo[]> {
	const apiBaseUrl = DiracEnv.config().apiBaseUrl
	const response = await axios.get(`${apiBaseUrl}/api/v1/ai/dirac/models`, getAxiosSettings())

	if (!Array.isArray(response.data?.data)) {
		throw new Error("Invalid response data when fetching Dirac models")
	}

	Logger.log("Dirac models source: Dirac API")
	return response.data.data as DiracRawModelInfo[]
}

/**
 * Core function: Refreshes the Dirac models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshDiracModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const shouldUseDiracEndpointSource = featureFlagsService.getBooleanFlagEnabled(FeatureFlag.EXTENSION_DIRAC_MODELS_ENDPOINT)
	if (!shouldUseDiracEndpointSource) {
		return refreshOpenRouterModels(controller)
	}

	// Check in-memory cache first
	const cache = StateManager.get().getModelsCache("dirac")
	if (cache) {
		return cache
	}

	// If a fetch is already in progress, return the same promise
	if (pendingRefresh) {
		return pendingRefresh
	}

	// Start new fetch and track the promise
	pendingRefresh = (async () => {
		try {
			return await fetchAndCacheDiracModels()
		} finally {
			// Clear pending promise when done (success or error)
			pendingRefresh = null
		}
	})()

	return pendingRefresh
}

async function fetchAndCacheDiracModels(): Promise<Record<string, ModelInfo>> {
	const diracModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.diracModels)

	let models: Record<string, ModelInfo> = {}
	try {
		const rawModels = await fetchRawDiracModels()
		const parsePrice = (price: any) => {
			if (price === undefined || price === null || price === "") {
				return undefined
			}

			const parsedPrice = Number.parseFloat(String(price))
			if (Number.isNaN(parsedPrice)) throw new Error(`Dirac returned invalid pricing: ${price}`)
			return parsedPrice * 1_000_000
		}
		for (const rawModel of rawModels) {
			const supportedParameters = new Set(rawModel.supported_parameters || [])
			const supportsReasoning = supportedParameters.has("include_reasoning") || supportedParameters.has("reasoning")

			// Handle modality which can be a string or array
			const modality = rawModel.architecture?.modality
			const supportsImages = Array.isArray(modality)
				? modality.includes("image")
				: typeof modality === "string" && modality.includes("image")

			const cacheWritesPrice = parsePrice(rawModel.pricing?.input_cache_write)
			const cacheReadsPrice = parsePrice(rawModel.pricing?.input_cache_read)
			models[rawModel.id] = {
				name: rawModel.name,
				maxTokens: rawModel.top_provider?.max_completion_tokens ?? undefined,
				contextWindow: rawModel.context_length ?? undefined,
				supportsImages,
				supportsPromptCache: cacheWritesPrice !== undefined || cacheReadsPrice !== undefined,
				supportsReasoning,
				supportsReasoningEffort: supportedParameters.has("reasoning"),
				supportsTools: supportedParameters.has("tools"),
				supportsStrictTools: supportedParameters.has("structured_outputs"),
				inputPrice: parsePrice(rawModel.pricing?.prompt),
				outputPrice: parsePrice(rawModel.pricing?.completion),
				cacheWritesPrice,
				cacheReadsPrice,
				description: rawModel.description ?? undefined,
				thinkingConfig: supportsReasoning ? {} : undefined,
				supportsGlobalEndpoint: rawModel.supports_global_endpoint ?? undefined,
				tiers: rawModel.tiers ?? undefined,
			}
		}
		if (Object.keys(models).length === 0) {
			throw new Error("No Dirac models returned from API")
		}
		// Save models and cache them in memory
		await fs.writeFile(diracModelsFilePath, JSON.stringify(models))
		Logger.log("Dirac models fetched and saved")
	} catch (error) {
		Logger.error("Error fetching Dirac models:", error)

		// If we failed to fetch models, try to read cached models from disk
		try {
			const fileExists = await fileExistsAtPath(diracModelsFilePath)
			if (fileExists) {
				const fileContents = await fs.readFile(diracModelsFilePath, "utf8")
				models = removeLegacySynthetic1mModelEntries(JSON.parse(fileContents))
				Logger.log("Loaded Dirac models from cache")
			}
		} catch (cacheError) {
			Logger.error("Error reading Dirac models from cache:", cacheError)
		}
	}

	// Avoid poisoning in-memory cache with an empty model map after transient failures.
	if (Object.keys(models).length > 0) {
		StateManager.get().setModelsCache("dirac", models)
	}

	return models
}

/**
 * Read cached Dirac models from disk
 * @returns The cached models or undefined if not found
 */
export async function readDiracModelsFromCache(): Promise<Record<string, ModelInfo> | undefined> {
	try {
		const diracModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.diracModels)
		const fileExists = await fileExistsAtPath(diracModelsFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(diracModelsFilePath, "utf8")
			return removeLegacySynthetic1mModelEntries(JSON.parse(fileContents))
		}
	} catch (error) {
		Logger.error("Error reading Dirac models from cache:", error)
	}
	return undefined
}
