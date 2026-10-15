---
component_id: 2.2.8
component_name: CLI Argument & Header Parsers
---

# CLI Argument & Header Parsers

## Component Description

Parses CLI flags, custom headers, and structured command arguments.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/utils/parser.ts (lines 166-189)
```
export function parseHeaders(headersString: string): Record<string, string> {
	const trimmed = headersString.trim()
	if (trimmed.startsWith("{")) {
		const parsed: unknown = JSON.parse(trimmed)
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Custom headers JSON must be an object")
		}
		for (const [key, value] of Object.entries(parsed)) {
			if (!key.trim() || typeof value !== "string") {
				throw new Error("Custom header names and values must be strings")
			}
		}
		return parsed as Record<string, string>
	}

	const headers: Record<string, string> = {}
	const pairs = trimmed.split(",")
	for (const pair of pairs) {
		const [key, ...valueParts] = pair.split("=")
		if (!key?.trim() || valueParts.length === 0) throw new Error(`Invalid custom header: ${pair}`)
		headers[key.trim()] = valueParts.join("=").trim()
	}
	return headers
}
```


## Source Files:

- `cli/src/utils/command-parsers.ts`
- `cli/src/utils/parser.ts`

