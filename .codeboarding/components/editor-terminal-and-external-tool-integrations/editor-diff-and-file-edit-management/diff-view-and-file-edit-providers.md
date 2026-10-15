---
component_id: 8.1.4
component_name: Diff View & File Edit Providers
---

# Diff View & File Edit Providers

## Component Description

Coordinates interactive editor diff views (`DiffViewProvider`) and headless background file edits (`FileEditProvider`).

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

### /Users/highlands/pools/Development/dirac/src/integrations/editor/FileEditProvider.ts (lines 16-202)
```
export class FileEditProvider extends DiffViewProvider {
	private documentContent?: string

	constructor(
		textFileAccess: TextFileAccess = new NodeTextFileAccess(),
		shouldSaveOpenDocumentBeforeRead = true,
		private readonly shouldFormatLocally = true,
	) {
		super(textFileAccess, shouldSaveOpenDocumentBeforeRead)
	}

	override showFile(_absolutePath: string): Promise<void> {
		// No-op: No visual editor to show the file
		return Promise.resolve()
	}

	protected async openDiffEditor(): Promise<void> {
		// No-op: No visual editor to open in a file-system-only provider
		// The file content is already loaded in the base class's open() method
		this.documentContent = this.originalContent ?? ""
	}

	async replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		_currentLine: number | undefined,
	): Promise<void> {
		if (this.documentContent === undefined) {
			throw new Error(
				`Document not initialized for ${this.relPath || "unknown file"}. This can happen if the file failed to open or was already reset.`,
			)
		}

		// Split the document into lines
		const lines = this.documentContent.split("\n")

		// Check if we're replacing to the end of the document
		const replacingToEnd = rangeToReplace.endLine >= lines.length

		// Replace the specified range with the new content
		const newContentLines = content.split("\n")

		// Remove trailing empty line for proper splicing, BUT only when NOT replacing
		// to the end of the document. When replacing to the end, keep the trailing
		// empty string to preserve trailing newlines from the content.
		if (!replacingToEnd && newContentLines[newContentLines.length - 1] === "") {
			newContentLines.pop()
		}

		// Splice the lines array to replace the range
		lines.splice(rangeToReplace.startLine, rangeToReplace.endLine - rangeToReplace.startLine, ...newContentLines)

		// Join the lines back together
		this.documentContent = lines.join("\n")
	}

	protected async scrollEditorToLine(_line: number): Promise<void> {
		// No-op: No visual editor to scroll
	}

	protected async scrollAnimation(_startLine: number, _endLine: number): Promise<void> {
		// No-op: No visual editor to animate
	}

	protected async truncateDocument(lineNumber: number): Promise<void> {
		if (this.documentContent === undefined) {
			return
		}

		// Split the document into lines and keep only up to lineNumber
		const lines = this.documentContent.split("\n")
		if (lineNumber < lines.length) {
			this.documentContent = lines.slice(0, lineNumber).join("\n")
		}
	}

	protected async getDocumentLineCount(): Promise<number> {
		if (this.documentContent === undefined) {
			return 0
		}
		return this.documentContent.split("\n").length
	}

	protected async getDocumentText(): Promise<string | undefined> {
		return this.documentContent
	}

	/**
	 * Public method to get the current document content.
	 * This is exposed for use by tools that need to read the document state.
	 */
	public async getContent(): Promise<string | undefined> {
		return this.getDocumentText()
	}

	protected async saveDocument(): Promise<boolean> {
		if (!this.absolutePath || !this.fileOpManager || this.documentContent === undefined) {
			return false
		}

		const result = await this.fileOpManager.writeFile(this.documentContent)
		this.documentContent = result.content
		return true
	}

	protected async closeAllDiffViews(): Promise<void> {
		// No-op: No visual diff views to close
	}

	protected async resetDiffView(): Promise<void> {
		// Clean up the in-memory document content
		this.documentContent = undefined
	}
	override async applyAndSaveSilently(
		absolutePath: string,
		content: string,
		editType: "create" | "modify" = "modify",
	): Promise<{
		finalContent: string | undefined
		autoFormattingEdits: string | undefined
		userEdits: string | undefined
	}> {
		await this.open(absolutePath, { editType })
		const range = { startLine: 0, endLine: await this.getDocumentLineCount() }
		await this.replaceText(content, range, undefined)
		await this.saveDocument()

		const finalContent = await this.getDocumentText()

		return {
			finalContent,
			autoFormattingEdits: undefined,
			userEdits: undefined,
		}
	}

	override async applyAndSaveBatchSilently(files: { path: string; content: string }[]): Promise<
		Map<
			string,
			{
				finalContent: string | undefined
				autoFormattingEdits: string | undefined
				userEdits: string | undefined
			}
		>
	> {
		const results = new Map()
		for (const file of files) {
			results.set(file.path, await this.applyAndSaveSilently(file.path, file.content, "modify"))
		}
		return results
	}

	override async format(path: string): Promise<string> {
		if (!this.shouldFormatLocally) {
			if (path !== this.absolutePath || this.documentContent === undefined) {
				throw new Error(`No confirmed document content available for ${path}.`)
			}
			return this.documentContent
		}

		// Skip formatting for files outside the workspace (e.g. generated tools, .dirac data)
		const cwd = await getCwd()
		// isLocatedInPath, not startsWith: the raw prefix test both matched sibling directories
		// sharing a prefix (cwd `/a/proj` accepted `/a/proj-evil`) and missed Windows paths that
		// differ from cwd only in drive-letter case.
		if (cwd && !isLocatedInPath(cwd, path)) {
			return await fs.readFile(path, "utf-8")
		}

		const { exec } = await import("child_process")
		const { promisify } = await import("util")
		const execAsync = promisify(exec)

		try {
			await execAsync(`biome check --write "${path}"`, {
				cwd,
				timeout: 10_000,
			})
		} catch (error) {
			// biome may not be installed or may fail — return content as-is
			Logger.warn(`[FileEditProvider] Format failed for ${path}: ${error}`)
		}

		return await fs.readFile(path, "utf-8")
	}
}
```


## Source Files:

- `src/integrations/editor/DiffViewProvider.ts`
- `src/integrations/editor/FileEditProvider.ts`

