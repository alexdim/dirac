import { z } from "zod"

export const OPENAI_CODEX_USAGE_SHORT_FRESHNESS_MS = 60_000
export const OPENAI_CODEX_USAGE_STALE_AFTER_MS = 15 * 60_000

export interface OpenAiCodexRateLimitWindow {
	usedPercent: number
	windowMinutes?: number
	resetsAt?: number
}

export interface OpenAiCodexRateLimitBucket {
	limitId: string
	limitName?: string
	primary?: OpenAiCodexRateLimitWindow
	secondary?: OpenAiCodexRateLimitWindow
}

export interface OpenAiCodexCredits {
	hasCredits: boolean
	unlimited: boolean
	balance?: string
}

export interface OpenAiCodexIndividualSpendLimit {
	source?: string
	limit: string
	used: string
	remaining?: string
	usedPercent: number
	remainingPercent: number
	resetsAt: number
}

export interface OpenAiCodexSpendControl {
	reached: boolean
	individualLimit?: OpenAiCodexIndividualSpendLimit
}

export interface OpenAiCodexDailyActivity {
	startDate: string
	tokens: number
}

export interface OpenAiCodexActivity {
	lifetimeTokens?: number
	peakDailyTokens?: number
	longestRunningTurnSec?: number
	currentStreakDays?: number
	longestStreakDays?: number
	dailyUsageBuckets?: OpenAiCodexDailyActivity[]
}

export interface OpenAiCodexUsageSnapshot {
	planType?: string
	rateLimits: OpenAiCodexRateLimitBucket[]
	credits?: OpenAiCodexCredits
	spendControl?: OpenAiCodexSpendControl
	rateLimitReachedType?: string
	resetCreditsAvailable?: number
	activity?: OpenAiCodexActivity
	quotaFetchedAt?: number
	activityFetchedAt?: number
	quotaError?: string
	activityError?: string
}

export interface OpenAiCodexRollingRateLimitWindow {
	usedPercent?: number
	windowMinutes?: number
	resetsAt?: number
}

export interface OpenAiCodexRollingRateLimitBucket {
	limitId: string
	limitName?: string
	primary?: OpenAiCodexRollingRateLimitWindow
	secondary?: OpenAiCodexRollingRateLimitWindow
}

export interface OpenAiCodexRollingUsageUpdate {
	planType?: string
	rateLimits?: OpenAiCodexRollingRateLimitBucket[]
	credits?: Partial<OpenAiCodexCredits>
	spendControl?: OpenAiCodexSpendControl
	rateLimitReachedType?: string
	resetCreditsAvailable?: number
	quotaFetchedAt?: number
}

export interface OpenAiCodexDisplayWindow {
	bucket: OpenAiCodexRateLimitBucket
	kind: "primary" | "secondary"
	window: OpenAiCodexRateLimitWindow
}

const nullableNumber = z.number().finite().nullable().optional()
const nullableString = z.string().nullable().optional()
const nullableBoolean = z.boolean().nullable().optional()

const backendRateLimitWindowSchema = z.object({
	used_percent: nullableNumber,
	limit_window_seconds: nullableNumber,
	reset_after_seconds: nullableNumber,
	reset_at: nullableNumber,
})

const backendRateLimitSchema = z.object({
	allowed: nullableBoolean,
	limit_reached: nullableBoolean,
	primary_window: backendRateLimitWindowSchema.nullable().optional(),
	secondary_window: backendRateLimitWindowSchema.nullable().optional(),
})

const backendCreditsSchema = z.object({
	has_credits: nullableBoolean,
	unlimited: nullableBoolean,
	balance: nullableString,
	approx_local_messages: z.array(z.unknown()).nullable().optional(),
	approx_cloud_messages: z.array(z.unknown()).nullable().optional(),
})

const backendIndividualSpendLimitSchema = z.object({
	source: nullableString,
	limit: nullableString,
	used: nullableString,
	remaining: nullableString,
	used_percent: nullableNumber,
	remaining_percent: nullableNumber,
	reset_after_seconds: nullableNumber,
	reset_at: nullableNumber,
})

const backendSpendControlSchema = z.object({
	reached: nullableBoolean,
	individual_limit: backendIndividualSpendLimitSchema.nullable().optional(),
})

const backendUsageSchema = z.object({
	plan_type: nullableString,
	rate_limit: backendRateLimitSchema.nullable().optional(),
	credits: backendCreditsSchema.nullable().optional(),
	spend_control: backendSpendControlSchema.nullable().optional(),
	additional_rate_limits: z
		.array(
			z.object({
				limit_name: nullableString,
				metered_feature: nullableString,
				rate_limit: backendRateLimitSchema.nullable().optional(),
			}),
		)
		.nullable()
		.optional(),
	rate_limit_reached_type: z.object({ type: nullableString }).nullable().optional(),
	rate_limit_reset_credits: z.object({ available_count: nullableNumber }).nullable().optional(),
})

const backendDailyActivitySchema = z.object({
	start_date: z.string(),
	tokens: z.number().finite(),
})

const backendActivitySchema = z.object({
	stats: z
		.object({
			lifetime_tokens: nullableNumber,
			peak_daily_tokens: nullableNumber,
			longest_running_turn_sec: nullableNumber,
			current_streak_days: nullableNumber,
			longest_streak_days: nullableNumber,
			daily_usage_buckets: z.array(backendDailyActivitySchema).nullable().optional(),
		})
		.nullable()
		.optional(),
})

const rollingEventWindowSchema = z.object({
	used_percent: nullableNumber,
	window_minutes: nullableNumber,
	reset_at: nullableNumber,
})

const rollingEventSchema = z.object({
	type: z.literal("codex.rate_limits"),
	plan_type: nullableString,
	rate_limits: z
		.object({
			primary: rollingEventWindowSchema.nullable().optional(),
			secondary: rollingEventWindowSchema.nullable().optional(),
		})
		.nullable()
		.optional(),
	credits: backendCreditsSchema.nullable().optional(),
	metered_limit_name: nullableString,
	limit_name: nullableString,
})

function valueOrUndefined<T>(value: T | null | undefined): T | undefined {
	return value === null ? undefined : value
}

function deriveResetAt(resetAt: number | null | undefined, resetAfterSeconds: number | null | undefined, fetchedAt: number) {
	if (resetAt !== null && resetAt !== undefined) return resetAt
	if (resetAfterSeconds === null || resetAfterSeconds === undefined) return undefined
	return Math.floor(fetchedAt / 1000) + resetAfterSeconds
}

function normalizeFullWindow(
	window: z.infer<typeof backendRateLimitWindowSchema> | null | undefined,
	fetchedAt: number,
): OpenAiCodexRateLimitWindow | undefined {
	if (!window || window.used_percent === null || window.used_percent === undefined) return undefined
	return {
		usedPercent: window.used_percent,
		windowMinutes:
			window.limit_window_seconds === null || window.limit_window_seconds === undefined
				? undefined
				: window.limit_window_seconds / 60,
		resetsAt: deriveResetAt(window.reset_at, window.reset_after_seconds, fetchedAt),
	}
}

function normalizeRateLimitBucket(
	limitId: string,
	limitName: string | null | undefined,
	rateLimit: z.infer<typeof backendRateLimitSchema> | null | undefined,
	fetchedAt: number,
): OpenAiCodexRateLimitBucket {
	return {
		limitId,
		limitName: valueOrUndefined(limitName),
		primary: normalizeFullWindow(rateLimit?.primary_window, fetchedAt),
		secondary: normalizeFullWindow(rateLimit?.secondary_window, fetchedAt),
	}
}

/** Converts a full `/wham/usage` response into an authoritative quota snapshot. */
export function normalizeOpenAiCodexUsagePayload(raw: unknown, fetchedAt = Date.now()): OpenAiCodexUsageSnapshot {
	const payload = backendUsageSchema.parse(raw)
	const rateLimits: OpenAiCodexRateLimitBucket[] = []

	if (payload.rate_limit) {
		rateLimits.push(normalizeRateLimitBucket("codex", undefined, payload.rate_limit, fetchedAt))
	}

	for (const [index, additional] of (payload.additional_rate_limits ?? []).entries()) {
		const limitId = additional.metered_feature || additional.limit_name || `additional-${index + 1}`
		rateLimits.push(normalizeRateLimitBucket(limitId, additional.limit_name, additional.rate_limit, fetchedAt))
	}

	const individual = payload.spend_control?.individual_limit
	const individualReset = individual
		? deriveResetAt(individual.reset_at, individual.reset_after_seconds, fetchedAt)
		: undefined
	const hasCompleteIndividualLimit =
		individual?.limit != null &&
		individual.used != null &&
		individual.used_percent != null &&
		individual.remaining_percent != null &&
		individualReset !== undefined

	return {
		planType: valueOrUndefined(payload.plan_type),
		rateLimits,
		credits: payload.credits
			? {
				hasCredits: payload.credits.has_credits === true,
				unlimited: payload.credits.unlimited === true,
				balance: valueOrUndefined(payload.credits.balance),
			}
			: undefined,
		spendControl: payload.spend_control
			? {
				reached: payload.spend_control.reached === true,
				individualLimit: hasCompleteIndividualLimit
					? {
						source: valueOrUndefined(individual!.source),
						limit: individual!.limit!,
						used: individual!.used!,
						remaining: valueOrUndefined(individual!.remaining),
						usedPercent: individual!.used_percent!,
						remainingPercent: individual!.remaining_percent!,
						resetsAt: individualReset!,
					}
					: undefined,
			}
			: undefined,
		rateLimitReachedType: valueOrUndefined(payload.rate_limit_reached_type?.type),
		resetCreditsAvailable: valueOrUndefined(payload.rate_limit_reset_credits?.available_count),
		quotaFetchedAt: fetchedAt,
	}
}

/** Converts `/wham/profiles/me` account history independently from quota. */
export function normalizeOpenAiCodexActivityPayload(
	raw: unknown,
	fetchedAt = Date.now(),
): Pick<OpenAiCodexUsageSnapshot, "activity" | "activityFetchedAt"> {
	const payload = backendActivitySchema.parse(raw)
	const stats = payload.stats
	if (!stats) return { activityFetchedAt: fetchedAt }

	return {
		activity: {
			lifetimeTokens: valueOrUndefined(stats.lifetime_tokens),
			peakDailyTokens: valueOrUndefined(stats.peak_daily_tokens),
			longestRunningTurnSec: valueOrUndefined(stats.longest_running_turn_sec),
			currentStreakDays: valueOrUndefined(stats.current_streak_days),
			longestStreakDays: valueOrUndefined(stats.longest_streak_days),
			dailyUsageBuckets: stats.daily_usage_buckets?.map((bucket) => ({
				startDate: bucket.start_date,
				tokens: bucket.tokens,
			})),
		},
		activityFetchedAt: fetchedAt,
	}
}

type HeaderSource = Headers | Record<string, string | undefined> | Iterable<readonly [string, string]>

function collectHeaders(headers: HeaderSource): Map<string, string> {
	const normalized = new Map<string, string>()
	if (typeof (headers as Headers).forEach === "function") {
		; (headers as Headers).forEach((value, key) => normalized.set(key.toLowerCase(), value))
		return normalized
	}
	if (Symbol.iterator in Object(headers)) {
		for (const [key, value] of headers as Iterable<readonly [string, string]>) normalized.set(key.toLowerCase(), value)
		return normalized
	}
	for (const [key, value] of Object.entries(headers as Record<string, string | undefined>)) {
		if (value !== undefined) normalized.set(key.toLowerCase(), value)
	}
	return normalized
}

function parseFiniteHeaderNumber(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : undefined
}

function parseHeaderBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined
	if (/^(true|1)$/i.test(value)) return true
	if (/^(false|0)$/i.test(value)) return false
	return undefined
}

/** Parses default and dynamically discovered `x-<limit-id>-*` rolling metadata headers. */
export function parseOpenAiCodexRateLimitHeaders(headers: HeaderSource): OpenAiCodexRollingUsageUpdate | undefined {
	const values = collectHeaders(headers)
	const bucketParts = new Map<string, OpenAiCodexRollingRateLimitBucket>()
	const getBucket = (limitId: string) => {
		const existing = bucketParts.get(limitId)
		if (existing) return existing
		const created: OpenAiCodexRollingRateLimitBucket = { limitId }
		bucketParts.set(limitId, created)
		return created
	}

	for (const [name, value] of values) {
		const windowMatch = /^x-(.+)-(primary|secondary)-(used-percent|window-minutes|reset-at)$/.exec(name)
		if (windowMatch) {
			const [, limitId, kind, field] = windowMatch
			const numeric = parseFiniteHeaderNumber(value)
			if (numeric === undefined) continue
			const bucket = getBucket(limitId)
			const window = bucket[kind as "primary" | "secondary"] ?? {}
			if (field === "used-percent") window.usedPercent = numeric
			if (field === "window-minutes") window.windowMinutes = numeric
			if (field === "reset-at") window.resetsAt = numeric
			bucket[kind as "primary" | "secondary"] = window
			continue
		}
		const nameMatch = /^x-(.+)-limit-name$/.exec(name)
		if (nameMatch) getBucket(nameMatch[1]).limitName = value
	}

	const credits: Partial<OpenAiCodexCredits> = {}
	const hasCredits = parseHeaderBoolean(values.get("x-codex-credits-has-credits"))
	const unlimited = parseHeaderBoolean(values.get("x-codex-credits-unlimited"))
	const balance = values.get("x-codex-credits-balance")
	if (hasCredits !== undefined) credits.hasCredits = hasCredits
	if (unlimited !== undefined) credits.unlimited = unlimited
	if (balance !== undefined) credits.balance = balance

	const update: OpenAiCodexRollingUsageUpdate = {
		...(bucketParts.size > 0 ? { rateLimits: [...bucketParts.values()] } : {}),
		...(Object.keys(credits).length > 0 ? { credits } : {}),
		...(values.has("x-codex-rate-limit-reached-type")
			? { rateLimitReachedType: values.get("x-codex-rate-limit-reached-type") }
			: {}),
	}
	return Object.keys(update).length > 0 ? update : undefined
}

function normalizeRollingEventWindow(
	window: z.infer<typeof rollingEventWindowSchema> | null | undefined,
): OpenAiCodexRollingRateLimitWindow | undefined {
	if (!window) return undefined
	const normalized: OpenAiCodexRollingRateLimitWindow = {}
	if (window.used_percent != null) normalized.usedPercent = window.used_percent
	if (window.window_minutes != null) normalized.windowMinutes = window.window_minutes
	if (window.reset_at != null) normalized.resetsAt = window.reset_at
	return Object.keys(normalized).length > 0 ? normalized : undefined
}

/** Parses a sparse `codex.rate_limits` SSE/WebSocket event without surfacing promo metadata. */
export function parseOpenAiCodexRateLimitEvent(event: unknown): OpenAiCodexRollingUsageUpdate | undefined {
	const parsed = rollingEventSchema.safeParse(event)
	if (!parsed.success) return undefined
	const payload = parsed.data
	const limitId = payload.metered_limit_name || "codex"
	const primary = normalizeRollingEventWindow(payload.rate_limits?.primary)
	const secondary = normalizeRollingEventWindow(payload.rate_limits?.secondary)
	const credits = payload.credits
		? {
			...(payload.credits.has_credits != null ? { hasCredits: payload.credits.has_credits } : {}),
			...(payload.credits.unlimited != null ? { unlimited: payload.credits.unlimited } : {}),
			...(payload.credits.balance != null ? { balance: payload.credits.balance } : {}),
		}
		: undefined

	const update: OpenAiCodexRollingUsageUpdate = {
		...(payload.plan_type != null ? { planType: payload.plan_type } : {}),
		...(primary || secondary || payload.limit_name
			? {
				rateLimits: [
					{
						limitId,
						...(payload.limit_name != null ? { limitName: payload.limit_name } : {}),
						...(primary ? { primary } : {}),
						...(secondary ? { secondary } : {}),
					},
				],
			}
			: {}),
		...(credits && Object.keys(credits).length > 0 ? { credits } : {}),
	}
	return Object.keys(update).length > 0 ? update : undefined
}

function mergeRollingWindow(
	previous: OpenAiCodexRateLimitWindow | undefined,
	update: OpenAiCodexRollingRateLimitWindow | undefined,
): OpenAiCodexRateLimitWindow | undefined {
	if (!update) return previous
	const usedPercent = update.usedPercent ?? previous?.usedPercent
	if (usedPercent === undefined) return previous
	return {
		usedPercent,
		windowMinutes: update.windowMinutes ?? previous?.windowMinutes,
		resetsAt: update.resetsAt ?? previous?.resetsAt,
	}
}

/** Sparse rolling updates preserve every full-snapshot field they do not explicitly contain. */
export function mergeOpenAiCodexRollingUsage(
	previous: OpenAiCodexUsageSnapshot | undefined,
	update: OpenAiCodexRollingUsageUpdate,
): OpenAiCodexUsageSnapshot {
	const previousSnapshot = previous ?? { rateLimits: [] }
	const byId = new Map(previousSnapshot.rateLimits.map((bucket) => [bucket.limitId, { ...bucket }]))

	for (const rollingBucket of update.rateLimits ?? []) {
		const priorBucket = byId.get(rollingBucket.limitId)
		byId.set(rollingBucket.limitId, {
			limitId: rollingBucket.limitId,
			limitName: rollingBucket.limitName ?? priorBucket?.limitName,
			primary: mergeRollingWindow(priorBucket?.primary, rollingBucket.primary),
			secondary: mergeRollingWindow(priorBucket?.secondary, rollingBucket.secondary),
		})
	}

	const credits = update.credits
		? {
			hasCredits: update.credits.hasCredits ?? previousSnapshot.credits?.hasCredits ?? false,
			unlimited: update.credits.unlimited ?? previousSnapshot.credits?.unlimited ?? false,
			balance: update.credits.balance ?? previousSnapshot.credits?.balance,
		}
		: previousSnapshot.credits

	return {
		...previousSnapshot,
		planType: update.planType ?? previousSnapshot.planType,
		rateLimits: [...byId.values()],
		credits,
		spendControl: update.spendControl ?? previousSnapshot.spendControl,
		rateLimitReachedType: update.rateLimitReachedType ?? previousSnapshot.rateLimitReachedType,
		resetCreditsAvailable: update.resetCreditsAvailable ?? previousSnapshot.resetCreditsAvailable,
		quotaFetchedAt: update.quotaFetchedAt ?? previousSnapshot.quotaFetchedAt,
	}
}

/** Returns main Codex windows first, then named additional limits, with each bucket ordered by duration. */
export function selectOpenAiCodexDisplayWindows(snapshot: OpenAiCodexUsageSnapshot | undefined): OpenAiCodexDisplayWindow[] {
	if (!snapshot) return []
	const buckets = [...snapshot.rateLimits].sort((left, right) => {
		if (left.limitId === "codex" && right.limitId !== "codex") return -1
		if (right.limitId === "codex" && left.limitId !== "codex") return 1
		return (left.limitName || left.limitId).localeCompare(right.limitName || right.limitId)
	})

	return buckets.flatMap((bucket) => {
		const windows: OpenAiCodexDisplayWindow[] = []
		if (bucket.primary) windows.push({ bucket, kind: "primary", window: bucket.primary })
		if (bucket.secondary) windows.push({ bucket, kind: "secondary", window: bucket.secondary })
		return windows.sort((left, right) => {
			const leftDuration = left.window.windowMinutes
			const rightDuration = right.window.windowMinutes
			if (leftDuration !== undefined && rightDuration !== undefined) return leftDuration - rightDuration
			if (leftDuration !== undefined) return -1
			if (rightDuration !== undefined) return 1
			return left.kind === "primary" ? -1 : 1
		})
	})
}
