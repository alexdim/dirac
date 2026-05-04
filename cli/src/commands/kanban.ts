import { spawn } from "node:child_process"
import { exit } from "node:process"

export function getNpxCommand(): string {
	return process.platform === "win32" ? "npx.cmd" : "npx"
}

export async function runKanbanAlias(): Promise<void> {
	const { printWarning } = await import("../utils/display")
	const child = spawn(getNpxCommand(), ["-y", "kanban", "--agent", "dirac"], {
		stdio: "inherit",
	})

	child.on("error", () => {
		printWarning("Failed to run 'npx kanban --agent dirac'. Make sure npx is installed and available in PATH.")
		exit(1)
	})

	child.on("close", (code) => {
		exit(code ?? 1)
	})
}
