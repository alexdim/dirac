import { spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { exit } from "node:process"
import { DiracEndpoint } from "@/config"
import { fetch } from "@/shared/net"
import { printInfo, printWarning } from "./display"

export enum PackageManager {
	NPM = "npm",
	PNPM = "pnpm",
	YARN = "yarn",
	BUN = "bun",
	NPX = "npx",
	UNKNOWN = "unknown",
}

interface InstallationInfo {
	packageManager: PackageManager
	updateInvocation?: UpdateInvocation
}

interface UpdateInvocation {
	command: string
	args: string[]
}

function formatUpdateInvocation(invocation: UpdateInvocation): string {
	return [invocation.command, ...invocation.args].join(" ")
}

/**
 * Check if a version string is a nightly build.
 */
function isNightlyVersion(version: string): boolean {
	return version.includes("-nightly.")
}

/**
 * Get the npm tag to use based on the current version.
 */
function getNpmTag(currentVersion: string): string {
	return isNightlyVersion(currentVersion) ? "nightly" : "latest"
}

/**
 * Detect how the CLI was installed and return the appropriate update command.
 * Uses the correct npm tag based on whether the current version is nightly.
 */
function getInstallationInfo(currentVersion: string): InstallationInfo {
	const tag = getNpmTag(currentVersion)

	try {
		const scriptPath = realpathSync(process.argv[1] || "").replace(/\\/g, "/")

		// npx - skip auto-update (ephemeral execution)
		if (scriptPath.includes("/.npm/_npx") || scriptPath.includes("/npm/_npx")) {
			return { packageManager: PackageManager.NPX }
		}

		// pnpm global
		if (scriptPath.includes("/.pnpm/global") || scriptPath.includes("/pnpm/global")) {
			return {
				packageManager: PackageManager.PNPM,
				updateInvocation: { command: "pnpm", args: ["add", "-g", `dirac-cli@${tag}`] },
			}
		}

		// yarn global
		if (scriptPath.includes("/.yarn/") || scriptPath.includes("/yarn/global")) {
			return {
				packageManager: PackageManager.YARN,
				updateInvocation: { command: "yarn", args: ["global", "add", `dirac-cli@${tag}`] },
			}
		}

		// bun global
		if (scriptPath.includes("/.bun/bin")) {
			return {
				packageManager: PackageManager.BUN,
				updateInvocation: { command: "bun", args: ["add", "-g", `dirac-cli@${tag}`] },
			}
		}

		// npm global (node_modules/dirac)
		if (scriptPath.includes("/node_modules/dirac-cli/")) {
			return {
				packageManager: PackageManager.NPM,
				updateInvocation: { command: "npm", args: ["install", "-g", `dirac-cli@${tag}`] },
			}
		}
	} catch {
		// If we can't resolve the path, assume unknown
	}

	return { packageManager: PackageManager.UNKNOWN }
}

/**
 * Fetch the latest version from npm registry.
 * Uses the appropriate tag based on whether the current version is nightly.
 */
async function getLatestVersion(currentVersion: string): Promise<string | null> {
	try {
		const tag = getNpmTag(currentVersion)
		const response = await fetch(`https://registry.npmjs.org/dirac-cli/${tag}`)
		if (!response.ok) return null
		const data = (await response.json()) as { version: string }
		return data.version || null
	} catch {
		return null
	}
}

/**
 * Auto-update check that runs on CLI startup.
 * Checks for updates asynchronously (non-blocking), then spawns a detached
 * process to install if a newer version is available.
 *
 * Supports npm, pnpm, yarn, and bun global installs.
 * Skipped for npx, local dev, unknown installations, and bundled enterprise packages.
 * Can be disabled with DIRAC_NO_AUTO_UPDATE=1 environment variable.
 */
export function autoUpdateOnStartup(currentVersion: string): void {
	// Skip in dev mode
	if (process.env.IS_DEV === "true") {
		return
	}

	// Skip if auto-update is disabled via env var
	if (process.env.DIRAC_NO_AUTO_UPDATE === "1") {
		return
	}

	// Use setImmediate to ensure this doesn't block the main execution thread at all
	setImmediate(async () => {
		try {
			// Skip if using bundled enterprise config (single source of truth)
			if (DiracEndpoint.isBundledConfig()) {
				return
			}

			const { updateInvocation } = getInstallationInfo(currentVersion)
			if (!updateInvocation) {
				return
			}

			// Async version check - non-blocking, fire and forget
			await checkAndUpdate(currentVersion, updateInvocation)
		} catch {
			// Best effort
		}
	})
}

async function checkAndUpdate(currentVersion: string, updateInvocation: UpdateInvocation): Promise<void> {
	try {
		const latestVersion = await getLatestVersion(currentVersion)
		if (!latestVersion) return

		// Only update if latest is newer
		if (compareVersions(currentVersion, latestVersion) >= 0) return

		// Spawn detached process to run the update command
		const child = spawn(updateInvocation.command, updateInvocation.args, {
			detached: true,
			stdio: "ignore",
			env: process.env,
		})
		child.unref()
	} catch {
		// Silently ignore errors - auto-update is best-effort
	}
}

/**
 * Check for updates and install if available (manual command)
 */
export async function checkForUpdates(currentVersion: string, options?: { verbose?: boolean }) {
	printInfo("Checking for updates...")

	const { updateInvocation, packageManager } = getInstallationInfo(currentVersion)

	try {
		const latestVersion = await getLatestVersion(currentVersion)
		if (!latestVersion) {
			printWarning("Failed to check for updates: could not fetch latest version")
			exit(1)
		}

		if (options?.verbose) {
			printInfo(`Current version: ${currentVersion}`)
			printInfo(`Latest version: ${latestVersion}`)
			printInfo(`Package manager: ${packageManager}`)
		}

		// Compare versions
		if (latestVersion === currentVersion) {
			printInfo(`You are already on the latest version (${currentVersion})`)
			exit(0)
		}

		// Check if current is newer (dev version)
		if (compareVersions(currentVersion, latestVersion) > 0) {
			printInfo(`You are already on a newer version ${currentVersion} (latest: ${latestVersion})`)
			exit(0)
		}

		printInfo(`New version available: ${latestVersion} (current: ${currentVersion})`)

		if (!updateInvocation) {
			printInfo("Unable to determine update command for your installation.")
			printInfo("Please update manually using your package manager.")
			exit(0)
		}

		// Ask user to confirm update
		const { createInterface } = await import("node:readline/promises")
		const prompt = createInterface({ input: process.stdin, output: process.stdout })
		let answer: string
		try {
			answer = await prompt.question("Do you want to update now? (y/N): ")
		} finally {
			prompt.close()
		}
		const normalizedAnswer = answer.trim().toLowerCase()
		if (normalizedAnswer !== "y" && normalizedAnswer !== "yes") {
			exit(0)
		}

		printInfo(`Installing update via ${packageManager}...`)

		const updateProcess = spawn(updateInvocation.command, updateInvocation.args, {
			stdio: "inherit",
			env: process.env,
			windowsHide: true,
		})

		updateProcess.on("close", (code) => {
			if (code === 0) {
				printInfo(`Successfully updated to version ${latestVersion}`)
				exit(0)
			} else {
				printWarning(`Update failed. Please try running: ${formatUpdateInvocation(updateInvocation)}`)
				exit(1)
			}
		})

		updateProcess.on("error", (err) => {
			printWarning(`Failed to run update: ${err.message}`)
			printInfo(`Please try running manually: ${formatUpdateInvocation(updateInvocation)}`)
			exit(1)
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		printWarning(`Error checking for updates: ${message}`)
		exit(1)
	}
}

interface ParsedVersion {
	base: number[]
	isNightly: boolean
	timestamp: number
}

/**
 * Parse a version string into its components.
 * Handles both stable versions (2.0.0) and nightly versions (2.0.0-nightly.1736365200).
 */
function parseVersion(version: string): ParsedVersion {
	const nightlyMatch = version.match(/^(\d+\.\d+\.\d+)-nightly\.(\d+)$/)
	if (nightlyMatch) {
		return {
			base: nightlyMatch[1].split(".").map(Number),
			isNightly: true,
			timestamp: Number.parseInt(nightlyMatch[2], 10),
		}
	}
	return {
		base: version.split(".").map(Number),
		isNightly: false,
		timestamp: 0,
	}
}

/**
 * Compare two semantic version strings.
 * Handles both stable versions and nightly versions.
 * Nightly versions are compared by their timestamps.
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
	const p1 = parseVersion(v1)
	const p2 = parseVersion(v2)

	// Compare base versions first
	for (let i = 0; i < Math.max(p1.base.length, p2.base.length); i++) {
		const part1 = p1.base[i] || 0
		const part2 = p2.base[i] || 0

		if (part1 > part2) return 1
		if (part1 < part2) return -1
	}

	// Base versions are equal, check nightly status
	// Nightly is considered less than stable (it's a pre-release)
	if (p1.isNightly && !p2.isNightly) return -1
	if (!p1.isNightly && p2.isNightly) return 1

	// Both are nightly, compare timestamps
	if (p1.isNightly && p2.isNightly) {
		if (p1.timestamp > p2.timestamp) return 1
		if (p1.timestamp < p2.timestamp) return -1
	}

	return 0
}
