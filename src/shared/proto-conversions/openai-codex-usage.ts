import type {
	OpenAiCodexRateLimitWindow,
	OpenAiCodexUsageSnapshot,
} from "@shared/openai-codex-usage"
import {
	OpenAiCodexActivity,
	OpenAiCodexCredits,
	OpenAiCodexDailyActivity,
	OpenAiCodexIndividualSpendLimit,
	OpenAiCodexSpendControl,
	OpenAiCodexUsage,
	OpenAiCodexUsageBucket,
	OpenAiCodexUsageWindow,
} from "@shared/proto/dirac/models"

function toProtobufWindow(window: OpenAiCodexRateLimitWindow | undefined): OpenAiCodexUsageWindow | undefined {
	if (!window) return undefined
	return OpenAiCodexUsageWindow.create({
		usedPercent: window.usedPercent,
		windowMinutes: window.windowMinutes,
		resetsAt: window.resetsAt,
	})
}

export function toProtobufOpenAiCodexUsage(snapshot: OpenAiCodexUsageSnapshot): OpenAiCodexUsage {
	return OpenAiCodexUsage.create({
		planType: snapshot.planType,
		rateLimits: snapshot.rateLimits.map((bucket) =>
			OpenAiCodexUsageBucket.create({
				limitId: bucket.limitId,
				limitName: bucket.limitName,
				primary: toProtobufWindow(bucket.primary),
				secondary: toProtobufWindow(bucket.secondary),
			}),
		),
		credits: snapshot.credits
			? OpenAiCodexCredits.create({
					hasCredits: snapshot.credits.hasCredits,
					unlimited: snapshot.credits.unlimited,
					balance: snapshot.credits.balance,
				})
			: undefined,
		spendControl: snapshot.spendControl
			? OpenAiCodexSpendControl.create({
					reached: snapshot.spendControl.reached,
					individualLimit: snapshot.spendControl.individualLimit
						? OpenAiCodexIndividualSpendLimit.create({
								source: snapshot.spendControl.individualLimit.source,
								limit: snapshot.spendControl.individualLimit.limit,
								used: snapshot.spendControl.individualLimit.used,
								remaining: snapshot.spendControl.individualLimit.remaining,
								usedPercent: snapshot.spendControl.individualLimit.usedPercent,
								remainingPercent: snapshot.spendControl.individualLimit.remainingPercent,
								resetsAt: snapshot.spendControl.individualLimit.resetsAt,
							})
						: undefined,
				})
			: undefined,
		rateLimitReachedType: snapshot.rateLimitReachedType,
		resetCreditsAvailable: snapshot.resetCreditsAvailable,
		activity: snapshot.activity
			? OpenAiCodexActivity.create({
					lifetimeTokens: snapshot.activity.lifetimeTokens,
					peakDailyTokens: snapshot.activity.peakDailyTokens,
					longestRunningTurnSec: snapshot.activity.longestRunningTurnSec,
					currentStreakDays: snapshot.activity.currentStreakDays,
					longestStreakDays: snapshot.activity.longestStreakDays,
					dailyUsageBuckets: (snapshot.activity.dailyUsageBuckets ?? []).map((bucket) =>
						OpenAiCodexDailyActivity.create({ startDate: bucket.startDate, tokens: bucket.tokens }),
					),
				})
			: undefined,
		quotaFetchedAt: snapshot.quotaFetchedAt,
		activityFetchedAt: snapshot.activityFetchedAt,
		quotaError: snapshot.quotaError,
		activityError: snapshot.activityError,
	})
}

function fromProtobufWindow(window: OpenAiCodexUsageWindow | undefined): OpenAiCodexRateLimitWindow | undefined {
	if (!window) return undefined
	return {
		usedPercent: window.usedPercent,
		windowMinutes: window.windowMinutes,
		resetsAt: window.resetsAt,
	}
}

export function fromProtobufOpenAiCodexUsage(message: OpenAiCodexUsage): OpenAiCodexUsageSnapshot {
	return {
		planType: message.planType,
		rateLimits: message.rateLimits.map((bucket) => ({
			limitId: bucket.limitId,
			limitName: bucket.limitName,
			primary: fromProtobufWindow(bucket.primary),
			secondary: fromProtobufWindow(bucket.secondary),
		})),
		credits: message.credits
			? {
					hasCredits: message.credits.hasCredits,
					unlimited: message.credits.unlimited,
					balance: message.credits.balance,
				}
			: undefined,
		spendControl: message.spendControl
			? {
					reached: message.spendControl.reached,
					individualLimit: message.spendControl.individualLimit
						? {
								source: message.spendControl.individualLimit.source,
								limit: message.spendControl.individualLimit.limit,
								used: message.spendControl.individualLimit.used,
								remaining: message.spendControl.individualLimit.remaining,
								usedPercent: message.spendControl.individualLimit.usedPercent,
								remainingPercent: message.spendControl.individualLimit.remainingPercent,
								resetsAt: message.spendControl.individualLimit.resetsAt,
							}
						: undefined,
				}
			: undefined,
		rateLimitReachedType: message.rateLimitReachedType,
		resetCreditsAvailable: message.resetCreditsAvailable,
		activity: message.activity
			? {
					lifetimeTokens: message.activity.lifetimeTokens,
					peakDailyTokens: message.activity.peakDailyTokens,
					longestRunningTurnSec: message.activity.longestRunningTurnSec,
					currentStreakDays: message.activity.currentStreakDays,
					longestStreakDays: message.activity.longestStreakDays,
					dailyUsageBuckets: message.activity.dailyUsageBuckets.map((bucket) => ({
						startDate: bucket.startDate,
						tokens: bucket.tokens,
					})),
				}
			: undefined,
		quotaFetchedAt: message.quotaFetchedAt,
		activityFetchedAt: message.activityFetchedAt,
		quotaError: message.quotaError,
		activityError: message.activityError,
	}
}
