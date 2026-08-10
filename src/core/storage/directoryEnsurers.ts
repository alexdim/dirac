import fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { getGlobalStorageDir } from "./globalStorageDir"
import { getDiracHomePath, getDocumentsPath } from "./paths"

// Ensures the per-task directory exists and returns its path.
export async function ensureTaskDirectoryExists(taskId: string): Promise<string> {
	return getGlobalStorageDir("tasks", taskId)
}

// Copies a single file from legacy to dest, skipping if dest already exists.
async function migrateFile(src: string, dest: string): Promise<void> {
	try {
		await fs.copyFile(src, dest, fs.constants.COPYFILE_EXCL) // don't overwrite existing
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") Logger.warn(`migration: skipping ${src}: ${error}`)
	}
}

// Migrates files from the legacy ~/Documents/Dirac/<subdir> to ~/.dirac/<Subdir>.
// Best-effort: swallows EPERM (TCC-protected ~/Documents) and any other read error.
// Idempotent: skips files that already exist at the destination.
async function migrateFromDocumentsDir(subdir: string, destDir: string): Promise<void> {
	const legacyDir = path.join(await getDocumentsPath(), "Dirac", subdir)
	let entries: string[]
	try {
		entries = await fs.readdir(legacyDir)
	} catch {
		return // legacy dir doesn't exist or is TCC-blocked — nothing to migrate
	}
	await Promise.all(entries.map((entry) => migrateFile(path.join(legacyDir, entry), path.join(destDir, entry))))
}

// Ensures a ~/.dirac/<subdir> directory exists and migrates from the legacy ~/Documents/Dirac/<subdir>.
async function ensureDiracSubdir(subdir: string): Promise<string> {
	const dir = path.join(getDiracHomePath(), subdir)
	await fs.mkdir(dir, { recursive: true })
	await migrateFromDocumentsDir(subdir, dir)
	return dir
}

// Ensures the global Rules directory exists at ~/.dirac/Rules (non-TCC-protected).
export const ensureRulesDirectoryExists = (): Promise<string> => ensureDiracSubdir("Rules")

// Ensures the global Workflows directory exists at ~/.dirac/Workflows (non-TCC-protected).
export const ensureWorkflowsDirectoryExists = (): Promise<string> => ensureDiracSubdir("Workflows")

// Ensures the global Hooks directory exists at ~/.dirac/Hooks (non-TCC-protected).
export const ensureHooksDirectoryExists = (): Promise<string> => ensureDiracSubdir("Hooks")

// Ensures the global settings directory exists and returns its path.
export async function ensureSettingsDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("settings")
}

// Ensures the global state directory exists and returns its path.
export async function ensureStateDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("state")
}

// Ensures the global cache directory exists and returns its path.
export async function ensureCacheDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("cache")
}
