export enum ApiConfigurationErrorCode {
	ProviderMissing = "provider_missing",
	ProviderUnsupported = "provider_unsupported",
	ProviderDisabled = "provider_disabled",
	ModelUnavailable = "model_unavailable",
	ProfileMissing = "profile_missing",
	ProviderConfigurationIncomplete = "provider_configuration_incomplete",
	SessionRuntimeMissing = "session_runtime_missing",
	SessionRuntimeMalformed = "session_runtime_malformed",
	SessionRuntimeVersionUnsupported = "session_runtime_version_unsupported",
	MetadataUnavailable = "metadata_unavailable",
}

export class ApiConfigurationError extends Error {
	constructor(
		public readonly code: ApiConfigurationErrorCode,
		message: string,
		public readonly recovery?: string,
		options?: ErrorOptions,
	) {
		super(message, options)
		this.name = "ApiConfigurationError"
	}

	toDisplayMessage(): string {
		return this.recovery ? `${this.message} ${this.recovery}` : this.message
	}
}
