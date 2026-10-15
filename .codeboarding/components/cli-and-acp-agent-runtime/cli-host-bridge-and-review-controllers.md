---
component_id: 2.6
component_name: CLI Host Bridge & Review Controllers
---

# CLI Host Bridge & Review Controllers

## Component Description

Provides CLI-specific webview, host bridge, and streaming comment review controllers that adapt core extension host interactions to terminal output.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/controllers/CliWebviewProvider.ts (lines 9-27)
```
export class CliWebviewProvider extends DiracWebviewProvider {
	constructor(context: DiracExtensionContext) {
		super(context)
	}

	override getWebviewUrl(path: string): string {
		// CLI doesn't have webview URLs
		return `file://${path}`
	}

	override getCspSource(): string {
		return "'self'"
	}

	override isVisible(): boolean {
		// CLI is always "visible"
		return true
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/controllers/index.ts (lines 301-308)
```
export function createCliHostBridgeProvider(workspacePath?: string): HostBridgeClientProvider {
	return {
		workspaceClient: new CliWorkspaceServiceClient(workspacePath),
		envClient: new CliEnvServiceClient(),
		windowClient: new CliWindowServiceClient(),
		diffClient: new CliDiffServiceClient(),
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/controllers/CliCommentReviewController.ts (lines 21-29)
```
	addReviewComment(comment: ReviewComment): void {
		const key = `${comment.filePath}:${comment.startLine}:${comment.endLine}`
		const existing = this.comments.get(key) || []
		existing.push(comment.comment)
		this.comments.set(key, existing)

		print(style.info(`Comment on ${comment.filePath}:${comment.startLine + 1}`))
		print(style.dim(`   ${comment.comment}`))
	}
```


## Source Files:

- `cli/src/controllers/CliCommentReviewController.ts`
- `cli/src/controllers/CliWebviewProvider.ts`
- `cli/src/controllers/index.ts`

