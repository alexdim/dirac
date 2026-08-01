import { UpdateSettingsRequest } from "@shared/proto/dirac/state"
import { StateServiceClient } from "@/shared/api/grpc-client"

function createUpdateSettingsRequest(field: keyof UpdateSettingsRequest, value: unknown): UpdateSettingsRequest {
	const updateRequest: Partial<UpdateSettingsRequest> = {}
	updateRequest[field] = value as never
	return UpdateSettingsRequest.create(updateRequest)
}

export const persistSetting = (field: keyof UpdateSettingsRequest, value: unknown) => {
	return StateServiceClient.updateSettings(createUpdateSettingsRequest(field, value))
}

/** Updates a single setting without blocking the caller. */
export const updateSetting = (field: keyof UpdateSettingsRequest, value: unknown): void => {
	void persistSetting(field, value).catch((error) => {
		console.error(`Failed to update setting ${field}:`, error)
	})
}
