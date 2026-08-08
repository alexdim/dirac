// Type definitions for FileContextTracker
export interface FileMetadataEntry {
	path: string
	record_state: "active" | "stale"
	record_source: "read_tool" | "user_edited" | "dirac_edited" | "file_mentioned"
	dirac_read_date: number | null
	dirac_edit_date: number | null
	user_edit_date?: number | null
}

export interface ModelMetadataEntry {
	ts: number
	model_id: string
	model_provider_id: string
	mode: string
	// Token/cost metrics present in older persisted records; absent from new writes.
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	totalCost?: number
}

export interface EnvironmentMetadataEntry {
	ts: number
	os_name: string
	os_version: string
	os_arch: string
	host_name: string
	host_version: string
	dirac_version: string
}

export interface TaskMetadata {
	files_in_context: FileMetadataEntry[]
	model_usage: ModelMetadataEntry[]
	environment_history: EnvironmentMetadataEntry[]
	active_skill_ids?: string[]
}
