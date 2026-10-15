---
component_id: 7.9
component_name: Tree-sitter Language Parser Service
---

# Tree-sitter Language Parser Service

## Component Description

Loads and initializes Tree-sitter language grammars and parsers for source code analysis.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/tree-sitter/languageParser.ts (lines 35-57)
```
async function loadLanguage(langName: string): Promise<Language> {
	const wasmName = `tree-sitter-${langName}.wasm`
	const searchPaths = [
		path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasmName),
		path.join(__dirname, wasmName),
		path.join(__dirname, "..", "..", "..", "dist", wasmName),
		path.join(__dirname, "..", "..", "..", "node_modules", "tree-sitter-wasms", "out", wasmName),
	]
	const errors: string[] = []

	for (const wasmPath of searchPaths) {
		try {
			const language = await Language.load(wasmPath)
			SymbolIndexTelemetry.recordGrammarLoad()
			return language
		} catch (error) {
			const message = getErrorMessage(error)
			errors.push(`${wasmPath}: ${message}`)
		}
	}

	throw new Error(`Could not load WASM for language ${langName}. Attempts: ${errors.join(" | ")}`)
}
```

### /Users/highlands/pools/Development/dirac/src/services/tree-sitter/languageParser.ts (lines 148-170)
```
export async function loadRequiredLanguageParsers(filesToParse: string[]): Promise<LanguageParser> {
	await initializeParser()
	const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))
	const parsers: LanguageParser = {}

	for (const extension of extensionsToLoad) {
		const { langName, queryText } = getLanguageDefinition(extension)
		const language = await getLanguage(langName)
		const queryCacheKey = `${langName}:${queryText}`
		let query = queryCache.get(queryCacheKey)
		if (!query) {
			query = new Query(language, queryText)
			queryCache.set(queryCacheKey, query)
		}

		parsers[extension] = {
			parser: getParser(langName, language),
			query,
		}
	}

	return parsers
}
```


## Source Files:

- `src/services/tree-sitter/index.ts`
- `src/services/tree-sitter/languageParser.ts`

