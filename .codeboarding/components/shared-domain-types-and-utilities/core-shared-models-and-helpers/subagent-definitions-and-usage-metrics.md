---
component_id: 3.1.6
component_name: Subagent Definitions & Usage Metrics
---

# Subagent Definitions & Usage Metrics

## Component Description

Defines subagent configuration schemas and computes token and cost usage across subagent executions.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/subagentUsage.ts (lines 4-15)
```
export function getSubagentUsage(card: Card): DiracSubagentUsageInfo | undefined {
	if (card.rawOutput?.source === "subagents") {
		return parseUsage(card.rawOutput)
	}
	// Retain support for sessions saved before structured usage records.
	if (card.header !== "Subagent Usage") return undefined
	try {
		return parseUsage(JSON.parse(card.body || "{}"))
	} catch {
		return undefined
	}
}
```


## Source Files:

- `src/shared/subagentUsage.ts`
- `src/shared/subagents.ts`

