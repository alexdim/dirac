import { StringArray } from "@shared/proto/dirac/common"
import { OpenAiModelsRequest } from "@shared/proto/dirac/models"
import type { AxiosRequestConfig } from "axios"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Fetches available models from the OpenAI API
 * @param controller The controller instance
 * @param request Request containing the base URL and API key
 * @returns Array of model names
 */
export async function refreshOpenAiModels(_controller: Controller, request: OpenAiModelsRequest): Promise<StringArray> {
	try {
		if (!request.baseUrl) {
			return StringArray.create({ values: [] })
		}

		if (!URL.canParse(request.baseUrl)) {
			return StringArray.create({ values: [] })
		}

		// Only allow https: to prevent key exfiltration via file://, http://, data:, etc.
		const parsedUrl = new URL(request.baseUrl)
		if (parsedUrl.protocol !== "https:") {
			Logger.warn(`[refreshOpenAiModels] rejected non-https baseUrl: ${parsedUrl.protocol}`)
			return StringArray.create({ values: [] })
		}

		const config: AxiosRequestConfig = {}
		if (request.apiKey) {
			config["headers"] = { Authorization: `Bearer ${request.apiKey}` }
		}

		const baseUrl = request.baseUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "")
		const response = await axios.get(`${baseUrl}/models`, {
			...config,
			...getAxiosSettings(),
		})
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		const models = [...new Set<string>(modelsArray)]

		return StringArray.create({ values: models })
	} catch (error) {
		if (axios.isAxiosError(error) && [404, 405].includes(error.response?.status ?? 0)) {
			Logger.warn("Configured OpenAI-compatible provider does not support model discovery at /models")
		} else {
			Logger.error("Error fetching OpenAI models:", error)
		}
		return StringArray.create({ values: [] })
	}
}
