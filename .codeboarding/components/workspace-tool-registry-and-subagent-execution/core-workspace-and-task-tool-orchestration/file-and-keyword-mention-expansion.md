---
component_id: 6.1.5
component_name: File & Keyword Mention Expansion
---

# File & Keyword Mention Expansion

## Component Description

Parses and expands file and keyword mentions across single and multi-root workspaces.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/mentions/file-mention.ts (lines 27-34)
```
export async function expandFileMention(parsedText: string, mention: string, ctx: FileMentionContext): Promise<string> {
	const mentionPath = getFilePathFromMention(mention)
	const workspaceHint = getWorkspaceHintFromMention(mention)
	const multiRoot = ctx.workspaceManager && ctx.workspaceManager.getRoots().length > 1
	if (multiRoot && !workspaceHint) return expandMultiRootFileMention(parsedText, mention, mentionPath, ctx.workspaceManager!)
	if (multiRoot && workspaceHint) return expandHintedWorkspaceFileMention(parsedText, mention, mentionPath, workspaceHint, ctx)
	return expandSingleRootFileMention(parsedText, mention, mentionPath, ctx)
}
```

### /Users/highlands/pools/Development/dirac/src/core/mentions/file-mention.ts (lines 82-106)
```
async function expandHintedWorkspaceFileMention(
	parsedText: string,
	mention: string,
	mentionPath: string,
	workspaceHint: string,
	ctx: FileMentionContext,
): Promise<string> {
	const isFolder = mention.endsWith("/")
	const mentionType: MentionType = isFolder ? "folder" : "file"
	const targetRoot = ctx.workspaceManager!.getRootByName(workspaceHint)
	if (!targetRoot) {
		const errorMsg = `Workspace '${workspaceHint}' not found`
		telemetryService.captureMentionFailed(mentionType, "not_found", errorMsg)
		return `${parsedText}${formatErrorBlock(mentionPath, isFolder, errorMsg, workspaceHint)}`
	}
	try {
		const content = await getFileOrFolderContent(mentionPath, targetRoot.path)
		await trackFileContextIfFile(ctx, mentionPath, isFolder)
		telemetryService.captureMentionUsed(mentionType, content.length)
		return `${parsedText}${formatContentBlock(mentionPath, isFolder, content, workspaceHint)}`
	} catch (error) {
		telemetryService.captureMentionFailed(mentionType, classifyError(error.message), error.message)
		return `${parsedText}${formatErrorBlock(mentionPath, isFolder, error.message, workspaceHint)}`
	}
}
```

### /Users/highlands/pools/Development/dirac/src/core/mentions/file-mention.ts (lines 141-143)
```
async function trackFileContextIfFile(ctx: FileMentionContext, mentionPath: string, isFolder: boolean): Promise<void> {
	if (!isFolder && ctx.fileContextTracker) await ctx.fileContextTracker.trackFileContext(mentionPath, "file_mentioned")
}
```


## Source Files:

- `src/core/mentions/file-mention.ts`
- `src/core/mentions/keyword-mention.ts`
- `src/core/mentions/mention-parsers.ts`

