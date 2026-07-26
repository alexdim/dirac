import path from "node:path"
import { pathToFileURL } from "node:url"
import { PATH_REGEX, extractFirstPath } from "@shared/string"

/**
 * Wraps text in OSC 8 escape sequences to create a terminal link.
 */
export function terminalLink(text: string, url: string): string {
	const safeText = text.replace(/[\u001b\u0007]/g, "")
	const safeUrl = url.replace(/[\u001b\u0007]/g, "")
	return `\u001b]8;;${safeUrl}\u001b\\${safeText}\u001b]8;;\u001b\\`
}

/**
 * Detects file paths in a string and wraps them with terminal links.
 */
export function linkifyPaths(text: string | undefined): string {
	if (!text) return ""

	return text.replace(PATH_REGEX, (match) => {
		// Avoid version numbers (e.g., v1.2.3)
		if (/^v?\d+(\.\d+)+$/.test(match)) return match
		// Avoid IP addresses
		if (/^\d{1,3}(\.\d{1,3}){3}$/.test(match)) return match
		// Avoid things that are already URLs
		if (match.includes("://")) return match

		try {
			const url = getPathUrl(match)
			return terminalLink(match, url)
		} catch {
			return match
		}
	})
}

/**
 * Resolves a file path to an absolute file:// URL.
 */
export function getPathUrl(filePath: string): string {
	const cwd = process.cwd()
	let absolutePath = filePath
	if (!path.isAbsolute(filePath)) {
		absolutePath = path.resolve(cwd, filePath)
	}
	return pathToFileURL(absolutePath).href
}

export { extractFirstPath }
