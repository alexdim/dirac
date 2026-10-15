---
component_id: 11
component_name: Build, Codegen & Maintenance Scripts
---

# Build, Codegen & Maintenance Scripts

## Component Description

Contains build, protobuf generation, packaging, prompt inspection, and AST utility scripts for development and CI workflows.

---

## Key References:

### /Users/highlands/pools/Development/dirac/scripts/print-prompt.ts (lines 4-27)
```
async function main() {
	const { systemPrompt, tools } = await getSystemPrompt({
		ide: "vscode",
		providerInfo: {
			provider: "anthropic",
			modelId: "claude-sonnet-4-5",
			modelFamily: ModelFamily.GENERIC,
			supportsPromptCache: true,
			contextWindow: 200000,
			maxTokens: 8192,
		} as any,
		cwd: "/home/user/project",
		isTesting: true,
	})

	console.log("=== SYSTEM PROMPT ===")
	console.log(systemPrompt)
	console.log("\n=== CHAR COUNT ===", systemPrompt?.length)

	if (tools) {
		console.log("\n=== TOOLS ===")
		console.log(JSON.stringify(tools, null, 2))
	}
}
```

### /Users/highlands/pools/Development/dirac/scripts/extract-definition.ts (lines 5-46)
```
async function extractDefinition(filePath: string, definitionName: string): Promise<string | null> {
	const fileContent = await fs.readFile(filePath, "utf8")
	const ext = path.extname(filePath).toLowerCase().slice(1)

	const languageParsers = await loadRequiredLanguageParsers([filePath])
	const { parser, query } = languageParsers[ext] || {}

	if (!parser || !query) {
		return `Unsupported file type: ${filePath}`
	}

	try {
		const tree = parser.parse(fileContent)
		if (!tree || !tree.rootNode) {
			return null
		}

		const matches = query.matches(tree.rootNode)
		const results: string[] = []

		for (const match of matches) {
			const nameCapture = match.captures.find((c) => c.name.includes("name"))
			const defCapture = match.captures.find((c) => !c.name.includes("name"))

			if (nameCapture && defCapture) {
				const nameText = fileContent.slice(nameCapture.node.startIndex, nameCapture.node.endIndex)
				if (nameText === definitionName) {
					const defText = fileContent.slice(defCapture.node.startIndex, defCapture.node.endIndex)
					results.push(defText)
				}
			}
		}

		if (results.length > 0) {
			return results.join("\n\n---\n\n")
		}
	} catch (error) {
		console.error(`Error parsing file ${filePath}:`, error)
	}

	return null
}
```

### /Users/highlands/pools/Development/dirac/scripts/find-references.ts (lines 49-119)
```
async function main() {
	const args = process.argv.slice(2)
	const symbol = args[0]
	const targetPath = args[1] || "."

	if (!symbol) {
		console.error("Usage: npx tsx scripts/find-references.ts <symbol> [path-to-file-or-directory]")
		process.exit(1)
	}

	try {
		const resolvedPath = path.resolve(targetPath)
		const stats = await fs.stat(resolvedPath)

		let files: string[] = []
		if (stats.isDirectory()) {
			const entries = await fs.readdir(resolvedPath, { recursive: true, withFileTypes: true })
			files = entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath || resolvedPath, e.name))
		} else {
			files = [resolvedPath]
		}

		// Filter for supported extensions
		const supportedExts = [
			"js",
			"jsx",
			"ts",
			"tsx",
			"py",
			"rs",
			"go",
			"c",
			"h",
			"cpp",
			"hpp",
			"cs",
			"rb",
			"java",
			"php",
			"swift",
			"kt",
		]
		const filesToScan = files.filter((f) => supportedExts.includes(path.extname(f).toLowerCase().slice(1)))

		if (filesToScan.length === 0) {
			console.log("No supported files found to scan.")
			process.exit(0)
		}

		const languageParsers = await loadRequiredLanguageParsers(filesToScan)

		let totalFound = 0
		for (const file of filesToScan) {
			const refs = await findReferencesInFile(file, symbol, languageParsers)
			if (refs) {
				console.log(`${path.relative(process.cwd(), file)}:`)
				for (const ref of refs) {
					console.log(`  ${ref.line}: ${ref.text}`)
					totalFound++
				}
			}
		}

		if (totalFound === 0) {
			console.log(`No references found for '${symbol}'.`)
		}
	} catch (err) {
		console.error("Error:", err instanceof Error ? err.message : String(err))
		process.exit(1)
	}
}
```

### /Users/highlands/pools/Development/dirac/scripts/unbiased-conformance-adapter.ts (lines 11-18)
```
	async start({ baseUrl, clientId, deviceName }: { baseUrl: string; clientId: string; deviceName: string | null }) {
		try {
			const grant = await startUnbiasedDeviceAuth(deviceName, { baseUrl, clientId })
			return { ok: true, grant }
		} catch (error) {
			return { ok: false, code: error instanceof UnbiasedAuthError ? error.code : "connection_lost" }
		}
	},
```


## Source Files:

- `scripts/api-secrets-parser.mjs`
- `scripts/build-proto.mjs`
- `scripts/build-python-proto.mjs`
- `scripts/build-tests.js`
- `scripts/check-arch-graph.mjs`
- `scripts/copy-source.mjs`
- `scripts/download-ripgrep.mjs`
- `scripts/extract-definition.ts`
- `scripts/file-utils.mjs`
- `scripts/find-references.ts`
- `scripts/generate-host-bridge-client.mjs`
- `scripts/generate-protobus-setup.mjs`
- `scripts/generate-state-proto.mjs`
- `scripts/generate-tool-barrel.ts`
- `scripts/interactive-playwright.ts`
- `scripts/package-npm.mjs`
- `scripts/package-standalone.mjs`
- `scripts/prepare-extension-ripgrep-binaries.mjs`
- `scripts/print-prompt.ts`
- `scripts/proto-shared-utils.mjs`
- `scripts/proto-utils.mjs`
- `scripts/publish-nightly.mjs`
- `scripts/read-lines.ts`
- `scripts/release-notes.mjs`
- `scripts/report-issue.js`
- `scripts/test-hostbridge-server.ts`
- `scripts/test-standalone-core-api-server.ts`
- `scripts/testing-platform-orchestrator.ts`
- `scripts/unbiased-conformance-adapter.ts`
- `scripts/vscode-mock.cjs`

