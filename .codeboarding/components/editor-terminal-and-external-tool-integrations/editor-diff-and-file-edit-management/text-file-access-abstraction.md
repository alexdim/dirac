---
component_id: 8.1.1
component_name: Text File Access Abstraction
---

# Text File Access Abstraction

## Component Description

Defines the text file read/write abstraction (`TextFileAccess`) and its Node.js filesystem implementation (`NodeTextFileAccess`).

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/editor/TextFileAccess.ts (lines 10-13)
```
export interface TextFileAccess {
	readText(path: string): Promise<TextFileReadResult>
	writeText(path: string, content: string): Promise<TextFileWriteResult>
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/editor/NodeTextFileAccess.ts (lines 8-24)
```
export class NodeTextFileAccess implements TextFileAccess {
	async readText(path: string): Promise<TextFileReadResult> {
		const fileBuffer = await fs.readFile(path)
		// Valid UTF-8 must not be reinterpreted as a legacy encoding by a statistical detector.
		// UTF-16 files (including those without a BOM) contain NULs and still need detection.
		const encoding = isUtf8(fileBuffer) && !fileBuffer.includes(0) ? "utf8" : await detectEncoding(fileBuffer)
		return {
			content: iconv.decode(fileBuffer, encoding),
			encoding,
		}
	}

	async writeText(path: string, content: string): Promise<TextFileWriteResult> {
		await fs.writeFile(path, content, { encoding: "utf8" })
		return { content }
	}
}
```


## Source Files:

- `src/integrations/editor/NodeTextFileAccess.ts`
- `src/integrations/editor/TextFileAccess.ts`

