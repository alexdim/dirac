export type UserApprovedCommandMatch = "exact" | "prefix"

export interface UserApprovedCommand {
	command: string
	match: UserApprovedCommandMatch
}

export function normalizeUserApprovedCommand(value: unknown): UserApprovedCommand | undefined {
	if (!value || typeof value !== "object") return undefined
	const candidate = value as Partial<UserApprovedCommand>
	const command = typeof candidate.command === "string" ? candidate.command.trim() : ""
	const match = candidate.match === "exact" || candidate.match === "prefix" ? candidate.match : undefined
	if (!command || command.includes("\n") || command.includes("\r") || !match) return undefined
	return { command, match }
}

export function normalizeUserApprovedCommands(value: unknown): UserApprovedCommand[] {
	if (!Array.isArray(value)) return []

	const normalized: UserApprovedCommand[] = []
	const seen = new Set<string>()

	for (const candidate of value) {
		const entry = normalizeUserApprovedCommand(candidate)
		if (!entry) continue

		const key = `${entry.match}\0${entry.command}`
		if (seen.has(key)) continue
		seen.add(key)
		normalized.push(entry)
	}

	return normalized
}
