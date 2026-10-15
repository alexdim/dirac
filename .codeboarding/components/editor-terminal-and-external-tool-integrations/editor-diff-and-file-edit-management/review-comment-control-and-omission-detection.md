---
component_id: 8.1.2
component_name: Review Comment Control & Omission Detection
---

# Review Comment Control & Omission Detection

## Component Description

Provides the abstract `CommentReviewController` for inline AI code review comment threads and `showOmissionWarning` for detecting truncated AI code edits.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/editor/CommentReviewController.ts (lines 45-113)
```
export abstract class CommentReviewController {
	/**
	 * Set the callback for handling user replies
	 */
	abstract setOnReplyCallback(callback: OnReplyCallback): void

	/**
	 * Ensure the comments view won't auto-open when comments are added
	 */
	abstract ensureCommentsViewDisabled(): Promise<void>

	/**
	 * Add a review comment to a file
	 */
	abstract addReviewComment(comment: ReviewComment): void

	/**
	 * Start a streaming review comment - creates the thread immediately with placeholder text
	 * @param revealComment - If true, opens the document and scrolls to show the comment
	 */
	abstract startStreamingComment(
		filePath: string,
		startLine: number,
		endLine: number,
		relativePath?: string,
		fileContent?: string,
		revealComment?: boolean,
	): void

	/**
	 * Append text to the currently streaming comment
	 */
	abstract appendToStreamingComment(chunk: string): void

	/**
	 * End the current streaming comment
	 */
	abstract endStreamingComment(): void

	/**
	 * Add multiple review comments at once
	 */
	abstract addReviewComments(comments: ReviewComment[]): void

	/**
	 * Clear all review comments
	 */
	abstract clearAllComments(): void

	/**
	 * Clear comments for a specific file
	 */
	abstract clearCommentsForFile(filePath: string): void

	/**
	 * Get the number of active comment threads
	 */
	abstract getThreadCount(): number

	/**
	 * Close all diff views associated with comments
	 */
	abstract closeDiffViews(): Promise<void>

	/**
	 * Dispose of all resources
	 */
	abstract dispose(): void
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/editor/detect-omission.ts (lines 44-65)
```
export function showOmissionWarning(originalFileContent: string, newFileContent: string): void {
	if (detectCodeOmission(originalFileContent, newFileContent)) {
		HostProvider.window
			.showMessage({
				type: ShowMessageType.WARNING,
				message: "Potential code truncation detected. This happens when the AI reaches its max output limit.",
				options: {
					items: ["Follow this guide to fix the issue"],
				},
			})
			.then((response) => {
				if (response.selectedOption === "Follow this guide to fix the issue") {
					openExternal(
						"https://github.com/dirac-run/dirac/wiki/Troubleshooting-%E2%80%90-Dirac-Deleting-Code-with-%22Rest-of-Code-Here%22-Comments",
					)
				}
			})
			.catch((error) => {
				Logger.error("Failed to show omission warning message:", error)
			})
	}
}
```


## Source Files:

- `src/integrations/editor/CommentReviewController.ts`
- `src/integrations/editor/detect-omission.ts`

