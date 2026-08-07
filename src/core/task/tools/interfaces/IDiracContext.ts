export interface IDiracContext {
	task: {
		get<T>(key: string): Promise<T | undefined>
		set<T>(key: string, value: T): Promise<void>
		update<T>(key: string, updater: (value: T | undefined) => T): Promise<void>
	}
	workspace: {
		get<T>(key: string): T | undefined
		set<T>(key: string, value: T): void
	}
	global: {
		get<T>(key: string): T | undefined
		set<T>(key: string, value: T): void
	}
	resetTaskContext(): Promise<void>
	load(): Promise<void>
	ensureAnchorState(): Promise<void>
	markAnchorStateDirty(): void
	save(): Promise<void>
}
