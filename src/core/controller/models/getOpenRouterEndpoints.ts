import { getOpenRouterEndpoints as getOpenRouterEndpointsFromApi } from "@core/api/openrouter/openrouter-endpoints"
import {
	OpenRouterEndpoint,
	OpenRouterEndpointsRequest,
	OpenRouterEndpointsResponse,
	OpenRouterEndpointsStatus,
} from "@shared/proto/dirac/models"
import type { Controller } from "../index"

export async function getOpenRouterEndpoints(
	_controller: Controller,
	request: OpenRouterEndpointsRequest,
): Promise<OpenRouterEndpointsResponse> {
	const result = await getOpenRouterEndpointsFromApi(request.modelId, { forceRefresh: request.forceRefresh })
	return OpenRouterEndpointsResponse.create({
		modelId: result.modelId,
		endpoints: result.endpoints.map((endpoint) =>
			OpenRouterEndpoint.create({
				tag: endpoint.tag,
				providerName: endpoint.providerName,
				quantization: endpoint.quantization,
				status: endpoint.status,
				uptimeLast30m: endpoint.uptimeLast30m,
				latencyLast30m: endpoint.latencyLast30m,
				throughputLast30m: endpoint.throughputLast30m,
				inputPricing: endpoint.inputPricing,
				outputPricing: endpoint.outputPricing,
				cachePricing: endpoint.cachePricing,
			}),
		),
		status: {
			fresh: OpenRouterEndpointsStatus.OPENROUTER_ENDPOINTS_STATUS_FRESH,
			stale: OpenRouterEndpointsStatus.OPENROUTER_ENDPOINTS_STATUS_STALE,
			unavailable: OpenRouterEndpointsStatus.OPENROUTER_ENDPOINTS_STATUS_UNAVAILABLE,
		}[result.status],
		errorMessage: result.errorMessage,
	})
}
