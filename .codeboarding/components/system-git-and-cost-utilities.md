---
component_id: 12
component_name: System, Git & Cost Utilities
---

# System, Git & Cost Utilities

## Component Description

Provides low-level utilities for filesystem access, Git operations, worktree management, shell detection, line hashing, retry backoff, and API cost calculation.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/utils/fs.ts (lines 55-65)
```
export async function fileExistsAtPath(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch (error: any) {
		if (isNotFound(error) || isNotADirectory(error)) {
			return false
		}
		throw error
	}
}
```

### /Users/highlands/pools/Development/dirac/src/utils/cost.ts (lines 161-187)
```
export function calculateApiCostOpenAI(
	modelInfo: ModelInfo,
	inputTokens: number, // For OpenAI-style, this includes cached tokens
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	thinkingBudgetTokens?: number, // Pass thinking budget info
	reasoningTokens?: number,
	pricingDate: Date = new Date(),
): number | undefined {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Calculate non-cached tokens for the internal function's 'inputTokens' parameter
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)
	// Pass the original 'inputTokens' as 'totalInputTokensForPricing' for tier lookup
	return calculateApiCostInternal(
		modelInfo,
		nonCachedInputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens,
		thinkingBudgetTokens,
		reasoningTokens,
		pricingDate,
	)
}
```

### /Users/highlands/pools/Development/dirac/src/utils/git-worktree.ts (lines 162-233)
```
export async function createWorktree(
	cwd: string,
	worktreePath: string,
	options: {
		branch?: string
		baseBranch?: string
		createNewBranch?: boolean
	} = {},
): Promise<WorktreeResult> {
	const isInstalled = await checkGitInstalled()
	if (!isInstalled) {
		return { success: false, message: "Git is not installed" }
	}

	const isRepo = await checkGitRepo(cwd)
	if (!isRepo) {
		return { success: false, message: "Not a git repository" }
	}

	try {
		const git = simpleGit(cwd)
		const args: string[] = ["worktree", "add"]

		if (options.createNewBranch && options.branch) {
			// Create a new branch and worktree
			args.push("-b", options.branch, worktreePath)
			if (options.baseBranch) {
				args.push(options.baseBranch)
			}
		} else if (options.branch) {
			// Checkout existing branch
			args.push(worktreePath, options.branch)
		} else {
			// Create detached worktree at HEAD
			args.push("--detach", worktreePath)
		}

		await git.raw(args)

		// Resolve the absolute path of the new worktree
		const absoluteWorktreePath = path.isAbsolute(worktreePath) ? worktreePath : path.resolve(cwd, worktreePath)

		// Copy files matched by .worktreeinclude (if it exists)
		const { copiedCount, errors: copyErrors } = await copyWorktreeIncludeFiles(cwd, absoluteWorktreePath)

		// Get the created worktree info
		const { worktrees } = await listWorktrees(cwd)
		const createdWorktree = worktrees.find((w) => w.path === absoluteWorktreePath)

		let message = `Worktree created at ${worktreePath}`
		if (copiedCount > 0) {
			message += ` (copied ${copiedCount} file${copiedCount === 1 ? "" : "s"} from .worktreeinclude)`
		}
		if (copyErrors.length > 0) {
			message += `. Some files failed to copy: ${copyErrors.slice(0, 3).join(", ")}`
			if (copyErrors.length > 3) {
				message += ` and ${copyErrors.length - 3} more`
			}
		}

		return {
			success: true,
			message,
			worktree: createdWorktree,
		}
	} catch (error) {
		return {
			success: false,
			message: `Failed to create worktree: ${getErrorMessage(error)}`,
		}
	}
}
```

### /Users/highlands/pools/Development/dirac/src/utils/env.ts (lines 46-67)
```
export async function openExternal(url: string): Promise<void> {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error(`Invalid URL: ${url}`)
	}
	if (!ALLOWED_OPEN_SCHEMES.includes(parsed.protocol)) {
		throw new Error(`Blocked URL with disallowed scheme '${parsed.protocol}'`)
	}

	Logger.log("Opening browser:", url)
	try {
		await HostProvider.env.openExternal(StringRequest.create({ value: url }))
		return
	} catch (error) {
		// Fallback for hosts that don't implement openExternal (e.g., JetBrains plugin).
		Logger.warn(`Host openExternal RPC failed, falling back to 'open' package: ${error}`)
	}

	await openBrowser(url)
}
```


## Source Files:

- `src/utils/announcements.ts`
- `src/utils/cost.ts`
- `src/utils/env.ts`
- `src/utils/envExpansion.ts`
- `src/utils/frontmatter.ts`
- `src/utils/fs.ts`
- `src/utils/git-worktree.ts`
- `src/utils/git.ts`
- `src/utils/line-hashing.ts`
- `src/utils/model-utils.ts`
- `src/utils/os.ts`
- `src/utils/powershell.ts`
- `src/utils/process-termination.ts`
- `src/utils/retry.ts`
- `src/utils/shell-detection.ts`
- `src/utils/shell.ts`
- `src/utils/string.ts`
- `src/utils/tabFiltering.ts`
- `src/utils/time.ts`

