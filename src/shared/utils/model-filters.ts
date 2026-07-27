import type { ApiProvider } from "@shared/api"

/**
 * Filters dynamic OpenRouter-style model IDs based on provider-specific rules.
 * OpenRouter and Vercel AI Gateway must not expose internal Dirac model IDs.
 */
export function filterOpenRouterModelIds(modelIds: string[], _provider: ApiProvider): string[] {
	return modelIds.filter((id) => !id.startsWith("dirac/"))
}
