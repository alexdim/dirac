import type { ModelInfo } from "@shared/api"
import {
	basetenDefaultModelId,
	basetenModels,
	groqDefaultModelId,
	groqModels,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "@shared/api"
import type { OnboardingModelGroup } from "@shared/proto/dirac/state"
import { create } from "zustand"

interface ModelsState {
	onboardingModels?: OnboardingModelGroup
	openRouterModels: Record<string, ModelInfo>
	vercelAiGatewayModels: Record<string, ModelInfo>
	liteLlmModels: Record<string, ModelInfo>
	openAiModels: string[]
	requestyModels: Record<string, ModelInfo>
	groqModels: Record<string, ModelInfo>
	basetenModels: Record<string, ModelInfo>
	huggingFaceModels: Record<string, ModelInfo>

	// Actions
	setOnboardingModels: (models?: OnboardingModelGroup) => void
	setOpenRouterModels: (models: Record<string, ModelInfo>) => void
	setVercelAiGatewayModels: (models: Record<string, ModelInfo>) => void
	setLiteLlmModels: (models: Record<string, ModelInfo>) => void
	setOpenAiModels: (models: string[]) => void
	setRequestyModels: (models: Record<string, ModelInfo>) => void
	setGroqModels: (models: Record<string, ModelInfo>) => void
	setBasetenModels: (models: Record<string, ModelInfo>) => void
	setHuggingFaceModels: (models: Record<string, ModelInfo>) => void
}

export const useModelsStore = create<ModelsState>((set) => ({
	onboardingModels: undefined,
	openRouterModels: {},
	vercelAiGatewayModels: {},
	liteLlmModels: {},
	openAiModels: [],
	requestyModels: {
		[requestyDefaultModelId]: requestyDefaultModelInfo,
	},
	groqModels: {
		[groqDefaultModelId]: groqModels[groqDefaultModelId],
	},
	basetenModels: {
		...basetenModels,
		[basetenDefaultModelId]: basetenModels[basetenDefaultModelId],
	},
	huggingFaceModels: {},

	setOnboardingModels: (models) => set({ onboardingModels: models }),
	setOpenRouterModels: (models) => set({ openRouterModels: models }),
	setVercelAiGatewayModels: (models) => set({ vercelAiGatewayModels: models }),
	setLiteLlmModels: (models) => set({ liteLlmModels: models }),
	setOpenAiModels: (models) => set({ openAiModels: models }),
	setRequestyModels: (models) => set({ requestyModels: models }),
	setGroqModels: (models) => set({ groqModels: models }),
	setBasetenModels: (models) => set({ basetenModels: models }),
	setHuggingFaceModels: (models) => set({ huggingFaceModels: models }),
}))
