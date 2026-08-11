import type { ApiConfiguration, ModelProviderPreset } from "@shared/api"
import { buildLegacySynthetic1mStateUpdates } from "@shared/storage/legacy-model-id-migration"
import {
	type GlobalStateAndSettings,
	type GlobalStateAndSettingsKey,
	isSecretKey,
	isSettingsKey,
	type LocalState,
	type LocalStateKey,
	type SecretKey,
	type Secrets,
	type Settings,
	type SettingsKey,
} from "@shared/storage/state-keys"
import { STATE_MANAGER_NOT_INITIALIZED } from "./error-messages"
import { normalizeLoadedSetting, normalizeLoadedSettings } from "./StateManagerSettings"
import type { StatePersistenceManager } from "./StatePersistenceManager"

export interface StateManagerSettersContext {
	isInitialized: boolean
	globalStateCache: GlobalStateAndSettings
	taskStateCache: Partial<Settings>
	sessionOverrideCache: Partial<Settings>
	secretsCache: Secrets
	workspaceStateCache: LocalState
	persistence: StatePersistenceManager
	notifyStateChange: () => void
}

function guardInitialized(ctx: StateManagerSettersContext): void {
	if (!ctx.isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
}

export function setGlobalState<K extends keyof GlobalStateAndSettings>(
	ctx: StateManagerSettersContext,
	key: K,
	value: GlobalStateAndSettings[K],
): void {
	guardInitialized(ctx)
	const normalizedValue = isSettingsKey(key) ? normalizeLoadedSetting(key as SettingsKey, value as never) : value
	;(ctx.globalStateCache as Record<string, unknown>)[key] = normalizedValue
	ctx.persistence.addPendingGlobalState(key)
	ctx.notifyStateChange()
}

export function setGlobalStateBatch(ctx: StateManagerSettersContext, updates: Partial<GlobalStateAndSettings>): void {
	guardInitialized(ctx)
	const normalizedUpdates = { ...updates, ...buildLegacySynthetic1mStateUpdates(updates) }
	Object.assign(ctx.globalStateCache, normalizedUpdates)
	ctx.persistence.addPendingGlobalStateBatch(Object.keys(normalizedUpdates) as GlobalStateAndSettingsKey[])
	ctx.notifyStateChange()
}

export function setTaskSettings<K extends keyof Settings>(
	ctx: StateManagerSettersContext,
	taskId: string,
	key: K,
	value: Settings[K],
): void {
	guardInitialized(ctx)
	ctx.taskStateCache[key] = normalizeLoadedSetting(key, value)
	ctx.persistence.addPendingTaskState(taskId, key)
}

export function setTaskSettingsBatch(ctx: StateManagerSettersContext, taskId: string, updates: Partial<Settings>): void {
	guardInitialized(ctx)
	const normalizedUpdates = normalizeLoadedSettings(updates)
	Object.assign(ctx.taskStateCache, normalizedUpdates)
	ctx.persistence.addPendingTaskStateBatch(taskId, Object.keys(normalizedUpdates) as SettingsKey[])
}

export async function loadTaskSettings(ctx: StateManagerSettersContext, taskId: string): Promise<void> {
	guardInitialized(ctx)
	const taskSettings = (await ctx.persistence.loadTaskSettingsFromDisk(taskId)) as Partial<Settings>
	const normalizedTaskSettings = normalizeLoadedSettings(taskSettings)
	Object.assign(ctx.taskStateCache, normalizedTaskSettings)
	if (JSON.stringify(normalizedTaskSettings) !== JSON.stringify(taskSettings)) {
		ctx.persistence.addPendingTaskStateBatch(taskId, Object.keys(normalizedTaskSettings) as SettingsKey[])
	}
}

export async function clearTaskSettings(ctx: StateManagerSettersContext): Promise<void> {
	if (ctx.persistence.hasPendingTaskState()) {
		await ctx.persistence.persistAndClearPendingTaskState()
	}
	for (const key of Object.keys(ctx.taskStateCache)) {
		delete ctx.taskStateCache[key as keyof Settings]
	}
	ctx.persistence.clearPendingTaskState()
}

export function setSecret<K extends keyof Secrets>(ctx: StateManagerSettersContext, key: K, value: Secrets[K]): void {
	guardInitialized(ctx)
	ctx.secretsCache[key] = value
	ctx.persistence.addPendingSecret(key)
}

export function setSecretsBatch(ctx: StateManagerSettersContext, updates: Partial<Secrets>): void {
	guardInitialized(ctx)
	const changedKeys: SecretKey[] = []
	Object.entries(updates).forEach(([key, value]) => {
		const current = ctx.secretsCache[key as keyof Secrets]
		if (current === value) return
		ctx.secretsCache[key as keyof Secrets] = value
		changedKeys.push(key as SecretKey)
	})
	ctx.persistence.addPendingSecretBatch(changedKeys)
}

export function setWorkspaceState(ctx: StateManagerSettersContext, key: string, value: unknown): void {
	guardInitialized(ctx)
	;(ctx.workspaceStateCache as Record<string, unknown>)[key] = value
	ctx.persistence.addPendingWorkspaceState(key as LocalStateKey)
}

export function setWorkspaceStateBatch(ctx: StateManagerSettersContext, updates: Partial<LocalState>): void {
	guardInitialized(ctx)
	const changedKeys: LocalStateKey[] = []
	Object.entries(updates).forEach(([key, value]) => {
		ctx.workspaceStateCache[key as keyof LocalState] = value
		changedKeys.push(key as LocalStateKey)
	})
	ctx.persistence.addPendingWorkspaceStateBatch(changedKeys)
}

export function setSessionOverride<K extends keyof Settings>(ctx: StateManagerSettersContext, key: K, value: Settings[K]): void {
	guardInitialized(ctx)
	ctx.sessionOverrideCache[key] = normalizeLoadedSetting(key, value)
}

export function setSessionOverrideCache(ctx: StateManagerSettersContext, overrides: Partial<Settings>): void {
	for (const key of Object.keys(ctx.sessionOverrideCache)) {
		delete ctx.sessionOverrideCache[key as keyof Settings]
	}
	Object.assign(ctx.sessionOverrideCache, normalizeLoadedSettings(overrides))
}

export function refreshModelProviderPresetsFromDisk(ctx: StateManagerSettersContext): void {
	guardInitialized(ctx)

	const cachedPresets = ctx.globalStateCache.modelProviderPresets
	const diskPresets = ctx.persistence.readGlobalStateKeyFromDisk("modelProviderPresets") as ModelProviderPreset[] | undefined
	const presetsById = new Map<string, ModelProviderPreset>()

	for (const preset of [...cachedPresets, ...(diskPresets || [])]) {
		const existing = presetsById.get(preset.id)
		if (!existing || preset.lastUsedAt > existing.lastUsedAt) presetsById.set(preset.id, preset)
	}

	const mergedPresets = [...presetsById.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 20)
	if (JSON.stringify(mergedPresets) === JSON.stringify(cachedPresets)) return
	setGlobalState(ctx, "modelProviderPresets", mergedPresets)
}

export function setApiConfiguration(ctx: StateManagerSettersContext, apiConfiguration: ApiConfiguration): void {
	guardInitialized(ctx)

	const { settingsUpdates, secretsUpdates } = Object.entries(apiConfiguration).reduce(
		(acc, [key, value]) => {
			if (key === undefined) return acc
			if (isSecretKey(key)) {
				;(acc.secretsUpdates as Record<string, string | undefined>)[key] = value as string | undefined
			} else if (isSettingsKey(key)) {
				;(acc.settingsUpdates as Record<string, unknown>)[key] = value
			}
			return acc
		},
		{ settingsUpdates: {} as Partial<Settings>, secretsUpdates: {} as Partial<Secrets> },
	)

	if (Object.keys(settingsUpdates).length > 0) setGlobalStateBatch(ctx, settingsUpdates)
	if (Object.keys(secretsUpdates).length > 0) setSecretsBatch(ctx, secretsUpdates)
}
