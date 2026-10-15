---
component_id: 8.1
component_name: Editor Diff & File Edit Management
---

# Editor Diff & File Edit Management

## Component Description

Manages editor diff views, file edit operations, comment reviews, and text file access for applying and inspecting code changes.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/editor/DiffViewProvider.ts (lines 15-347)
```
export abstract class DiffViewProvider {
	editType?: "create" | "modify" | "delete"
	isEditing = false
	protected documentWasOpen = false
	private preDiagnostics: FileDiagnostics[] = []
	protected relPath?: string
	protected absolutePath?: string
	protected fileEncoding = "utf8"
	protected newContent?: string

	protected fileOpManager?: FileOperationManager
	protected readonly contentManager: DiffContentManager

	constructor(
		private readonly textFileAccess: TextFileAccess = new NodeTextFileAccess(),
		private readonly shouldSaveOpenDocumentBeforeRead = true,
	) {
		this.contentManager = new DiffContentManager()
	}

	public async readText(path: string): Promise<string> {
		await this.saveOpenDocumentBeforeTextRead(path)
		return (await this.textFileAccess.readText(path)).content
	}

	private async saveOpenDocumentBeforeTextRead(path: string): Promise<void> {
		if (!this.shouldSaveOpenDocumentBeforeRead) return
		await HostProvider.workspace.saveOpenDocumentIfDirty({ filePath: path })
	}

	public async open(
		relPath: string,
		options?: { displayPath?: string; editType?: "create" | "modify" | "delete" },
	): Promise<void> {
		const editType = options?.editType ?? this.editType ?? "create"
		await this.reset()

		try {
			const cwd = await getCwd()
			const absolutePathResolved = workspaceResolver.resolveWorkspacePath(cwd, relPath, "DiffViewProvider.open.absolutePath")
			this.absolutePath = typeof absolutePathResolved === "string" ? absolutePathResolved : absolutePathResolved.absolutePath
			this.relPath = options?.displayPath ?? relPath
			this.editType = editType
			this.isEditing = true

			if (editType === "modify") {
				await this.saveOpenDocumentBeforeTextRead(this.absolutePath)
			}

			this.fileOpManager = new FileOperationManager(this.absolutePath, editType, this.textFileAccess)
			await this.fileOpManager.setup()
			this.originalContent = this.fileOpManager.originalContent
			this.fileEncoding = this.fileOpManager.fileEncoding

			const providers = getDiagnosticsProviders()
			this.preDiagnostics = (await Promise.all(providers.map((p) => p.capturePreSaveState()))).flat()
			await this.openDiffEditor()
			await this.scrollEditorToLine(0)
			this.contentManager.reset()
		} catch (error) {
			await this.reset()
			throw error
		}
	}

	get originalContent(): string | undefined {
		return this.fileOpManager?.originalContent
	}

	set originalContent(value: string | undefined) {
		if (this.fileOpManager) {
			this.fileOpManager.originalContent = value
		}
	}

	protected abstract openDiffEditor(): Promise<void>
	protected abstract scrollEditorToLine(line: number): Promise<void>
	protected abstract scrollAnimation(startLine: number, endLine: number): Promise<void>
	protected abstract truncateDocument(lineNumber: number): Promise<void>
	protected abstract getDocumentLineCount(): Promise<number>

	private async safelyTruncateDocument(lineNumber: number): Promise<void> {
		const lineCount = await this.getDocumentLineCount()
		if (lineNumber < lineCount) {
			await this.truncateDocument(lineNumber)
		}
	}

	protected abstract getDocumentText(): Promise<string | undefined>

	private async getNewDiagnosticProblems(postSaveContent?: string): Promise<string> {
		if (!this.absolutePath) {
			return ""
		}
		const providers = getDiagnosticsProviders()
		let newProblemsMessage = ""

		for (const provider of providers) {
			const result = await provider.getDiagnosticsFeedback(this.absolutePath, postSaveContent ?? "", this.preDiagnostics)

			if (result.newProblemsMessage) {
				newProblemsMessage = result.newProblemsMessage
				break
			}
		}
		return newProblemsMessage
	}

	protected abstract saveDocument(): Promise<boolean>
	protected abstract closeAllDiffViews(): Promise<void>
	protected abstract resetDiffView(): Promise<void>

	protected async switchToSpecializedEditor(): Promise<void> {}

	async update(
		accumulatedContent: string,
		isFinal: boolean,
		changeLocation?: { startLine: number; endLine: number; startChar: number; endChar: number },
	) {
		if (!this.isEditing) {
			throw new Error("Not editing any file")
		}

		this.newContent = accumulatedContent
		const result = await this.contentManager.update(
			accumulatedContent,
			isFinal,
			async (content, range) => this.replaceText(content, range, undefined),
			async (line) => this.scrollEditorToLine(line),
			() => this.getDocumentLineCount(),
			async (start, end) => this.scrollAnimation(start, end),
		)

		if (isFinal) {
			await this.safelyTruncateDocument(result.lineCount)
			await this.onFinalUpdate()
			await this.switchToSpecializedEditor()
		}
	}

	protected async onFinalUpdate(): Promise<void> {}

	async showFile(absolutePath: string): Promise<void> {
		await openFile(absolutePath, true)
	}

	abstract replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		currentLine: number | undefined,
	): Promise<void>

	protected isNotebookFile(): boolean {
		return this.relPath?.toLowerCase().endsWith(".ipynb") ?? false
	}

	getOriginalContentForLLM(): string | undefined {
		if (this.fileOpManager?.originalContent === undefined) return undefined
		return this.isNotebookFile()
			? sanitizeNotebookForLLM(this.fileOpManager.originalContent, true)
			: this.fileOpManager.originalContent
	}

	async saveChanges(options?: { skipDiagnostics?: boolean }): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		autoFormattingEdits: string | undefined
		finalContent: string | undefined
	}> {
		const preSaveContent = await this.getDocumentText()

		if (!(await this.saveDocument())) {
			throw new Error(
				`Failed to save changes to ${this.relPath}. The file may be read-only or the save operation was cancelled.`,
			)
		}

		if (!this.relPath || !this.absolutePath || this.newContent === undefined || preSaveContent === undefined) {
			return {
				newProblemsMessage: undefined,
				userEdits: undefined,
				autoFormattingEdits: undefined,
				finalContent: undefined,
			}
		}

		const postSaveContent = (await this.getDocumentText()) ?? ""

		await this.showFile(this.absolutePath)
		await this.closeAllDiffViews()

		let userEdits: string | undefined
		if (this.newContent !== undefined && preSaveContent !== undefined) {
			userEdits = this.contentManager.detectUserEdits(this.newContent, preSaveContent, this.relPath)
		}

		let autoFormattingEdits: string | undefined
		if (preSaveContent !== undefined && postSaveContent !== undefined) {
			autoFormattingEdits = this.contentManager.detectAutoFormattingEdits(preSaveContent, postSaveContent, this.relPath)
		}

		const newProblems = options?.skipDiagnostics ? "" : await this.getNewDiagnosticProblems(postSaveContent)
		const finalContent = this.contentManager.getFinalContent(postSaveContent, this.isNotebookFile())

		const newProblemsMessage =
			newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""
		return {
			newProblemsMessage,
			userEdits,
			autoFormattingEdits,
			finalContent,
		}
	}

	async revertChanges(): Promise<void> {
		if (!this.absolutePath || !this.isEditing) {
			return
		}

		const fileExists = this.editType === "modify"

		try {
			if (!fileExists) {
				await this.saveDocument()
				await this.closeAllDiffViews()
				await this.fileOpManager!.deleteFile()
				Logger.log(`File ${this.absolutePath} has been deleted.`)

				await this.fileOpManager!.deleteCreatedDirs()
			} else {
				const currentContents = await this.getDocumentText()
				if (currentContents !== undefined && this.originalContent !== undefined) {
					const lineCount = (currentContents.match(/\n/g) || []).length + 1
					await this.replaceText(this.originalContent, { startLine: 0, endLine: lineCount }, undefined)
					await this.saveDocument()
					Logger.log(`File ${this.absolutePath} has been reverted to its original content.`)
				} else {
					Logger.log(`Skipping content revert for ${this.absolutePath} as it was not successfully initialized.`)
				}

				if (this.documentWasOpen) {
					openFile(this.absolutePath, true)
				}
				await this.closeAllDiffViews()
			}
		} catch (error) {
			Logger.error(`Failed to revert changes for ${this.absolutePath}:`, error)
			throw error
		} finally {
			await this.reset()
		}
	}

	async scrollToFirstDiff() {
		if (!this.isEditing) {
			return
		}
		await this.contentManager.scrollToFirstDiff(
			this.originalContent ?? "",
			async () => (await this.getDocumentText()) ?? "",
			(line) => this.scrollEditorToLine(line),
		)
	}

	async deleteFile(fileName: string) {
		const fileLocation = this.absolutePath
		if (!fileLocation?.endsWith(fileName) || !this.isEditing) {
			return
		}

		await this.closeAllDiffViews()

		try {
			await this.fileOpManager!.deleteFile()
			Logger.log(`File ${fileLocation} has been deleted.`)
		} catch (error) {
			Logger.error(`Failed to delete file ${fileLocation}:`, error)
			throw error
		}

		this.isEditing = false
		this.newContent = undefined
	}

	async reset() {
		this.isEditing = false
		this.editType = undefined
		this.absolutePath = undefined
		this.relPath = undefined
		this.preDiagnostics = []
		this.fileEncoding = "utf8"
		this.documentWasOpen = false
		this.newContent = undefined
		this.fileOpManager?.reset()
		this.fileOpManager = undefined

		this.contentManager.reset()
		await this.resetDiffView()
	}

	abstract applyAndSaveSilently(
		absolutePath: string,
		content: string,
		editType?: "create" | "modify",
	): Promise<{
		finalContent: string | undefined
		autoFormattingEdits: string | undefined
		userEdits: string | undefined
	}>

	abstract applyAndSaveBatchSilently(files: { path: string; content: string }[]): Promise<
		Map<
			string,
			{
				finalContent: string | undefined
				autoFormattingEdits: string | undefined
				userEdits: string | undefined
			}
		>
	>

	async showReview(
		_files: { absolutePath: string; displayPath: string; content: string; originalContent?: string }[],
	): Promise<void> {}
	async undoUserEdits() {
		if (this.newContent !== undefined) {
			await this.update(this.newContent, true)
		}
	}

	async hideReview(): Promise<void> {}
	abstract format(path: string): Promise<string>
}
```

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

- `src/integrations/editor/CommentReviewController.ts`
- `src/integrations/editor/DiffContentManager.ts`
- `src/integrations/editor/DiffViewProvider.ts`
- `src/integrations/editor/FileEditProvider.ts`
- `src/integrations/editor/FileOperationManager.ts`
- `src/integrations/editor/NodeTextFileAccess.ts`
- `src/integrations/editor/TextFileAccess.ts`
- `src/integrations/editor/detect-omission.ts`

