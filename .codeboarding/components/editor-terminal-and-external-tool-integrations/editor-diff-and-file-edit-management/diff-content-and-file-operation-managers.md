---
component_id: 8.1.3
component_name: Diff Content & File Operation Managers
---

# Diff Content & File Operation Managers

## Component Description

Manages streaming diff buffer edits via `DiffContentManager` and workspace file creation, backup, and deletion via `FileOperationManager`.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/editor/DiffContentManager.ts (lines 9-148)
```
export class DiffContentManager {
	private streamedLines: string[] = []
	private lastUpdateContentLength = -1
	private lastUpdateTime = 0

	constructor(private relPath?: string) {}

	async update(
		content: string,
		isFinal: boolean,
		onReplaceText: (content: string, range: { startLine: number; endLine: number }) => Promise<void>,
		onScrollToLine: (line: number) => Promise<void>,
		getDocumentLineCount: () => Promise<number>,
		onScrollAnimation?: (start: number, end: number) => Promise<void>,
	): Promise<{ lineCount: number }> {
		if (!isFinal) {
			const now = Date.now()
			const contentLength = content.length
			const timeSinceLastUpdate = now - this.lastUpdateTime

			if (contentLength === 0 || contentLength === this.lastUpdateContentLength) {
				return { lineCount: this.streamedLines.length }
			}
			if (timeSinceLastUpdate < UPDATE_THROTTLE_MS) {
				return { lineCount: this.streamedLines.length }
			}

			this.lastUpdateContentLength = contentLength
			this.lastUpdateTime = now
		}

		let processedContent = content
		if (processedContent.startsWith("\ufeff")) {
			processedContent = processedContent.slice(1)
		}

		const accumulatedLines = processedContent.split("\n")
		if (!isFinal) {
			accumulatedLines.pop()
		}

		const diffLines = accumulatedLines.slice(this.streamedLines.length)
		const currentLine = this.streamedLines.length + diffLines.length - 1

		if (currentLine >= 0) {
			let contentToReplace = accumulatedLines.slice(0, currentLine + 1).join("\n")
			if (!isFinal) {
				contentToReplace += "\n"
			}

			const endLine = isFinal ? await getDocumentLineCount() : currentLine + 1
			await onReplaceText(contentToReplace, { startLine: 0, endLine })

			if (diffLines.length <= 5) {
				await onScrollToLine(currentLine)
			} else if (onScrollAnimation) {
				const startLine = this.streamedLines.length
				await onScrollAnimation(startLine, currentLine)
				await onScrollToLine(currentLine)
			} else {
				await onScrollToLine(currentLine)
			}
		}

		this.streamedLines = accumulatedLines
		return { lineCount: this.streamedLines.length }
	}

	async finalize(onTruncate: (lineNumber: number) => Promise<void>): Promise<void> {
		await onTruncate(this.streamedLines.length)
	}

	reset(): void {
		this.streamedLines = []
		this.lastUpdateContentLength = -1
		this.lastUpdateTime = 0
	}

	getAccumulatedContent(): string {
		return this.streamedLines.join("\n")
	}

	async scrollToFirstDiff(
		originalContent: string,
		onGetDocumentText: () => Promise<string | undefined>,
		onScrollToLine: (line: number) => Promise<void>,
	): Promise<void> {
		const currentContent = (await onGetDocumentText()) || ""
		const diffs = this.computeDiffLines(originalContent, currentContent)

		let lineCount = 0
		for (const part of diffs) {
			if (part.added || part.removed) {
				await onScrollToLine(lineCount)
				return
			}
			if (!part.removed) {
				lineCount += part.count || 0
			}
		}
	}

	// Use the diff library's diffLines for accurate change detection with grouping
	private computeDiffLines(a: string, b: string): import("diff").Change[] {
		return diffLib.diffLines(a, b)
	}

	normalizeEol(text: string): string {
		if (text === "") return ""
		const newContentEOL = text.includes("\r\n") ? "\r\n" : "\n"
		return text.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL
	}

	detectUserEdits(newContent: string, preSaveContent: string, relPath?: string): string | undefined {
		const normalizedPre = this.normalizeEol(preSaveContent)
		const normalizedNew = this.normalizeEol(newContent)
		if (normalizedPre !== normalizedNew) {
			return formatResponse.createPrettyPatch((relPath || "file").toPosix(), normalizedNew, normalizedPre)
		}
		return undefined
	}

	detectAutoFormattingEdits(preSaveContent: string, postSaveContent: string, relPath?: string): string | undefined {
		const normalizedPre = this.normalizeEol(preSaveContent)
		const normalizedPost = this.normalizeEol(postSaveContent)
		if (normalizedPre !== normalizedPost) {
			return formatResponse.createPrettyPatch((relPath || "file").toPosix(), normalizedPre, normalizedPost)
		}
		return undefined
	}

	getFinalContent(postSaveContent: string, isNotebookFile: boolean): string {
		const normalized = this.normalizeEol(postSaveContent)
		return isNotebookFile ? sanitizeNotebookForLLM(normalized, true) : normalized
	}

	setRelPath(relPath: string | undefined): void {
		this.relPath = relPath
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/editor/FileOperationManager.ts (lines 7-89)
```
export class FileOperationManager {
	private createdDirs: string[] = []
	originalContent: string | undefined
	fileEncoding: string

	constructor(
		private absolutePath: string,
		private editType: "create" | "modify" | "delete",
		private textFileAccess: TextFileAccess = new NodeTextFileAccess(),
	) {
		this.fileEncoding = "utf8"
	}

	async setup(): Promise<void> {
		if (this.editType === "modify") {
			const result = await this.textFileAccess.readText(this.absolutePath)
			this.fileEncoding = result.encoding
			this.originalContent = result.content
		} else {
			this.originalContent = ""
			this.fileEncoding = "utf8"
		}

		this.createdDirs = this.editType === "create" ? await createDirectoriesForFile(this.absolutePath) : []

		if (this.editType === "create") {
			await this.textFileAccess.writeText(this.absolutePath, "")
		}
	}

	async ensureFileExists(): Promise<void> {
		if (this.editType === "create") {
			const exists = await fs
				.stat(this.absolutePath)
				.then(() => true)
				.catch(() => false)
			if (!exists) {
				await this.textFileAccess.writeText(this.absolutePath, "")
			}
		}
	}

	async writeFile(content: string): Promise<TextFileWriteResult> {
		return this.textFileAccess.writeText(this.absolutePath, content)
	}

	async readFile(): Promise<string> {
		return (await this.textFileAccess.readText(this.absolutePath)).content
	}

	async deleteFile(): Promise<void> {
		await fs.rm(this.absolutePath)
	}

	async deleteCreatedDirs(): Promise<string[]> {
		const deleted: string[] = []
		for (let i = this.createdDirs.length - 1; i >= 0; i--) {
			try {
				await fs.rmdir(this.createdDirs[i])
				deleted.push(this.createdDirs[i])
			} catch {
				// Directory may not exist or be non-empty, skip
			}
		}
		this.createdDirs = []
		return deleted
	}

	getCreatedDirs(): string[] {
		return [...this.createdDirs]
	}

	getOriginalContentForLLM(isNotebookFile: boolean): string | undefined {
		if (this.originalContent === undefined) return undefined
		return isNotebookFile ? sanitizeNotebookForLLM(this.originalContent, true) : this.originalContent
	}

	reset(): void {
		this.createdDirs = []
		this.originalContent = undefined
		this.fileEncoding = "utf8"
	}
}
```


## Source Files:

- `src/integrations/editor/DiffContentManager.ts`
- `src/integrations/editor/FileOperationManager.ts`

