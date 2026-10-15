---
component_id: 3.1
component_name: Core Shared Models & Helpers
---

# Core Shared Models & Helpers

## Component Description

Defines core domain models, presentation state, API metrics, configuration types, and common error and data manipulation helpers shared across the extension and webview.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/errors.ts (lines 6-8)
```
export function getErrorMessage(error: unknown, fallback?: string): string {
	return error instanceof Error ? error.message : fallback ?? String(error)
}
```

### /Users/highlands/pools/Development/dirac/src/shared/errors.ts (lines 14-16)
```
export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}
```


## Source Files:

- `src/shared/AutoApprovalSettings.ts`
- `src/shared/ChatContent.ts`
- `src/shared/HistoryItem.ts`
- `src/shared/Languages.ts`
- `src/shared/Patch.ts`
- `src/shared/PresentationOperation.ts`
- `src/shared/UserApprovedCommand.ts`
- `src/shared/UserInfo.ts`
- `src/shared/anchor-limits.ts`
- `src/shared/api.ts`
- `src/shared/array.ts`
- `src/shared/cardIdentity.ts`
- `src/shared/combineCardSequences.ts`
- `src/shared/config-types.ts`
- `src/shared/content-limits.ts`
- `src/shared/context-management.ts`
- `src/shared/errors.ts`
- `src/shared/getApiMetrics.ts`
- `src/shared/goal.ts`
- `src/shared/historyItemFromProto.ts`
- `src/shared/net.ts`
- `src/shared/openai-codex-auth.ts`
- `src/shared/openai-codex-usage.ts`
- `src/shared/presentationState.ts`
- `src/shared/release-notes.ts`
- `src/shared/responseTool.ts`
- `src/shared/safe-json-parse.ts`
- `src/shared/settings-presentation.ts`
- `src/shared/skills.ts`
- `src/shared/slashCommands.ts`
- `src/shared/sqlJsModule.ts`
- `src/shared/string.ts`
- `src/shared/subagentUsage.ts`
- `src/shared/subagents.ts`
- `src/shared/taskStatusProjection.ts`
- `src/shared/text-file-window.ts`
- `src/shared/vsCodeSelectorUtils.ts`

