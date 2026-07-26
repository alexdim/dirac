import { InvalidArgumentError } from "commander"

const taskDeadlines = new Map<string, number>()
const timedOutTasks = new Set<string>()

export function parseTimeoutSeconds(value: string | number | undefined): number | undefined {
	if (value === undefined) return undefined
	const seconds = typeof value === "number" ? value : Number(value)
	if (!Number.isInteger(seconds) || seconds < 1) {
		throw new InvalidArgumentError("Timeout must be a whole number of seconds greater than zero")
	}
	return seconds
}

export function getTaskDeadline(taskId: string, timeoutSeconds: number, now = Date.now()): number {
	const existingDeadline = taskDeadlines.get(taskId)
	if (existingDeadline !== undefined) return existingDeadline
	const deadline = now + timeoutSeconds * 1000
	taskDeadlines.set(taskId, deadline)
	return deadline
}

export function clearTaskDeadline(taskId: string): void {
	taskDeadlines.delete(taskId)
	timedOutTasks.delete(taskId)
}

export function markTaskTimedOut(taskId: string): void {
	timedOutTasks.add(taskId)
}

export function hasTaskTimedOut(taskId: string): boolean {
	return timedOutTasks.has(taskId)
}
