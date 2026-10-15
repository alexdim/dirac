---
component_id: 17.3
component_name: Clipboard access
---

# Clipboard access

## Component Description

Reads and writes plain text through the VSCode clipboard API.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/clipboardReadText.ts (lines 4-7)
```
export async function clipboardReadText(_: EmptyRequest): Promise<String> {
	const text = await vscode.env.clipboard.readText()
	return String.create({ value: text })
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/env/clipboardWriteText.ts (lines 4-7)
```
export async function clipboardWriteText(request: StringRequest): Promise<Empty> {
	await vscode.env.clipboard.writeText(request.value)
	return Empty.create({})
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/env/clipboardReadText.ts`
- `src/hosts/vscode/hostbridge/env/clipboardWriteText.ts`

