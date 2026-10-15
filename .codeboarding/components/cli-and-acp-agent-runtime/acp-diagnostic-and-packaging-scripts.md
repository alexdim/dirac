---
component_id: 2.7
component_name: ACP Diagnostic & Packaging Scripts
---

# ACP Diagnostic & Packaging Scripts

## Component Description

Provides standalone developer scripts for probing the ACP server over JSON-RPC streams and updating the Homebrew release formula.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/scripts/acp-probe.mts (lines 220-319)
```
class ProbeClient implements acp.Client {
	private readonly argv: Argv
	private readonly counters = new Map<string, number>()
	public idleAt = Date.now()
	public availableCommandsSeen = false
	public sessionInfoSeen = false
	public lastError: string | null = null
	public toolCallIds = new Set<string>()
	public lastAgentText = ""

	constructor(argv: Argv) {
		this.argv = argv
	}

	private bump(key: string) {
		this.counters.set(key, (this.counters.get(key) ?? 0) + 1)
		this.idleAt = Date.now()
	}

	summary(): Record<string, number | boolean | string | null> {
		return {
			...Object.fromEntries(this.counters),
			availableCommandsSeen: this.availableCommandsSeen,
			sessionInfoSeen: this.sessionInfoSeen,
			toolCalls: this.toolCallIds.size,
			lastError: this.lastError,
		}
	}

	async sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const kind = params.update?.sessionUpdate ?? "unknown"
		this.bump(`update:${kind}`)
		if (kind === "available_commands_update") this.availableCommandsSeen = true
		if (kind === "session_info_update") this.sessionInfoSeen = true
		if (kind === "tool_call") {
			const id = (params.update as any).toolCallId
			if (id) this.toolCallIds.add(id)
		}
		if (kind === "agent_message_chunk") {
			const c = (params.update as any).content
			if (c?.type === "text") this.lastAgentText += c.text
		}
		if (this.argv.verbose) {
			log("update", `${kind} ${JSON.stringify(params.update).slice(0, 200)}`)
		}
	}

	async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
		this.bump("requestPermission")
		const tool = params.toolCall?.title ?? "<no title>"
		log("permission", `requested for "${tool}" — ${params.options.length} options`)
		if (this.argv.approveDelayMs > 0) {
			log("permission", `(simulating human delay ${this.argv.approveDelayMs}ms before responding)`)
			await new Promise((r) => setTimeout(r, this.argv.approveDelayMs))
		}
		for (const opt of params.options) {
			log("permission", `  - ${opt.optionId} (${opt.kind}): ${opt.name}`)
		}
		if (this.argv.reject) {
			const reject = params.options.find((o) => o.kind === "reject_once") ?? params.options[params.options.length - 1]
			log("permission", `rejecting with optionId=${reject.optionId}`)
			return { outcome: { outcome: "selected", optionId: reject.optionId } }
		}
		// Default: pick allow_once if available, else allow_always, else first option
		const pick =
			params.options.find((o) => o.kind === "allow_once") ??
			params.options.find((o) => o.kind === "allow_always") ??
			params.options[0]
		log("permission", `auto-approving with optionId=${pick.optionId}`)
		return { outcome: { outcome: "selected", optionId: pick.optionId } }
	}

	async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
		this.bump("readTextFile")
		log("fs", `readTextFile path=${params.path} line=${params.line} limit=${params.limit}`)
		try {
			const { readFile } = await import("node:fs/promises")
			const content = await readFile(params.path, "utf8")
			return { content }
		} catch (err) {
			log("fs", `readTextFile failed: ${(err as Error).message}`)
			throw err
		}
	}

	async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
		this.bump("writeTextFile")
		log("fs", `writeTextFile path=${params.path} (${params.content.length} bytes)`)
		try {
			const { writeFile, mkdir } = await import("node:fs/promises")
			const { dirname } = await import("node:path")
			await mkdir(dirname(params.path), { recursive: true })
			await writeFile(params.path, params.content, "utf8")
			return {}
		} catch (err) {
			log("fs", `writeTextFile failed: ${(err as Error).message}`)
			throw err
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/scripts/update-brew-formula.mts (lines 93-104)
```
async function updateFormula(version: string, sha256: string) {
	console.log("Updating Homebrew formula...")

	let formula = await readFile(FORMULA_PATH, "utf-8")

	const tarballUrl = `https://registry.npmjs.org/dirac-cli/-/dirac-cli-${version}.tgz`

	formula = formula.replace(/url "https:\/\/registry\.npmjs\.org\/dirac-cli\/-\/dirac-cli-[^"]+\.tgz"/, `url "${tarballUrl}"`)
	formula = formula.replace(/sha256 "[a-f0-9]+"/, `sha256 "${sha256}"`)

	await writeFile(FORMULA_PATH, formula, "utf-8")
}
```


## Source Files:

- `cli/scripts/acp-probe.mts`
- `cli/scripts/update-brew-formula.mts`

