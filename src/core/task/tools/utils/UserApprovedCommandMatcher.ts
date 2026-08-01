import { CommandParser, type ParsedCommand } from "@core/permissions/CommandParser"
import type { UserApprovedCommand } from "@shared/UserApprovedCommand"

const commandParser = new CommandParser()

function hasUnsupportedShellSyntax(command: string): boolean {
	let inSingleQuote = false
	let inDoubleQuote = false
	let escaped = false

	for (let index = 0; index < command.length; index++) {
		const character = command[index]

		if (escaped) {
			escaped = false
			continue
		}
		if (character === "\\" && !inSingleQuote) {
			escaped = true
			continue
		}
		if (character === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote
			continue
		}
		if (character === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote
			continue
		}
		if (inSingleQuote || inDoubleQuote) continue
		if (character === "\n" || character === "\r" || character === "`") return true
		if (character !== "&") continue
		if (command[index + 1] !== "&") return true
		index++
	}

	return escaped || inSingleQuote || inDoubleQuote
}

function normalizeSingleCommand(command: string): string | undefined {
	const trimmedCommand = command.trim()
	if (!trimmedCommand || hasUnsupportedShellSyntax(trimmedCommand)) return undefined

	const parsed = commandParser.parseCommandSegments(trimmedCommand)
	if (parsed.hasRedirects || parsed.segments.length !== 1 || parsed.subshells.length > 0) return undefined
	return parsed.segments[0].trim().replace(/\s+/g, " ")
}

function matchesEntry(segment: string, entry: UserApprovedCommand): boolean {
	const approvedCommand = normalizeSingleCommand(entry.command)
	if (!approvedCommand) return false
	if (entry.match === "exact") return segment === approvedCommand
	return segment === approvedCommand || segment.startsWith(`${approvedCommand} `)
}

function areParsedCommandSegmentsApproved(
	parsed: ParsedCommand,
	isSegmentApproved: (segment: string) => boolean,
): boolean {
	if (parsed.hasRedirects || (parsed.segments.length === 0 && parsed.subshells.length === 0)) return false

	for (const segment of parsed.segments) {
		const normalized = segment.trim().replace(/\s+/g, " ")
		if (!normalized || !isSegmentApproved(normalized)) return false
	}

	return parsed.subshells.every((subshell) => areParsedCommandSegmentsApproved(subshell, isSegmentApproved))
}

export function isUserApprovedCommandSegment(segment: string, entries: UserApprovedCommand[]): boolean {
	return entries.some((entry) => matchesEntry(segment, entry))
}

export function areCommandSegmentsApproved(command: string, isSegmentApproved: (segment: string) => boolean): boolean {
	const trimmedCommand = command.trim()
	if (!trimmedCommand || hasUnsupportedShellSyntax(trimmedCommand)) return false
	return areParsedCommandSegmentsApproved(commandParser.parseCommandSegments(trimmedCommand), isSegmentApproved)
}
