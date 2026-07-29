import {
	mergeOpenAiCodexRollingUsage,
	normalizeOpenAiCodexActivityPayload,
	normalizeOpenAiCodexUsagePayload,
	parseOpenAiCodexRateLimitEvent,
	parseOpenAiCodexRateLimitHeaders,
	type OpenAiCodexRollingUsageUpdate,
	type OpenAiCodexUsageSnapshot,
} from "@shared/openai-codex-usage"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { fetch } from "@/shared/net"
import { openAiCodexOAuthManager } from "./oauth"

const OPENAI_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const OPENAI_CODEX_ACTIVITY_URL = "https://chatgpt.com/backend-api/wham/profiles/me"
const DEFAULT_REFRESH_CACHE_MS = 60_000

interface OpenAiCodexUsageOAuthManager {
	getAccessToken(): Promise<string | null>
	forceRefreshAccessToken(): Promise<string | null>
	getAccountId(): Promise<string | null>
}

export interface OpenAiCodexUsageServiceDependencies {
	fetch: typeof globalThis.fetch
	oauthManager: OpenAiCodexUsageOAuthManager
	now: () => number
	refreshCacheMs: number
}

type UsageListener = (snapshot: OpenAiCodexUsageSnapshot | undefined) => void

type SettledResponse = PromiseSettledResult<Response>

/**
 * In-memory, read-only cache for ChatGPT subscription quota and account activity.
 * The two endpoints are deliberately independent so one unavailable section does
 * not discard the other section's last-known-good values.
 */
export class OpenAiCodexUsageService {
	private snapshot: OpenAiCodexUsageSnapshot | undefined
	private refreshPromise: Promise<OpenAiCodexUsageSnapshot> | undefined
	private lastRefreshAttemptAt = 0
	private generation = 0
	private readonly listeners = new Set<UsageListener>()
	private readonly dependencies: OpenAiCodexUsageServiceDependencies

	constructor(dependencies: Partial<OpenAiCodexUsageServiceDependencies> = {}) {
		this.dependencies = {
			fetch: dependencies.fetch ?? fetch,
			oauthManager: dependencies.oauthManager ?? openAiCodexOAuthManager,
			now: dependencies.now ?? Date.now,
			refreshCacheMs: dependencies.refreshCacheMs ?? DEFAULT_REFRESH_CACHE_MS,
		}
	}

	getSnapshot(): OpenAiCodexUsageSnapshot | undefined {
		return this.snapshot
	}

	refresh(options: { force?: boolean } = {}): Promise<OpenAiCodexUsageSnapshot> {
		if (this.refreshPromise) {
			return this.refreshPromise
		}

		const now = this.dependencies.now()
		if (
			!options.force &&
			this.snapshot &&
			this.lastRefreshAttemptAt > 0 &&
			now - this.lastRefreshAttemptAt < this.dependencies.refreshCacheMs
		) {
			return Promise.resolve(this.snapshot)
		}

		this.lastRefreshAttemptAt = now
		const refreshGeneration = this.generation
		const refreshPromise = this.performRefresh(refreshGeneration).finally(() => {
			if (this.refreshPromise === refreshPromise) {
				this.refreshPromise = undefined
			}
		})
		this.refreshPromise = refreshPromise
		return refreshPromise
	}

	applyRollingUpdate(update: OpenAiCodexRollingUsageUpdate): void {
		const previous = this.snapshot ?? { rateLimits: [] }
		this.snapshot = {
			...mergeOpenAiCodexRollingUsage(previous, update),
			quotaFetchedAt: this.dependencies.now(),
			quotaError: undefined,
		}
		this.notifyListeners()
	}

	applyResponseHeaders(headers: Headers): void {
		const update = parseOpenAiCodexRateLimitHeaders(headers)
		if (update) {
			this.applyRollingUpdate(update)
		}
	}

	applyRateLimitEvent(event: unknown): void {
		const update = parseOpenAiCodexRateLimitEvent(event)
		if (update) {
			this.applyRollingUpdate(update)
		}
	}

	clear(): void {
		this.generation += 1
		this.snapshot = undefined
		this.lastRefreshAttemptAt = 0
		this.refreshPromise = undefined
		this.notifyListeners()
	}

	subscribe(listener: UsageListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	private async performRefresh(refreshGeneration: number): Promise<OpenAiCodexUsageSnapshot> {
		const accessToken = await this.dependencies.oauthManager.getAccessToken()
		if (!accessToken) {
			throw new Error("ChatGPT subscription usage is available after signing in with ChatGPT.")
		}

		const accountId = await this.dependencies.oauthManager.getAccountId()
		const [quotaResponse, activityResponse] = await this.fetchSectionsWithAuthRetry(accessToken, accountId)
		const fetchedAt = this.dependencies.now()
		const [quotaResult, activityResult] = await Promise.allSettled([
			this.normalizeQuotaResponse(quotaResponse, fetchedAt),
			this.normalizeActivityResponse(activityResponse, fetchedAt),
		])

		const previous = this.snapshot
		let next: OpenAiCodexUsageSnapshot = previous ? { ...previous } : { rateLimits: [] }

		if (quotaResult.status === "fulfilled") {
			const quota = quotaResult.value
			next = {
				planType: quota.planType,
				rateLimits: quota.rateLimits,
				credits: quota.credits,
				spendControl: quota.spendControl,
				rateLimitReachedType: quota.rateLimitReachedType,
				resetCreditsAvailable: quota.resetCreditsAvailable,
				quotaFetchedAt: quota.quotaFetchedAt,
				activity: next.activity,
				activityFetchedAt: next.activityFetchedAt,
				activityError: next.activityError,
			}
		} else {
			next.quotaError = this.describeFailure(quotaResult.reason, "ChatGPT subscription quota is unavailable")
		}

		if (activityResult.status === "fulfilled") {
			const activity = activityResult.value
			next.activity = activity.activity
			next.activityFetchedAt = activity.activityFetchedAt
			next.activityError = undefined
		} else {
			next.activityError = this.describeFailure(activityResult.reason, "ChatGPT account activity is unavailable")
		}

		if (refreshGeneration !== this.generation) {
			return this.snapshot ?? { rateLimits: [] }
		}

		this.snapshot = next
		this.notifyListeners()
		return next
	}

	private async fetchSectionsWithAuthRetry(
		accessToken: string,
		accountId: string | null,
	): Promise<[SettledResponse, SettledResponse]> {
		const urls = [OPENAI_CODEX_USAGE_URL, OPENAI_CODEX_ACTIVITY_URL] as const
		const initialResults = await Promise.allSettled(urls.map((url) => this.fetchSection(url, accessToken, accountId)))
		const unauthorizedIndexes = initialResults.flatMap((result, index) =>
			result.status === "fulfilled" && result.value.status === 401 ? [index] : [],
		)

		if (unauthorizedIndexes.length === 0) {
			return initialResults as [SettledResponse, SettledResponse]
		}

		const refreshedToken = await this.dependencies.oauthManager.forceRefreshAccessToken()
		if (!refreshedToken) {
			return initialResults as [SettledResponse, SettledResponse]
		}

		const retriedResults = await Promise.allSettled(
			unauthorizedIndexes.map((index) => this.fetchSection(urls[index], refreshedToken, accountId)),
		)
		const results = [...initialResults]
		unauthorizedIndexes.forEach((originalIndex, retryIndex) => {
			results[originalIndex] = retriedResults[retryIndex]
		})
		return results as [SettledResponse, SettledResponse]
	}

	private fetchSection(url: string, accessToken: string, accountId: string | null): Promise<Response> {
		const headers: Record<string, string> = {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
			originator: "dirac",
			...buildExternalBasicHeaders(),
			...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
		}
		return this.dependencies.fetch(url, { method: "GET", headers })
	}

	private async normalizeQuotaResponse(
		result: SettledResponse,
		fetchedAt: number,
	): Promise<OpenAiCodexUsageSnapshot> {
		const response = this.unwrapResponse(result)
		const payload = await response.json()
		return normalizeOpenAiCodexUsagePayload(payload, fetchedAt)
	}

	private async normalizeActivityResponse(
		result: SettledResponse,
		fetchedAt: number,
	): Promise<Pick<OpenAiCodexUsageSnapshot, "activity" | "activityFetchedAt">> {
		const response = this.unwrapResponse(result)
		const payload = await response.json()
		return normalizeOpenAiCodexActivityPayload(payload, fetchedAt)
	}

	private unwrapResponse(result: SettledResponse): Response {
		if (result.status === "rejected") {
			throw result.reason
		}
		if (!result.value.ok) {
			const statusText = result.value.statusText ? ` ${result.value.statusText}` : ""
			throw new Error(`ChatGPT usage request failed with HTTP ${result.value.status}${statusText}`)
		}
		return result.value
	}

	private describeFailure(error: unknown, fallback: string): string {
		if (error instanceof Error && error.message) {
			return error.message
		}
		return fallback
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			listener(this.snapshot)
		}
	}
}

export const openAiCodexUsageService = new OpenAiCodexUsageService()
