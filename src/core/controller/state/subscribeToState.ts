import { EmptyRequest } from "@shared/proto/dirac/common"
import { State } from "@shared/proto/dirac/state"
import { telemetryService } from "@/services/telemetry"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active state subscriptions
const activeStateSubscriptions = new Set<StreamingResponseHandler<State>>()

export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
	requestId?: string,
): Promise<void> {
	activeStateSubscriptions.add(responseStream)

	const cleanup = () => {
		activeStateSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	try {
		await controller.postStateToWebview()
	} catch (error) {
		Logger.error("Error publishing initial state:", error)
		activeStateSubscriptions.delete(responseStream)
	}
}

export async function sendStateUpdate(state: ExtensionState, sequenceNumber: number): Promise<void> {
	let stateJson: string
	try {
		stateJson = JSON.stringify(state)
	} catch (error) {
		Logger.error(`[StatePublication] Failed to serialize sequence=${sequenceNumber}.`, error)
		return
	}

	const sizeBytes = Buffer.byteLength(stateJson, "utf8")
	recordStateSizeTelemetry(sizeBytes)

	const promises = Array.from(activeStateSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				{
					stateJson,
				},
				false,
				sequenceNumber,
			)
		} catch (error) {
			Logger.error(`[StatePublication] Delivery failed sequence=${sequenceNumber}.`, error)
			activeStateSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, "dirac.StateService", "subscribeToState")
}
