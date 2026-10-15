---
component_id: 7.3
component_name: Source AST Analysis & Mutation Service
---

# Source AST Analysis & Mutation Service

## Component Description

Catalogs source definitions, resolves symbol occurrences and context, and plans AST-based source mutations.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/source-ast/SourceDefinitionCatalog.ts (lines 60-128)
```
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
```

### /Users/highlands/pools/Development/dirac/src/services/source-ast/SourceOccurrenceResolver.ts (lines 51-53)
```
	constructor(private readonly dependencies: SourceOccurrenceResolverDependencies) {
		this.index = dependencies.index ?? SymbolIndexService.getInstance()
	}
```

### /Users/highlands/pools/Development/dirac/src/services/source-ast/SourceOccurrenceResolver.ts (lines 188-347)
```
	private async filterQualifiedLocations(
		symbol: string,
		scope: ResolvedScope,
		locations: SymbolLocation[],
		kind: AstOccurrenceRequest["kind"],
		requireDefinitionOwnership: boolean,
	): Promise<QualifiedLocationResult> {
		const allDefinitionLocations = [...new Map(
			this.index
				.getDefinitions(this.indexedSymbolName(symbol))
				.map((location) => [this.locationKey(location), location]),
		).values()]
		const scopedDefinitionLocations = allDefinitionLocations.filter((location) =>
			this.contains(scope.absolutePath, this.absoluteLocationPath(location)),
		)
		const definitionsToResolve = kind === "definition" ? scopedDefinitionLocations : allDefinitionLocations
		if (definitionsToResolve.length === 0) {
			if (requireDefinitionOwnership && kind !== "definition" && locations.length > 0) {
				return {
					status: "ambiguous",
					locations: [],
					message: `Cannot safely rename '${symbol}': indexed references exist, but no indexed definition establishes their ownership.`,
				}
			}
			return this.isQualifiedSymbol(symbol)
				? {
					status: "not_found",
					locations: [],
					message: `Symbol not found: ${symbol} in ${scope.displayPath}.`,
				}
				: { status: "success", locations }
		}

		const catalog = this.dependencies.definitionCatalog
		if (!catalog) {
			const requiresDisambiguation = this.isQualifiedSymbol(symbol) || definitionsToResolve.length > 1
			return requiresDisambiguation
				? {
					status: "parse_error",
					locations: [],
					message: `Definition disambiguation is unavailable for ${symbol}.`,
				}
				: { status: "success", locations }
		}

		const indexedDefinitions: IndexedDefinition[] = []
		const failures: Array<{ status: QualifiedLocationResult["status"]; message: string }> = []
		const byFile = new Map<string, SymbolLocation[]>()
		for (const location of definitionsToResolve) {
			const absolutePath = this.absoluteLocationPath(location)
			if (!this.dependencies.validateAccess(absolutePath)) {
				failures.push({
					status: "inaccessible",
					message: `Access denied for indexed source ${this.displayPath(absolutePath)}.`,
				})
				continue
			}
			const group = byFile.get(absolutePath) ?? []
			group.push(location)
			byFile.set(absolutePath, group)
		}

		for (const [absolutePath, fileLocations] of byFile) {
			const displayPath = this.displayPath(absolutePath)
			const result = await catalog.load(absolutePath, { displayPath })
			if (result.status !== "success") {
				failures.push({ status: result.status, message: result.message })
				continue
			}
			for (const location of fileLocations) {
				const definition = result.catalog.definitions.find((candidate) =>
					candidate.nameRange.startLine === location.startLine &&
					candidate.nameRange.startColumn === location.startColumn &&
					candidate.nameRange.endLine === location.endLine &&
					candidate.nameRange.endColumn === location.endColumn,
				)
				if (definition) {
					indexedDefinitions.push({ location, definition })
					continue
				}
				failures.push({
					status: "parse_error",
					message: `Stale symbol-index definition for ${symbol} in ${displayPath}.`,
				})
			}
		}

		if (failures.length > 0) {
			const status = failures.some((failure) => failure.status === "inaccessible")
				? "inaccessible"
				: failures.some((failure) => failure.status === "parse_error")
					? "parse_error"
					: failures[0].status
			return { status, locations: [], message: failures.map((failure) => failure.message).join(" ") }
		}

		const qualifiedIdentities = new Set(indexedDefinitions.map(({ definition }) => definition.qualifiedName))
		const hasDefinitionInRequestedFile = scope.isFile && indexedDefinitions.some(({ location }) =>
			this.contains(scope.absolutePath, this.absoluteLocationPath(location)),
		)
		if (hasDefinitionInRequestedFile && qualifiedIdentities.size === 1) {
			const identityMatch = catalog.match([indexedDefinitions[0].definition], symbol)
			if (identityMatch.status === "success") return { status: "success", locations }
		}

		const match = catalog.match(indexedDefinitions.map(({ definition }) => definition), symbol)
		if (match.status === "not_found") {
			return {
				status: "not_found",
				locations: [],
				message: `Symbol not found: ${symbol} in ${scope.displayPath}.`,
			}
		}
		if (match.status === "ambiguous") {
			return {
				status: "ambiguous",
				locations: [],
				message: `Ambiguous symbol '${symbol}' in ${scope.displayPath}: ${match.candidates
					.map((definition) => `${definition.qualifiedName} at line ${definition.declarationLine + 1}`)
					.join(", ")}. Use a dot-qualified symbol.`,
			}
		}

		const selected = indexedDefinitions.find(({ definition }) => definition === match.definition)
		if (!selected) {
			return {
				status: "parse_error",
				locations: [],
				message: `Unable to map ${symbol} to its indexed definition in ${scope.displayPath}.`,
			}
		}
		const selectedDefinitionKey = this.locationKey(selected.location)
		const selectedDefinitionLocations = locations.filter(
			(location) => location.type === "definition" && this.locationKey(location) === selectedDefinitionKey,
		)

		if (kind !== "definition" && indexedDefinitions.length > 1) {
			const message = `References for '${symbol}' are ambiguous: the symbol index records only the simple name '${this.indexedSymbolName(symbol)}' and cannot assign references among ${indexedDefinitions
				.map(({ definition }) => definition.qualifiedName)
				.join(", ")}. No references were returned or planned.`
			if (kind === "both" && selectedDefinitionLocations.length > 0) {
				return {
					status: "success",
					locations: selectedDefinitionLocations,
					message,
					partialFailure: true,
					partialFailureStatus: "ambiguous",
					failureMessages: [message],
				}
			}
			return { status: "ambiguous", locations: [], message }
		}

		return {
			status: "success",
			locations: locations.filter((location) =>
				location.type === "reference" || this.locationKey(location) === selectedDefinitionKey,
			),
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/services/source-ast/SourceOccurrenceResolver.ts (lines 349-351)
```
	private absoluteLocationPath(location: SymbolLocation): string {
		return path.normalize(path.isAbsolute(location.path) ? location.path : path.join(this.index.getProjectRoot(), location.path))
	}
```


## Source Files:

- `src/services/source-ast/SourceAstService.ts`
- `src/services/source-ast/SourceDefinitionCatalog.ts`
- `src/services/source-ast/SourceMutationPlanner.ts`
- `src/services/source-ast/SourceOccurrenceResolver.ts`
- `src/services/source-ast/SymbolContextResolver.ts`
- `src/services/source-ast/types.ts`

