import { PanelTab } from "../Panel"
import { SettingsTab } from "./types"

export const TABS: PanelTab[] = [
	{ key: SettingsTab.API, label: "API" },
	{ key: SettingsTab.AUTO_APPROVE, label: "Auto-approve" },
	{ key: SettingsTab.FEATURES, label: "Features" },
	{ key: SettingsTab.TOOLS, label: "Tools" },
	{ key: SettingsTab.OTHER, label: "Other" },
]

// Settings configuration for simple boolean toggles
export const FEATURE_SETTINGS = {
	yolo: {
		stateKey: "yoloModeToggled",
		default: false,
		label: "Yolo Mode",
		description:
			"Execute tasks without user's confirmation. Auto-switches from Plan to Act mode and disables the ask question tool. Use with extreme caution.",
	},
	subagents: {
		stateKey: "subagentsEnabled",
		default: false,
		label: "Subagents",
		description: "Let Dirac run focused subagents in parallel to explore the codebase for you",
	},
	autoCondense: {
		stateKey: "useAutoCondense",
		default: false,
		label: "Auto-condense",
		description: "Automatically summarize long conversations",
	},
	webTools: {
		stateKey: "diracWebToolsEnabled",
		default: true,
		label: "Web tools",
		description: "Enable web search and fetch tools",
	},
	strictPlanMode: {
		stateKey: "strictPlanModeEnabled",
		default: true,
		label: "Strict plan mode",
		description: "Require explicit mode switching",
	},
	parallelToolCalling: {
		stateKey: "enableParallelToolCalling",
		default: false,
		label: "Parallel tool calling",
		description: "Allow multiple tools in a single response",
	},
	persistOpenAiReasoning: {
		stateKey: "enableOpenAiPersistedReasoning",
		default: false,
		label: "Preserve OpenAI reasoning",
		description:
			"Reuse OpenAI-stored reasoning across Responses API calls for supported native models. Data retention follows your OpenAI organization policy.",
	},
	doubleCheckCompletion: {
		stateKey: "doubleCheckCompletionEnabled",
		default: false,
		label: "Double-check completion",
		description: "Reject first completion attempt and require re-verification",
	},
} as const

export type FeatureKey = keyof typeof FEATURE_SETTINGS
