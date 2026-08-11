import { CommandParser, type ParsedCommand } from "@core/permissions/CommandParser"
import type { UserApprovedCommand } from "@shared/UserApprovedCommand"

const commandParser = new CommandParser()

function isDescriptorRedirectBoundary(character: string | undefined): boolean {
	return character === undefined || /\s|[|&;()<>]/.test(character)
}

function stripStderrToStdoutRedirects(command: string): string {
	let normalized = ""
	let inSingleQuote = false
	let inDoubleQuote = false
	let escaped = false

	for (let index = 0; index < command.length; index++) {
		const character = command[index]

		if (escaped) {
			normalized += character
			escaped = false
			continue
		}
		if (character === "\\" && !inSingleQuote) {
			normalized += character
			escaped = true
			continue
		}
		if (character === "'" && !inDoubleQuote) {
			normalized += character
			inSingleQuote = !inSingleQuote
			continue
		}
		if (character === '"' && !inSingleQuote) {
			normalized += character
			inDoubleQuote = !inDoubleQuote
			continue
		}

		const startsDescriptorRedirect = command.startsWith("2>&1", index)
		const hasLeadingBoundary = index === 0 || /\s/.test(command[index - 1])
		const hasTrailingBoundary = isDescriptorRedirectBoundary(command[index + 4])
		if (!inSingleQuote && !inDoubleQuote && startsDescriptorRedirect && hasLeadingBoundary && hasTrailingBoundary) {
			index += 3
			continue
		}

		normalized += character
	}

	return normalized
}

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
	const normalizedCommand = stripStderrToStdoutRedirects(command).trim()
	if (!normalizedCommand || hasUnsupportedShellSyntax(normalizedCommand)) return undefined

	const parsed = commandParser.parseCommandSegments(normalizedCommand)
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
	const normalizedCommand = stripStderrToStdoutRedirects(command).trim()
	if (!normalizedCommand || hasUnsupportedShellSyntax(normalizedCommand)) return false
	return areParsedCommandSegmentsApproved(commandParser.parseCommandSegments(normalizedCommand), isSegmentApproved)
}
