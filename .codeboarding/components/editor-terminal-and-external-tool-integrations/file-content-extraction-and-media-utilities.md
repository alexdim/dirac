---
component_id: 8.2
component_name: File Content Extraction & Media Utilities
---

# File Content Extraction & Media Utilities

## Component Description

Provides file content extraction, notebook sanitization, image and text extraction, link previews, and editor file-opening utilities.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/misc/notebook-utils.ts (lines 53-75)
```
export function sanitizeNotebookForLLM(jsonString: string, stripAllOutputs = false): string {
	try {
		const notebook = JSON.parse(jsonString)

		if (!notebook.cells || !Array.isArray(notebook.cells)) {
			return jsonString
		}

		if (stripAllOutputs) {
			notebook.cells = notebook.cells.map((cell: Record<string, unknown>) => ({
				...cell,
				outputs: cell.cell_type === "code" ? [] : cell.outputs,
			}))
		} else {
			notebook.cells = notebook.cells.map((cell: Record<string, unknown>) => sanitizeCellOutputs(cell))
		}

		return JSON.stringify(notebook, null, 1)
	} catch {
		// If parsing fails, return original string
		return jsonString
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/misc/open-file.ts (lines 32-44)
```
export async function openFile(absolutePath: string, preserveFocus = false, preview = false) {
	try {
		await HostProvider.window.showTextDocument({
			path: absolutePath,
			options: { preserveFocus, preview },
		})
	} catch (_error) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Could not open file!`,
		})
	}
}
```


## Source Files:

- `src/integrations/misc/extract-file-content.ts`
- `src/integrations/misc/extract-images.ts`
- `src/integrations/misc/extract-text.ts`
- `src/integrations/misc/link-preview.ts`
- `src/integrations/misc/notebook-utils.ts`
- `src/integrations/misc/open-file.ts`
- `src/integrations/misc/process-files.ts`
- `src/integrations/misc/read-text-file-window.ts`

