/**
 * Shared test fixtures for the system-prompt suite. Kept outside of the
 * `*.test.ts` files so tests never import another test module.
 */
export const mockProviderInfo = {
	providerId: "test",
	model: { id: "fast", info: { supportsPromptCache: false } },
	mode: "act" as const,
}
