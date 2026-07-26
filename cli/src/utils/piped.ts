import * as fs from "node:fs"

export function combinePromptWithPipedInput(prompt: string | undefined, stdinInput: string | null): string | undefined {
	if (!stdinInput) return prompt
	return prompt ? `${stdinInput}\n\n${prompt}` : stdinInput
}

export function isEmptyPipedInput(stdinInput: string | null): boolean {
	return stdinInput !== null && stdinInput.trim() === ""
}

/**
 * Read redirected stdin and return null when stdin is not a pipe or file.
 * The empty string is preserved so callers can distinguish an empty pipe from
 * the absence of redirected input.
 */
export async function readStdinIfPiped(): Promise<string | null> {
	if (process.stdin.isTTY) return null

	try {
		const stats = fs.fstatSync(0)
		if (!stats.isFIFO() && !stats.isFile()) return null
	} catch {
		return null
	}

	// Wait for EOF. A pipeline has no correct arbitrary timeout: returning early
	// would silently truncate a slow upstream command.
	return new Promise((resolve, reject) => {
		let data = ""
		process.stdin.setEncoding("utf8")

		const onData = (chunk: string) => {
			data += chunk
		}
		const cleanup = () => {
			process.stdin.off("data", onData)
			process.stdin.off("end", onEnd)
			process.stdin.off("error", onError)
		}
		const onEnd = () => {
			cleanup()
			resolve(data)
		}
		const onError = (error: Error) => {
			cleanup()
			reject(error)
		}

		process.stdin.on("data", onData)
		process.stdin.once("end", onEnd)
		process.stdin.once("error", onError)
		process.stdin.resume()
	})
}
