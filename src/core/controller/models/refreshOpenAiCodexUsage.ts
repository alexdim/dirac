import { EmptyRequest } from "@shared/proto/dirac/common"
import { OpenAiCodexUsage } from "@shared/proto/dirac/models"
import { toProtobufOpenAiCodexUsage } from "@shared/proto-conversions/openai-codex-usage"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { openAiCodexUsageService } from "@/integrations/openai-codex/OpenAiCodexUsageService"
import type { Controller } from "../index"

export async function refreshOpenAiCodexUsage(_controller: Controller, _request: EmptyRequest): Promise<OpenAiCodexUsage> {
	if (!(await openAiCodexOAuthManager.isAuthenticated())) {
		throw new Error("ChatGPT subscription usage is available after signing in with ChatGPT.")
	}

	const snapshot = await openAiCodexUsageService.refresh({ force: true })
	return toProtobufOpenAiCodexUsage(snapshot)
}
