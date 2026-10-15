---
component_id: 1.1.5
component_name: Command & Utility Permission Evaluator
---

# Command & Utility Permission Evaluator

## Component Description

Parses shell command segments and evaluates permission rules and utility model permission decisions for tool execution.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/permissions/UtilityPermissionDecisionService.ts (lines 77-102)
```
	async decide(request: UtilityPermissionRequest, signal?: AbortSignal): Promise<UtilityPermissionDecision> {
		const timeoutSignal = AbortSignal.timeout(this.timeoutMs)
		const decisionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
		try {
			const serializedRequest = JSON.stringify(request)
			if (Buffer.byteLength(serializedRequest, "utf8") > MAX_PERMISSION_REQUEST_BYTES) {
				throw new Error("Permission request exceeds the Utility decision size limit")
			}
			const output = await this.collectOutput(
				this.runner.run({
					systemPrompt: UTILITY_PERMISSION_SYSTEM_PROMPT,
					messages: [
						{ role: "user", content: this.policy },
						{ role: "user", content: serializedRequest },
					],
					signal: decisionSignal,
				}),
				decisionSignal,
			)
			return this.parseDecision(output)
		} catch (error) {
			if (signal?.aborted) throw error
			this.onFailure?.(error)
			return FALLBACK_DECISION
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/core/permissions/CommandParser.ts (lines 20-30)
```
	parseCommandSegments(input: string): ParsedCommand {
		let tokens: ParseEntry[] = []
		try {
			tokens = parse(input)
		} catch (err) {
			Logger.error(`Error parsing command: ${err.message}`)
			return { segments: [], subshells: [], hasRedirects: false }
		}

		return this.processTokens(tokens)
	}
```


## Source Files:

- `src/core/permissions/CommandParser.ts`
- `src/core/permissions/CommandPermissionController.ts`
- `src/core/permissions/DangerousCharDetector.ts`
- `src/core/permissions/PermissionRuleEvaluator.ts`
- `src/core/permissions/UtilityPermissionDecisionService.ts`
- `src/core/permissions/types.ts`

