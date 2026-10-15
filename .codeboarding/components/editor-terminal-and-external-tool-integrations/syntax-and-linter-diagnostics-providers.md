---
component_id: 8.4
component_name: Syntax & Linter Diagnostics Providers
---

# Syntax & Linter Diagnostics Providers

## Component Description

Collects syntax and linter diagnostic feedback from workspace files to report new problems introduced by edits.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/diagnostics/IDiagnosticsProvider.ts (lines 8-37)
```
export interface IDiagnosticsProvider {
	/**
	 * Capture current diagnostics before a file operation to establish a baseline.
	 */
	capturePreSaveState(): Promise<FileDiagnostics[]>

	/**
	 * Generate feedback after a file operation, potentially comparing against pre-save state.
	 * @param filePath The absolute path of the file.
	 * @param content The current file content after the operation.
	 * @param preSaveDiagnostics Baseline diagnostics captured before the operation.
	 * @returns A result containing the problem summary and the count of fixed errors.
	 */
	getDiagnosticsFeedback(
		filePath: string,
		content: string,
		preSaveDiagnostics: FileDiagnostics[],
		hashes?: string[],
	): Promise<DiagnosticsFeedbackResult>

	/**
	 * Generate feedback for multiple files after an operation.
	 * @param files Array of file paths and their current contents.
	 * @param preSaveDiagnostics Baseline diagnostics captured before the operation.
	 */
	getDiagnosticsFeedbackForFiles(
		files: Array<{ filePath: string; content: string; hashes?: string[] }>,
		preSaveDiagnostics: FileDiagnostics[],
	): Promise<DiagnosticsFeedbackResult[]>
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/diagnostics/LinterFeedbackProvider.ts (lines 8-111)
```
export class LinterFeedbackProvider implements IDiagnosticsProvider {
	constructor(
		private readonly diagnosticsTimeoutMs: number = 3_000,
		private readonly diagnosticsDelayMs: number = 500,
	) {}

	async capturePreSaveState(): Promise<FileDiagnostics[]> {
		return await this.getDiagnosticsSafe()
	}

	async getDiagnosticsFeedback(
		filePath: string,
		content: string,
		preSaveDiagnostics: FileDiagnostics[],
		hashes?: string[],
	): Promise<DiagnosticsFeedbackResult> {
		const postDiagnostics = await pollForNewDiagnostics(
			async () => await this.getDiagnosticsSafe([filePath]),
			preSaveDiagnostics,
			filePath,
			this.diagnosticsTimeoutMs,
			this.diagnosticsDelayMs,
			Math.min(this.diagnosticsTimeoutMs / 2, 500),
		)

		const newDiagnostics = getNewDiagnostics(preSaveDiagnostics, postDiagnostics)
		const postFileDiags = postDiagnostics.find((p) => arePathsEqual(p.filePath, filePath))?.diagnostics || []
		const preFileDiags = preSaveDiagnostics.find((p) => arePathsEqual(p.filePath, filePath))?.diagnostics || []

		const preErrors = preFileDiags.filter((d) => d.severity === DiagnosticSeverity.DIAGNOSTIC_ERROR)
		const postErrors = postFileDiags.filter((d) => d.severity === DiagnosticSeverity.DIAGNOSTIC_ERROR)

		let fixedCount = 0
		if (postErrors.length < preErrors.length) {
			fixedCount = preErrors.length - postErrors.length
		}

		const newProblemsMessage = await diagnosticsToProblemsString(
			newDiagnostics,
			[DiagnosticSeverity.DIAGNOSTIC_ERROR],
			new Map([[filePath, { lines: content.split(/\r?\n/), hashes }]]),
			5,
		)

		return {
			newProblemsMessage,
			fixedCount,
		}
	}

	async getDiagnosticsFeedbackForFiles(
		files: Array<{ filePath: string; content: string; hashes?: string[] }>,
		preSaveDiagnostics: FileDiagnostics[],
	): Promise<DiagnosticsFeedbackResult[]> {
		const postDiagnostics = await pollForNewDiagnostics(
			async () => await this.getDiagnosticsSafe(files.map((f) => f.filePath)),
			preSaveDiagnostics,
			files.map((f) => f.filePath),
			this.diagnosticsTimeoutMs,
			this.diagnosticsDelayMs,
			Math.min(this.diagnosticsTimeoutMs / 2, 500),
		)

		const newDiagnostics = getNewDiagnostics(preSaveDiagnostics, postDiagnostics)

		return Promise.all(
			files.map(async (f) => {
				const postFileDiags = postDiagnostics.find((p) => arePathsEqual(p.filePath, f.filePath))?.diagnostics || []
				const preFileDiags = preSaveDiagnostics.find((p) => arePathsEqual(p.filePath, f.filePath))?.diagnostics || []

				const preErrors = preFileDiags.filter((d) => d.severity === DiagnosticSeverity.DIAGNOSTIC_ERROR)
				const postErrors = postFileDiags.filter((d) => d.severity === DiagnosticSeverity.DIAGNOSTIC_ERROR)

				let fixedCount = 0
				if (postErrors.length < preErrors.length) {
					fixedCount = preErrors.length - postErrors.length
				}

				const newProblemsMessage = await diagnosticsToProblemsString(
					newDiagnostics.filter((d) => arePathsEqual(d.filePath, f.filePath)),
					[DiagnosticSeverity.DIAGNOSTIC_ERROR],
					new Map([[f.filePath, { lines: f.content.split(/\r?\n/), hashes: f.hashes }]]),
					5,
				)

				return {
					newProblemsMessage,
					fixedCount,
				}
			}),
		)
	}

	private async getDiagnosticsSafe(filePaths: string[] = []): Promise<FileDiagnostics[]> {
		try {
			const response = await pTimeout(HostProvider.workspace.getDiagnostics({ filePaths }), {
				milliseconds: this.diagnosticsTimeoutMs,
			})
			return response.fileDiagnostics
		} catch (error) {
			return []
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/diagnostics/SyntaxFeedbackProvider.ts (lines 9-116)
```
export class SyntaxFeedbackProvider implements IDiagnosticsProvider {
	async capturePreSaveState(): Promise<FileDiagnostics[]> {
		return []
	}

	async getDiagnosticsFeedback(
		filePath: string,
		content: string,
		_preSaveDiagnostics: FileDiagnostics[],
		hashes?: string[],
	): Promise<DiagnosticsFeedbackResult> {
		try {
			const extension = path.extname(filePath).toLowerCase().slice(1)
			if (!isLanguageSupported(extension)) {
				return { newProblemsMessage: "", fixedCount: 0 }
			}

			const languageParsers = await loadRequiredLanguageParsers([filePath])
			const { parser } = languageParsers[extension] || {}
			if (!parser) {
				Logger.error(`[SyntaxFeedbackProvider] No parser found for ${filePath}`)
				return { newProblemsMessage: "", fixedCount: 0 }
			}

			let tree: Tree | null = null
			try {
				const parsedTree = parser.parse(content) as Tree
				tree = parsedTree
				if (!parsedTree.rootNode) {
					Logger.error(`[SyntaxFeedbackProvider] Failed to parse tree or rootNode is missing for ${filePath}`)
					return { newProblemsMessage: "", fixedCount: 0 }
				}
				if (!parsedTree.rootNode.hasError) return { newProblemsMessage: "", fixedCount: 0 }

				const errors = this.findErrors(parsedTree.rootNode)
				if (errors.length === 0) return { newProblemsMessage: "", fixedCount: 0 }

				const message = await diagnosticsToProblemsString(
					[{ filePath, diagnostics: errors }],
					[DiagnosticSeverity.DIAGNOSTIC_ERROR],
					new Map([[filePath, { lines: content.split("\n"), hashes }]]),
					5,
				)
				Logger.error(`[SyntaxFeedbackProvider] Returning syntax errors for ${filePath}: ${message}`)
				return { newProblemsMessage: message, fixedCount: 0 }
			} finally {
				tree?.delete()
			}
		} catch (error) {
			Logger.error(`Error in syntax check for ${filePath}:`, error)
			return { newProblemsMessage: "", fixedCount: 0 }
		}
	}

	async getDiagnosticsFeedbackForFiles(
		files: Array<{ filePath: string; content: string; hashes?: string[] }>,
		preSaveDiagnostics: FileDiagnostics[],
	): Promise<DiagnosticsFeedbackResult[]> {
		const results: DiagnosticsFeedbackResult[] = []
		// Shared cached parsers are intentionally used sequentially in this batch path.
		for (const file of files) {
			results.push(await this.getDiagnosticsFeedback(file.filePath, file.content, preSaveDiagnostics, file.hashes))
		}
		return results
	}

	private findErrors(node: SyntaxNode): Diagnostic[] {
		const errors: Diagnostic[] = []
		if (node.type === "ERROR") {
			errors.push({
				range: {
					start: {
						line: node.startPosition.row,
						character: node.startPosition.column,
					},
					end: {
						line: node.endPosition.row,
						character: node.endPosition.column,
					},
				},
				message: `Syntax error at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`,
				severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
				source: "Syntax",
			})
		} else if (node.isMissing) {
			errors.push({
				range: {
					start: {
						line: node.startPosition.row,
						character: node.startPosition.column,
					},
					end: {
						line: node.endPosition.row,
						character: node.endPosition.column,
					},
				},
				message: `Missing '${node.type}' at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`,
				severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
				source: "Syntax",
			})
		}
		if (errors.length >= 5) return errors
		for (let index = 0; index < node.childCount && errors.length < 5; index++) {
			errors.push(...this.findErrors(node.child(index)!))
		}
		return errors
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/diagnostics/getDiagnosticsProviders.ts (lines 5-14)
```
export function getDiagnosticsProviders(
	useLinterOnlyForSyntax = false,
	timeoutMs?: number,
	delayMs?: number,
): IDiagnosticsProvider[] {
	if (useLinterOnlyForSyntax) {
		return [new SyntaxFeedbackProvider()]
	}
	return [new SyntaxFeedbackProvider(), new LinterFeedbackProvider(timeoutMs, delayMs)]
}
```


## Source Files:

- `src/integrations/diagnostics/IDiagnosticsProvider.ts`
- `src/integrations/diagnostics/LinterFeedbackProvider.ts`
- `src/integrations/diagnostics/SyntaxFeedbackProvider.ts`
- `src/integrations/diagnostics/getDiagnosticsProviders.ts`
- `src/integrations/diagnostics/index.ts`

