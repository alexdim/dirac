const SAFE_BASE_COMMANDS = [
	"ls",
	"pwd",
	"date",
	"whoami",
	"uname",
	"cat",
	"grep",
	"find",
	"head",
	"tail",
	"cd",
	"clear",
	"echo",
	"hostname",
	"df",
	"du",
	"ps",
	"free",
	"uptime",
	"wc",
	"sort",
	"uniq",
	"file",
	"stat",
	"diff",
	"rg",
	"cut",
	"which",
	"type",
]

const SAFE_GIT_SUBCOMMANDS = ["status", "log", "diff", "branch", "show", "remote"]

/**
 * Checks if a CLI command is considered "harmless" and safe for auto-approval.
 * This function handles piped commands and rejects output redirection to disk.
 *
 * @param command The CLI command to check
 * @returns true if the command is deemed safe, false otherwise
 */
export function isSafeCommand(command: string): boolean {
	let normalized = command.trim()

	// Special case: allow 2>/dev/null at the end of the command
	const devNullRedirection = "2>/dev/null"
	if (normalized.endsWith(devNullRedirection)) {
		normalized = normalized.slice(0, -devNullRedirection.length).trim()
	}

	// 1. Reject output redirection (avoids disk writes) and input redirection
	if (normalized.includes(">") || normalized.includes("<")) {
		return false
	}

	// 2. Reject command substitution
	if (normalized.includes("$(") || normalized.includes("`")) {
		return false
	}

	// 3. Split by common shell operators to check each part
	// Handles |, &&, ||, ;
	const segments = normalized.split(/\|\||&&|[|;]|\n/)

	for (const segment of segments) {
		const trimmed = segment.trim()
		if (!trimmed) {
			continue
		}

		const parts = trimmed.split(/\s+/)
		const baseCommand = parts[0].toLowerCase()

		// 4. Special handling for git to only allow read-only operations
		if (baseCommand === "git") {
			if (parts.length < 2) {
				return false
			}
			const subcommand = parts[1].toLowerCase()
			if (!SAFE_GIT_SUBCOMMANDS.includes(subcommand)) {
				return false
			}

			// Restrict branch and remote to listing only
			if (subcommand === "branch" || subcommand === "remote") {
				const allowedFlags = ["-a", "-r", "-v", "--list", "--get-url"]
				for (let i = 2; i < parts.length; i++) {
					if (!allowedFlags.includes(parts[i])) {
						return false
					}
				}
			}
		} else if (baseCommand === "find") {
			// 5. Special handling for find to block dangerous flags
			const dangerousFlags = ["-delete", "-exec", "-execdir", "-ok", "-okdir"]
			if (parts.some((part) => dangerousFlags.some((flag) => part.toLowerCase().startsWith(flag)))) {
				return false
			}
		} else if (baseCommand === "sort") {
			// 6. Special handling for sort to block output flag
			if (
				parts.some((part) => {
					const lowerPart = part.toLowerCase()
					return lowerPart === "-o" || lowerPart.startsWith("-o") || lowerPart.startsWith("--output")
				})
			) {
				return false
			}
		} else if (!SAFE_BASE_COMMANDS.includes(baseCommand)) {
			// 7. Check against general safe list
			return false
		}
	}

	return true
}
