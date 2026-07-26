import { describe, expect, it } from "vitest"
import { extractMentionQuery, insertMention } from "./file-search"
import { extractSlashQuery, insertSlashCommand } from "./slash-commands"

describe("composer token completion", () => {
	it("detects a file mention at the cursor without consuming later text", () => {
		const text = "Review @sr before submitting"
		const cursorPosition = "Review @sr".length

		expect(extractMentionQuery(text, cursorPosition)).toEqual({
			inMentionMode: true,
			query: "sr",
			atIndex: "Review ".length,
		})
	})

	it("replaces only the active file mention and preserves the suffix", () => {
		const text = "Review @sr before submitting"
		const result = insertMention(text, "Review ".length, "src/main.ts", "Review @sr".length)

		expect(result).toEqual({
			text: "Review @/src/main.ts before submitting",
			cursorPosition: "Review @/src/main.ts ".length,
		})
	})

	it("quotes completed mention paths containing spaces", () => {
		const result = insertMention("Open @doc", "Open ".length, "docs/my file.md")

		expect(result).toEqual({
			text: 'Open @"/docs/my file.md" ',
			cursorPosition: 'Open @"/docs/my file.md" '.length,
		})
	})

	it("detects a slash command at the cursor without consuming later text", () => {
		const text = "Please /he after this"
		const cursorPosition = "Please /he".length

		expect(extractSlashQuery(text, cursorPosition)).toEqual({
			inSlashMode: true,
			query: "he",
			slashIndex: "Please ".length,
		})
	})

	it("replaces only the active slash token and preserves the suffix", () => {
		const text = "Please /he after this"
		const result = insertSlashCommand(text, "Please ".length, "help", "Please /he".length)

		expect(result).toEqual({
			text: "Please /help after this",
			cursorPosition: "Please /help ".length,
		})
	})
})
