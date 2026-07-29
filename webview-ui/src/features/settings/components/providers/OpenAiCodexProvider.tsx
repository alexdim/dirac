import { openAiCodexModels } from "@shared/api"
import { Mode } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/dirac/common"
import { useEffect, useRef, useState } from "react"
import { useAppStore } from "@/app/store/appStore"
import { normalizeApiConfiguration, supportsReasoningEffortForModelId } from "@/features/settings/components/utils/providerUtils"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { ModelsServiceClient } from "@/shared/api/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { OpenAiCodexAccountCard } from "./openai-codex/OpenAiCodexAccountCard"
import { OpenAiCodexUsagePanel } from "./openai-codex/OpenAiCodexUsagePanel"
import { getOpenAiCodexQuotaFetchedAt, OPENAI_CODEX_USAGE_LAZY_REFRESH_MS } from "./openai-codex/formatOpenAiCodexUsage"

interface OpenAiCodexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/** ChatGPT-login Codex provider settings. Subscription quota remains separate from task token usage. */
export const OpenAiCodexProvider = ({ showModelOptions, isPopup, currentMode }: OpenAiCodexProviderProps) => {
	const {
		apiConfiguration,
		openAiCodexIsAuthenticated,
		openAiCodexEmail,
		openAiCodexUsage,
		openAiCodexUsageRefreshing,
		openAiCodexUsageRefreshError,
		refreshOpenAiCodexUsage,
	} = useSettingsStore()
	const navigateToSettings = useAppStore((state) => state.navigateToSettings)
	const [isAuthenticating, setIsAuthenticating] = useState(false)
	const [authError, setAuthError] = useState<string>()
	const lazyRefreshRequested = useRef(false)

	useEffect(() => {
		if (!openAiCodexIsAuthenticated) {
			lazyRefreshRequested.current = false
			return
		}
		if (lazyRefreshRequested.current) return

		const now = Date.now()
		const quotaFetchedAt = getOpenAiCodexQuotaFetchedAt(openAiCodexUsage)
		const activityFetchedAt = openAiCodexUsage?.activityFetchedAt
		const quotaIsFresh = quotaFetchedAt !== undefined && now - quotaFetchedAt <= OPENAI_CODEX_USAGE_LAZY_REFRESH_MS
		const activityIsFresh =
			activityFetchedAt !== undefined && now - activityFetchedAt <= OPENAI_CODEX_USAGE_LAZY_REFRESH_MS
		if (quotaIsFresh && activityIsFresh) return

		lazyRefreshRequested.current = true
		void refreshOpenAiCodexUsage(false)
	}, [openAiCodexIsAuthenticated, openAiCodexUsage, refreshOpenAiCodexUsage])

	const handleSignIn = async () => {
		setAuthError(undefined)
		setIsAuthenticating(true)
		try {
			await ModelsServiceClient.authenticateOpenAiCodex(EmptyRequest.create({}))
		} catch (error) {
			setAuthError(error instanceof Error ? error.message : "Browser sign-in did not complete")
		} finally {
			setIsAuthenticating(false)
		}
	}

	const handleSignOut = async () => {
		setAuthError(undefined)
		try {
			await ModelsServiceClient.signOutOpenAiCodex(EmptyRequest.create({}))
		} catch (error) {
			setAuthError(error instanceof Error ? error.message : "Could not sign out from ChatGPT")
		}
	}

	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId, selectedModelInfo)

	return (
		<div className="space-y-3">
			<OpenAiCodexAccountCard
				authError={authError}
				email={openAiCodexEmail}
				isAuthenticated={openAiCodexIsAuthenticated}
				isAuthenticating={isAuthenticating}
				onSignIn={() => void handleSignIn()}
				onSignOut={() => void handleSignOut()}
				planType={openAiCodexUsage?.planType}
			/>

			{openAiCodexIsAuthenticated && (
				<OpenAiCodexUsagePanel
					isPopup={isPopup}
					isRefreshing={openAiCodexUsageRefreshing}
					onRefresh={refreshOpenAiCodexUsage}
					onViewDetails={isPopup ? () => navigateToSettings("api-config") : undefined}
					refreshError={openAiCodexUsageRefreshError}
					snapshot={openAiCodexUsage}
				/>
			)}

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={openAiCodexModels}
						onChange={(event: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								event.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
