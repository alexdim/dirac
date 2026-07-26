import { execFileSync } from "node:child_process"
import { terminalLink } from "./terminal-link"

export { terminalLink }

/**
 * Copy text to the system clipboard using platform-native commands.
 * Returns true on success, false if no clipboard tool is available.
 */
export const copyToClipboardNative = (text: string): boolean => {
	try {
		if (process.platform === "darwin") {
			execFileSync("pbcopy", [], { input: text, stdio: ["pipe", "ignore", "ignore"] })
		} else if (process.platform === "linux") {
			try {
				execFileSync("xclip", ["-selection", "clipboard"], {
					input: text,
					stdio: ["pipe", "ignore", "ignore"],
				})
			} catch {
				execFileSync("xsel", ["--clipboard", "--input"], {
					input: text,
					stdio: ["pipe", "ignore", "ignore"],
				})
			}
		} else if (process.platform === "win32") {
			execFileSync("clip", [], { input: text, stdio: ["pipe", "ignore", "ignore"] })
		} else {
			return false
		}
		return true
	} catch {
		return false
	}
}
