import type { Meta, StoryObj } from "@storybook/react-vite"
import { OpenAiCodexUsagePanel } from "./OpenAiCodexUsagePanel"

const meta = {
	title: "Settings/OpenAI Codex/Usage Panel",
	component: OpenAiCodexUsagePanel,
	args: {
		isRefreshing: false,
		onRefresh: async () => {},
	},
} satisfies Meta<typeof OpenAiCodexUsagePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Healthy: Story = {
	args: {
		snapshot: {
			planType: "plus",
			quotaFetchedAt: Date.now(),
			rateLimits: [
				{
					limitId: "codex",
					primary: { usedPercent: 32, windowMinutes: 300, resetsAt: Math.floor(Date.now() / 1_000) + 7_200 },
					secondary: { usedPercent: 58, windowMinutes: 10_080, resetsAt: Math.floor(Date.now() / 1_000) + 345_600 },
				},
			],
		},
	},
}

export const ZeroRemainingStillNeutral: Story = {
	args: {
		snapshot: {
			planType: "pro",
			quotaFetchedAt: Date.now() - 20 * 60_000,
			rateLimits: [{ limitId: "codex", primary: { usedPercent: 100, windowMinutes: 300 } }],
		},
	},
}

export const CreditsAndActivity: Story = {
	args: {
		snapshot: {
			planType: "self_serve_business_usage_based",
			quotaFetchedAt: Date.now(),
			activityFetchedAt: Date.now(),
			rateLimits: [{ limitId: "codex", primary: { usedPercent: 12, windowMinutes: 300 } }],
			credits: { hasCredits: true, unlimited: false, balance: "$18.50" },
			spendControl: {
				reached: false,
				individualLimit: {
					limit: "$100",
					used: "$36",
					remaining: "$64",
					usedPercent: 36,
					remainingPercent: 64,
					resetsAt: Math.floor(Date.now() / 1_000) + 86_400,
				},
			},
			activity: {
				lifetimeTokens: 12_345_678,
				peakDailyTokens: 900_000,
				currentStreakDays: 4,
				longestStreakDays: 12,
				dailyUsageBuckets: Array.from({ length: 21 }, (_, index) => ({
					startDate: new Date(Date.now() - (20 - index) * 86_400_000).toISOString(),
					tokens: 20_000 + index * 7_500,
				})),
			},
		},
	},
}
