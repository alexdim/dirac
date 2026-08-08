import * as fs from "node:fs/promises"
import * as path from "node:path"
import { loadRequiredLanguageParsers } from "@services/tree-sitter/languageParser"
import type { Parser, Query, Node as SyntaxNode, Tree } from "web-tree-sitter"
import { getErrorMessage } from "@/shared/errors"
import { SymbolContextResolver } from "./SymbolContextResolver"
import type {
	SourceDefinition,
	SourceDefinitionKind,
	SourceDefinitionMatch,
	SourceFileCatalogResult,
	SourceLine,
	SourceRange,
} from "./types"

type AstQueryMatch = {
	captures: Array<{ name: string; node: SyntaxNode }>
}


interface CatalogOptions {
	displayPath?: string
	includeContext?: boolean
	includeAnchors?: boolean
	showCallGraph?: boolean
}

interface SourceDefinitionCatalogDependencies {
	validateAccess(path: string): boolean
	reconcileAnchors(path: string, lines: string[]): string[]
}

const WRAPPER_TYPES = new Set([
	"export_statement",
	"export_declaration",
	"ambient_declaration",
	"decorated_definition",
	"internal_module",
])

const CALL_NODE_TYPES = new Set([
	"call",
	"call_expression",
	"method_invocation",
	"function_call_expression",
	"member_call_expression",
	"invocation_expression",
])

const MEMBER_NODE_TYPES = new Set([
	"member_expression",
	"member_access_expression",
	"property_access",
	"member_call_expression",
])

export class SourceDefinitionCatalog {
	constructor(private readonly dependencies: SourceDefinitionCatalogDependencies) { }

	public async load(absolutePath: string, options: CatalogOptions = {}): Promise<SourceFileCatalogResult> {
		const displayPath = options.displayPath ?? absolutePath
		if (!this.dependencies.validateAccess(absolutePath)) {
			return { status: "inaccessible", path: displayPath, message: `Access denied for ${displayPath}.` }
		}

		let languageParsers
		try {
			languageParsers = await loadRequiredLanguageParsers([absolutePath])
		} catch (error) {
			if (this.isUnsupportedError(error)) {
				return { status: "unsupported", path: displayPath, message: `Unsupported file: ${displayPath}.` }
			}
			return {
				status: "parse_error",
				path: displayPath,
				message: `Unable to load a parser for ${displayPath}: ${this.errorMessage(error)}`,
			}
		}

		const extension = path.extname(absolutePath).toLowerCase().slice(1)
		const { parser, query } = languageParsers[extension] ?? {}
		if (!parser || !query) {
			return { status: "unsupported", path: displayPath, message: `Unsupported file: ${displayPath}.` }
		}

		let content: string
		try {
			content = await fs.readFile(absolutePath, "utf8")
		} catch (error) {
			return {
				status: "inaccessible",
				path: displayPath,
				message: `Unable to read ${displayPath}: ${this.errorMessage(error)}`,
			}
		}

		let tree: Tree | null = null
		try {
			tree = parser.parse(content) as Tree
			if (!tree.rootNode) {
				return { status: "parse_error", path: displayPath, message: `Parse error in ${displayPath}.` }
			}
			const lines = content.split(/\r?\n/)
			const anchors = options.includeAnchors ? this.dependencies.reconcileAnchors(absolutePath, lines) : []
			const definitions = await this.collectDefinitions(
				content,
				lines,
				anchors,
				extension,
				parser,
				query,
				tree,
				options,
			)
			return {
				status: "success",
				catalog: { absolutePath, displayPath, content, lines, definitions },
			}
		} catch (error) {
			return {
				status: "parse_error",
				path: displayPath,
				message: `Parse error in ${displayPath}: ${this.errorMessage(error)}`,
			}
		} finally {
			tree?.delete()
		}
	}

	public match(definitions: SourceDefinition[], requestedSymbol: string): SourceDefinitionMatch {
		const normalized = this.normalizeSymbol(requestedSymbol)
		const exact = definitions.filter((definition) => definition.qualifiedName === normalized)
		const candidates = exact.length > 0
			? exact
			: definitions.filter((definition) =>
				definition.qualifiedName === normalized || definition.qualifiedName.endsWith(`.${normalized}`),
			)
		if (candidates.length === 0) return { status: "not_found" }
		if (candidates.length === 1) return { status: "success", definition: candidates[0] }
		return { status: "ambiguous", candidates }
	}

	private async collectDefinitions(
		content: string,
		lines: string[],
		anchors: string[],
		extension: string,
		parser: Parser,
		query: Query,
		tree: Tree,
		options: CatalogOptions,
	): Promise<SourceDefinition[]> {
		const matches = query.matches(tree.rootNode)
		const nodeToMatch = this.definitionMatchMap(matches)
		const definedNames = new Set<string>()
		const references: SyntaxNode[] = []
		for (const capture of query.captures(tree.rootNode)) {
			if (capture.name.includes("name.definition")) definedNames.add(capture.node.text)
			if (capture.name.includes("name.reference")) references.push(capture.node)
		}

		const definitions: SourceDefinition[] = []
		const seenRanges = new Set<string>()
		for (const match of matches) {
			const nameCapture = match.captures.find((capture) => capture.name.includes("name.definition"))
			const definitionCapture =
				match.captures.find((capture) => capture.name.startsWith("definition.")) ??
				match.captures.find((capture) => !capture.name.startsWith("name."))
			if (!nameCapture || !definitionCapture) continue

			const replacementNode = this.expandReplacementNode(definitionCapture.node)
			const replacementRange = this.rangeForNode(replacementNode)
			const replacementStart = this.expandLeadingMetadata(replacementNode)
			const completeReplacementRange = {
				...replacementRange,
				startIndex: replacementStart.startIndex,
				startLine: replacementStart.startPosition.row,
				startColumn: replacementStart.startPosition.column,
			}
			const rangeKey = `${completeReplacementRange.startIndex}-${completeReplacementRange.endIndex}`
			if (seenRanges.has(rangeKey)) continue
			seenRanges.add(rangeKey)

			const qualifiedName = this.qualifiedName(content, match, definitionCapture.node, nameCapture.node, nodeToMatch)
			const declarationLine = nameCapture.node.startPosition.row
			const definition = {
				simpleName: content.slice(nameCapture.node.startIndex, nameCapture.node.endIndex),
				qualifiedName,
				kind: this.definitionKind(definitionCapture.name),
				nameRange: this.rangeForNode(nameCapture.node),
				definitionRange: this.rangeForNode(definitionCapture.node),
				replacementRange: completeReplacementRange,
				declarationLine,
				declarationText: lines[declarationLine] ?? "",
				indentation: lines[declarationLine]?.match(/^\s*/)?.[0] ?? "",
				calls: options.showCallGraph
					? this.localCalls(definitionCapture.node, nameCapture.node.text, references, definedNames)
					: [],
				contextLines: [] as SourceLine[],
			} satisfies SourceDefinition

			if (options.includeContext) {
				definition.contextLines = await this.resolveContextLines(
					definitionCapture.node,
					content,
					parser,
					extension,
					anchors,
					tree.rootNode,
				)
			}
			definitions.push(definition)
		}

		return definitions.sort((left, right) =>
			left.replacementRange.startIndex - right.replacementRange.startIndex ||
			left.qualifiedName.localeCompare(right.qualifiedName),
		)
	}

	private definitionMatchMap(matches: AstQueryMatch[]): Map<number, AstQueryMatch> {
		const result = new Map<number, AstQueryMatch>()
		for (const match of matches) {
			for (const capture of match.captures) {
				if (capture.name.startsWith("name.") || capture.name.startsWith("definition.")) {
					result.set(capture.node.id, match)
				}
			}
		}
		return result
	}

	private qualifiedName(
		content: string,
		match: AstQueryMatch,
		definitionNode: SyntaxNode,
		nameNode: SyntaxNode,
		nodeToMatch: Map<number, AstQueryMatch>,
	): string {
		let fullName = content.slice(nameNode.startIndex, nameNode.endIndex)
		let current: SyntaxNode | null = definitionNode
		const seenMatches = new Set<AstQueryMatch>([match])
		while (current?.parent) {
			current = current.parent
			const parentMatch = nodeToMatch.get(current.id)
			if (!parentMatch || seenMatches.has(parentMatch)) continue
			const parentName = parentMatch.captures.find((capture) => capture.name.startsWith("name."))
			if (!parentName) continue
			fullName = `${content.slice(parentName.node.startIndex, parentName.node.endIndex)}.${fullName}`
			seenMatches.add(parentMatch)
		}
		return this.normalizeSymbol(fullName)
	}

	private expandReplacementNode(node: SyntaxNode): SyntaxNode {
		let current = node
		while (current.parent && WRAPPER_TYPES.has(current.parent.type)) current = current.parent
		return current
	}

	private expandLeadingMetadata(node: SyntaxNode): SyntaxNode {
		let current = node
		while (current.previousNamedSibling) {
			const previous = current.previousNamedSibling
			if (
				previous.type === "comment" ||
				previous.type === "decorator" ||
				previous.type === "attribute" ||
				previous.type.includes("comment")
			) {
				current = previous
				continue
			}
			break
		}
		return current
	}

	private rangeForNode(node: SyntaxNode): SourceRange {
		return {
			startIndex: node.startIndex,
			endIndex: node.endIndex,
			startLine: node.startPosition.row,
			startColumn: node.startPosition.column,
			endLine: node.endPosition.row,
			endColumn: node.endPosition.column,
		}
	}

	private definitionKind(captureName: string): SourceDefinitionKind {
		const kind = captureName.split(".").pop()?.toLowerCase() ?? ""
		if (kind.includes("method")) return "method"
		if (kind.includes("function")) return "function"
		if (kind.includes("class")) return "class"
		if (kind.includes("interface")) return "interface"
		if (kind.includes("struct")) return "struct"
		if (kind.includes("enum")) return "enum"
		if (kind.includes("module") || kind.includes("namespace")) return "module"
		return "other"
	}

	private localCalls(
		definitionNode: SyntaxNode,
		definitionName: string,
		references: SyntaxNode[],
		definedNames: Set<string>,
	): string[] {
		const result = new Set<string>()
		for (const reference of references) {
			if (reference.startIndex < definitionNode.startIndex || reference.endIndex > definitionNode.endIndex) continue
			if (!definedNames.has(reference.text) || reference.text === definitionName || !this.isCallNode(reference)) continue
			result.add(reference.text)
		}
		return [...result].sort()
	}

	private isCallNode(node: SyntaxNode): boolean {
		const parent = node.parent
		if (!parent) return false
		if (CALL_NODE_TYPES.has(parent.type)) return true
		return !!parent.parent && MEMBER_NODE_TYPES.has(parent.type) && CALL_NODE_TYPES.has(parent.parent.type)
	}

	private async resolveContextLines(
		node: SyntaxNode,
		content: string,
		parser: Parser,
		extension: string,
		anchors: string[],
		rootNode: SyntaxNode,
	): Promise<SourceLine[]> {
		const context = await SymbolContextResolver.resolve({
			node,
			fileContent: content,
			parser,
			ext: extension,
			anchors,
			includeAnchors: false,
			rootNode,
		})
		if (!context) return []
		const sourceLines = content.split(/\r?\n/)
		const wanted = context.split("\n").filter((line) => line && line !== "...")
		const results: SourceLine[] = []
		let cursor = 0
		for (const text of wanted) {
			const index = sourceLines.indexOf(text, cursor)
			if (index < 0) continue
			results.push({ lineNumber: index + 1, text, ...(anchors[index] ? { anchor: anchors[index] } : {}) })
			cursor = index + 1
		}
		return results
	}

	private normalizeSymbol(symbol: string): string {
		return symbol.replace(/::/g, ".")
	}

	private isUnsupportedError(error: unknown): boolean {
		return this.errorMessage(error).startsWith("Unsupported language:")
	}

	private errorMessage(error: unknown): string {
		return getErrorMessage(error)
	}
}
