export type SourceAstResultStatus =
	| "success"
	| "not_found"
	| "unsupported"
	| "inaccessible"
	| "parse_error"
	| "ambiguous"
	| "no_change"

export type SourceDefinitionKind =
	| "function"
	| "method"
	| "class"
	| "interface"
	| "struct"
	| "enum"
	| "module"
	| "other"

export interface SourceRange {
	startIndex: number
	endIndex: number
	startLine: number
	startColumn: number
	endLine: number
	endColumn: number
}

export interface SourceSymbolRange extends SourceRange {
	nameText: string
}

export interface SourceLine {
	lineNumber: number
	text: string
	anchor?: string
}

export interface SourceDefinition {
	simpleName: string
	qualifiedName: string
	kind: SourceDefinitionKind
	nameRange: SourceRange
	definitionRange: SourceRange
	replacementRange: SourceRange
	declarationLine: number
	declarationText: string
	indentation: string
	calls: string[]
	contextLines: SourceLine[]
}

export interface SourceFileCatalog {
	absolutePath: string
	displayPath: string
	content: string
	lines: string[]
	definitions: SourceDefinition[]
}

export interface SourceAstFailure {
	status: Exclude<SourceAstResultStatus, "success">
	path: string
	symbol?: string
	message: string
	candidates?: Array<Pick<SourceDefinition, "qualifiedName" | "kind" | "declarationLine">>
}

export type SourceFileCatalogResult =
	| { status: "success"; catalog: SourceFileCatalog }
	| { status: "unsupported" | "inaccessible" | "parse_error"; path: string; message: string }

export type SourceDefinitionMatch =
	| { status: "success"; definition: SourceDefinition }
	| { status: "not_found" }
	| { status: "ambiguous"; candidates: SourceDefinition[] }

export interface AstOutlineRequest {
	paths: string[]
	includeAnchors?: boolean
	showCallGraph?: boolean
}

export interface AstOutlineFileResult {
	path: string
	absolutePath?: string
	status: SourceAstResultStatus
	definitions: SourceDefinition[]
	lines: SourceLine[]
	message?: string
}

export interface AstOutlineResult {
	files: AstOutlineFileResult[]
}

export interface AstImplementationRequest {
	paths: string[]
	symbols: string[]
	includeAnchors?: boolean
}

export interface AstImplementationTargetResult {
	path: string
	absolutePath?: string
	symbol: string
	status: SourceAstResultStatus
	definition?: SourceDefinition
	content?: string
	contentHash?: string
	lines?: SourceLine[]
	contextLines?: SourceLine[]
	message?: string
	candidates?: SourceAstFailure["candidates"]
}

export interface AstImplementationResult {
	targets: AstImplementationTargetResult[]
}

export interface AstOccurrenceRequest {
	paths: string[]
	symbols: string[]
	kind: "definition" | "reference" | "both"
	includeAnchors?: boolean
	requireDefinitionOwnership?: boolean
}

export interface SourceOccurrence {
	absolutePath: string
	displayPath: string
	symbol: string
	kind: "definition" | "reference"
	startLine: number
	startColumn: number
	endLine: number
	endColumn: number
	sourceLine?: string
	anchor?: string
}

export interface AstOccurrenceTargetResult {
	path: string
	symbol: string
	status: SourceAstResultStatus
	occurrences: SourceOccurrence[]
	message?: string
	partialFailure?: boolean
	partialFailureStatus?: "ambiguous" | "inaccessible" | "parse_error"
	failureMessages?: string[]
}

export interface AstOccurrenceResult {
	targets: AstOccurrenceTargetResult[]
	occurrences: SourceOccurrence[]
}

export interface AstRenameRequest {
	paths: string[]
	symbol: string
	replacement: string
}

export interface AstReplacementTarget {
	path: string
	symbol: string
	replacement: string
}

export interface AstReplacementRequest {
	targets: AstReplacementTarget[]
}

export interface SourceTextEdit {
	startIndex: number
	endIndex: number
	replacement: string
	symbol: string
	source: "rename" | "replace"
}

export interface SourceFileChange {
	absolutePath: string
	displayPath: string
	originalContent: string
	content: string
	changedSymbols: string[]
	editCount: number
	edits: SourceTextEdit[]
}

export interface SourceUnchangedTarget {
	path: string
	symbol: string
	reason: string
}

export interface SourceMutationPlan {
	operation: "rename" | "replace"
	files: SourceFileChange[]
	editCount: number
	unchangedTargets: SourceUnchangedTarget[]
	failures: SourceAstFailure[]
}

export interface ResolvedSourcePath {
	absolutePath: string
	displayPath: string
}

export interface SourceAstDependencies {
	root: string
	resolvePath(path: string): Promise<ResolvedSourcePath>
	validateAccess(path: string): boolean
	reconcileAnchors(path: string, lines: string[]): string[]
	getAnchorFingerprint(path: string): string | null
}
