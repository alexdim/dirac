import type {
	OpenAiCodexRateLimitBucket,
	OpenAiCodexRateLimitWindow,
	OpenAiCodexUsageSnapshot,
} from "@shared/openai-codex-usage"

export const OPENAI_CODEX_USAGE_STALE_MS = 15 * 60_000
export const OPENAI_CODEX_USAGE_LAZY_REFRESH_MS = 60_000

export interface OpenAiCodexDisplayWindow {
	bucket: OpenAiCodexRateLimitBucket
	kind: "primary" | "secondary"
	window: OpenAiCodexRateLimitWindow
	label: string
}

export function clampOpenAiCodexPercent(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.min(100, Math.max(0, value))
}

export function getOpenAiCodexRemainingPercent(usedPercent: number): number {
	return clampOpenAiCodexPercent(100 - usedPercent)
}

export function formatOpenAiCodexRemaining(usedPercent: number): string {
	const remaining = getOpenAiCodexRemainingPercent(usedPercent)
	if (remaining > 0 && remaining < 1) return "<1% remaining"
	return `${Math.round(remaining)}% remaining`
}

export function formatOpenAiCodexPlan(planType?: string): string | undefined {
	if (!planType) return undefined
	const normalized = planType.trim()
	if (!normalized) return undefined

	const knownLabels: Record<string, string> = {
		guest: "Guest",
		free: "Free",
		go: "Go",
		plus: "Plus",
		pro: "Pro",
		prolite: "Pro Lite",
		free_workspace: "Free workspace",
		team: "Team",
		self_serve_business_prolite: "Business Pro Lite",
		self_serve_business_usage_based: "Business usage based",
		business: "Business",
		ent26: "Enterprise",
		enterprise_cbp_usage_based: "Enterprise usage based",
		education: "Education",
		quorum: "Quorum",
		k12: "K-12",
		enterprise: "Enterprise",
		edu: "Education",
		unknown: "Unknown plan",
	}
	return knownLabels[normalized.toLowerCase()] ?? humanizeOpenAiCodexValue(normalized)
}

export function humanizeOpenAiCodexValue(value: string): string {
	const spaced = value.replace(/[_-]+/g, " ").trim()
	if (!spaced) return value
	return spaced.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function approximately(value: number, target: number): boolean {
	return Math.abs(value - target) <= target * 0.05
}

export function formatOpenAiCodexWindowDuration(
	windowMinutes: number | undefined,
	kind: "primary" | "secondary",
	bucket: OpenAiCodexRateLimitBucket,
): string {
	if (windowMinutes !== undefined) {
		if (approximately(windowMinutes, 300)) return "5-hour"
		if (approximately(windowMinutes, 1_440)) return "Daily"
		if (approximately(windowMinutes, 10_080)) return "Weekly"
		if (approximately(windowMinutes, 43_200)) return "Monthly"
		if (approximately(windowMinutes, 525_600)) return "Annual"
		if (windowMinutes < 60) return `${Math.round(windowMinutes)}-minute`
		if (windowMinutes < 1_440) return `${Math.round(windowMinutes / 60)}-hour`
		return `${Math.round(windowMinutes / 1_440)}-day`
	}

	if (bucket.limitId !== "codex") return bucket.limitName || humanizeOpenAiCodexValue(bucket.limitId)
	return kind === "primary" ? "Usage limit" : "Secondary usage"
}

export function selectOpenAiCodexDisplayWindows(snapshot?: OpenAiCodexUsageSnapshot): OpenAiCodexDisplayWindow[] {
	if (!snapshot) return []
	const buckets = [...snapshot.rateLimits].sort((left, right) => {
		if (left.limitId === "codex" && right.limitId !== "codex") return -1
		if (right.limitId === "codex" && left.limitId !== "codex") return 1
		return (left.limitName || left.limitId).localeCompare(right.limitName || right.limitId)
	})

	return buckets.flatMap((bucket) => {
		const windows: OpenAiCodexDisplayWindow[] = []
		if (bucket.primary) {
			windows.push({
				bucket,
				kind: "primary",
				window: bucket.primary,
				label: formatOpenAiCodexWindowDuration(bucket.primary.windowMinutes, "primary", bucket),
			})
		}
		if (bucket.secondary) {
			windows.push({
				bucket,
				kind: "secondary",
				window: bucket.secondary,
				label: formatOpenAiCodexWindowDuration(bucket.secondary.windowMinutes, "secondary", bucket),
			})
		}
		return windows.sort((left, right) => (left.window.windowMinutes ?? Number.MAX_SAFE_INTEGER) - (right.window.windowMinutes ?? Number.MAX_SAFE_INTEGER))
	})
}

function formatRelativeDuration(milliseconds: number): string {
	const minutes = Math.max(0, Math.ceil(milliseconds / 60_000))
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	const remainingMinutes = minutes % 60
	if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
	const days = Math.floor(hours / 24)
	return `${days}d`
}

export function formatOpenAiCodexReset(resetsAt: number | undefined, now = Date.now()): string {
	if (!resetsAt) return "Reset time unavailable"
	const resetDate = new Date(resetsAt * 1_000)
	if (Number.isNaN(resetDate.getTime())) return "Reset time unavailable"

	const time = resetDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
	const difference = resetDate.getTime() - now
	if (difference <= 0) return `Reset passed at ${time} · refreshing quietly`

	const nowDate = new Date(now)
	const sameDay = resetDate.toDateString() === nowDate.toDateString()
	if (sameDay) return `Resets today at ${time} · in ${formatRelativeDuration(difference)}`

	if (difference < 7 * 24 * 60 * 60_000) {
		const weekday = resetDate.toLocaleDateString(undefined, { weekday: "long" })
		return `Resets ${weekday} at ${time} · in ${formatRelativeDuration(difference)}`
	}

	return `Resets ${resetDate.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: resetDate.getFullYear() !== nowDate.getFullYear() ? "numeric" : undefined,
		hour: "numeric",
		minute: "2-digit",
	})}`
}

export function getOpenAiCodexQuotaFetchedAt(snapshot?: OpenAiCodexUsageSnapshot): number | undefined {
	return snapshot?.quotaFetchedAt
}

export function formatOpenAiCodexActivityDate(startDate: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate)
	if (!match) {
		const parsed = new Date(startDate)
		return Number.isNaN(parsed.getTime())
			? startDate
			: parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" })
	}
	const [, year, month, day] = match
	return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	})
}

export function formatOpenAiCodexFreshness(fetchedAt: number | undefined, now = Date.now()): string {
	if (!fetchedAt) return "Not updated yet"
	const age = Math.max(0, now - fetchedAt)
	let label = "Updated just now"
	if (age >= 60_000) {
		const minutes = Math.floor(age / 60_000)
		label = minutes < 60 ? `Updated ${minutes}m ago` : `Updated ${Math.floor(minutes / 60)}h ago`
	}
	return age > OPENAI_CODEX_USAGE_STALE_MS ? `${label} · May be outdated` : label
}

export function formatOpenAiCodexNumber(value: number | undefined): string {
	return value === undefined ? "Unavailable" : Math.round(value).toLocaleString()
}

export function formatOpenAiCodexDuration(seconds: number | undefined): string {
	if (seconds === undefined) return "Unavailable"
	if (seconds < 60) return `${Math.round(seconds)}s`
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = Math.round(seconds % 60)
	return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}
