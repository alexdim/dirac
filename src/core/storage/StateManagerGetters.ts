import type { ApiConfiguration } from "@shared/api"
import type { GlobalState, LocalState, Secrets, Settings } from "@shared/storage/state-keys"
import { STATE_MANAGER_NOT_INITIALIZED } from "./error-messages"
import { buildApiConfigurationFromCache, getSettingWithOverride, type StateManagerSettingsCaches } from "./StateManagerSettings"

export interface StateManagerGetterCaches extends StateManagerSettingsCaches {
	workspaceStateCache: LocalState
}

export function getGlobalSettingsKey<K extends keyof Settings>(
	key: K,
	caches: StateManagerSettingsCaches,
	isInitialized: boolean,
): Settings[K] {
	if (!isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
	return getSettingWithOverride(key, caches)
}

export function getSystemDefaultSettingsKey<K extends keyof Settings>(
	key: K,
	caches: Pick<StateManagerSettingsCaches, "globalStateCache">,
	isInitialized: boolean,
): Settings[K] {
	if (!isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
	return caches.globalStateCache[key]
}

export function getGlobalStateKey<K extends keyof GlobalState>(
	key: K,
	caches: Pick<StateManagerSettingsCaches, "globalStateCache">,
	isInitialized: boolean,
): GlobalState[K] {
	if (!isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
	return caches.globalStateCache[key]
}

export function getSecretKey<K extends keyof Secrets>(
	key: K,
	caches: Pick<StateManagerSettingsCaches, "secretsCache">,
	isInitialized: boolean,
): Secrets[K] {
	if (!isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
	return caches.secretsCache[key]
}

export function getWorkspaceStateKey(
	caches: Pick<StateManagerGetterCaches, "workspaceStateCache">,
	isInitialized: boolean,
	key: string,
): unknown {
	if (!isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
	return (caches.workspaceStateCache as Record<string, unknown>)[key]
}

export function getAllGlobalStateEntries(
	caches: Pick<StateManagerSettingsCaches, "globalStateCache">,
	isInitialized: boolean,
): Record<string, unknown> {
	if (!isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
	return { ...caches.globalStateCache }
}

export function getAllWorkspaceStateEntries(
	caches: Pick<StateManagerGetterCaches, "workspaceStateCache">,
	isInitialized: boolean,
): Record<string, unknown> {
	if (!isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
	return { ...caches.workspaceStateCache }
}

export function getApiConfiguration(caches: StateManagerSettingsCaches, isInitialized: boolean): ApiConfiguration {
	if (!isInitialized) throw new Error(STATE_MANAGER_NOT_INITIALIZED)
	return buildApiConfigurationFromCache(caches)
}
