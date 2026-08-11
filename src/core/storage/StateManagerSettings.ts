import type { ApiConfiguration, ModelProviderPreset } from "@shared/api"
import { getSecretsFromEnv, getSettingsFromEnv } from "@shared/storage/env-config"
import {
	normalizeLegacyModelProviderPresets,
	normalizeLegacyOpenRouterPinMap,
	normalizeLegacySynthetic1mModelId,
} from "@shared/storage/legacy-model-id-migration"
import {
	ApiHandlerSettingsKeys,
	type GlobalStateAndSettings,
	isSecretKey,
	isSettingsKey,
	SecretKeys,
	type Secrets,
	type Settings,
} from "@shared/storage/state-keys"

export interface StateManagerSettingsCaches {
	sessionOverrideCache: Partial<Settings>
	taskStateCache: Partial<Settings>
	globalStateCache: GlobalStateAndSettings
	secretsCache: Secrets
}

export function normalizeLoadedSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings[K] {
	if (typeof value === "string" && (key.endsWith("ModelId") || key.endsWith("ModelBaseId"))) {
		return normalizeLegacySynthetic1mModelId(value) as Settings[K]
	}
	if (key === "openRouterPinnedProviders") {
		return normalizeLegacyOpenRouterPinMap(value as Record<string, string[]> | undefined) as Settings[K]
	}
	if (key === "modelProviderPresets") {
		return normalizeLegacyModelProviderPresets(value as ModelProviderPreset[]) as Settings[K]
	}
	return value
}

export function normalizeLoadedSettings(settings: Partial<Settings>): Partial<Settings> {
	const normalized = { ...settings }
	for (const [key, value] of Object.entries(normalized)) {
		;(normalized as Record<string, unknown>)[key] = normalizeLoadedSetting(key as keyof Settings, value as never)
	}
	return normalized
}

export function getSettingWithOverride<K extends keyof Settings>(
	key: K,
	caches: Pick<StateManagerSettingsCaches, "sessionOverrideCache" | "taskStateCache" | "globalStateCache">,
): Settings[K] {
	if (Object.hasOwn(caches.sessionOverrideCache, key)) return caches.sessionOverrideCache[key] as Settings[K]
	const taskValue = caches.taskStateCache[key]
	if (taskValue !== undefined) return taskValue
	return caches.globalStateCache[key]
}

export function getSecret<K extends keyof Secrets>(key: K, secretsCache: Secrets): Secrets[K] {
	return secretsCache[key]
}

export function buildApiConfigurationFromCache(caches: StateManagerSettingsCaches): ApiConfiguration {
	const secrets = Object.fromEntries(
		SecretKeys.map((key) => [key, getSecret(key as keyof Secrets, caches.secretsCache)]),
	) as Secrets

	const envSecrets = getSecretsFromEnv()
	for (const [key, value] of Object.entries(envSecrets)) {
		if (value && !secrets[key as keyof Secrets]) {
			secrets[key as keyof Secrets] = value
		}
	}

	const settings: Partial<Settings> = Object.fromEntries(
		ApiHandlerSettingsKeys.map((key) => [key, getSettingWithOverride(key as keyof Settings, caches)]),
	)

	const envSettings = getSettingsFromEnv()
	for (const [key, value] of Object.entries(envSettings)) {
		if (value && isSettingsKey(key) && settings[key] === undefined && !Object.hasOwn(caches.sessionOverrideCache, key)) {
			;(settings as Record<string, unknown>)[key] = normalizeLoadedSetting(key as keyof Settings, value as never)
		}
	}

	return { ...secrets, ...settings } satisfies ApiConfiguration
}

export { isSecretKey, isSettingsKey }
