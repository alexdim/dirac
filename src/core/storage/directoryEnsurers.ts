import fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { getGlobalStorageDir } from "./globalStorageDir"
import { getDiracHomePath, getDocumentsPath } from "./paths"

// Ensures the per-task directory exists and returns its path.
export async function ensureTaskDirectoryExists(taskId: string): Promise<string> {
	return getGlobalStorageDir("tasks", taskId)
}

// Expected legacy-path errors: ENOENT (dir missing), EPERM/EACCES (TCC-protected ~/Documents).
function isExpectedMigrationError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException).code
	return code === "ENOENT" || code === "EPERM" || code === "EACCES"
}

// Copies a single file, skipping if dest exists. Per-file isolation — one failure doesn't block others.
async function migrateFile(src: string, dest: string): Promise<void> {
	try {
		await fs.copyFile(src, dest, fs.constants.COPYFILE_EXCL)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") Logger.warn(`migration: skipping ${src}: ${error}`)
	}
}

// Recursively migrates src → dest. Each file has its own try/catch — one failure doesn't abort the rest.
async function migrateDir(src: string, dest: string): Promise<void> {
	await fs.mkdir(dest, { recursive: true })
	const entries = await fs.readdir(src, { withFileTypes: true })
	await Promise.all(
		entries.map(async (entry) => {
			const s = path.join(src, entry.name)
			const d = path.join(dest, entry.name)
			if (entry.isDirectory()) await migrateDir(s, d)
			else await migrateFile(s, d)
		}),
	)
}

// Migrates legacy ~/Documents/Dirac/<subdir> → ~/.dirac/<subdir> recursively, skipping existing files.
// Swallows only ENOENT/EPERM/EACCES (TCC-protected ~/Documents); logs and rethrows unexpected errors.
async function migrateFromDocumentsDir(subdir: string, destDir: string): Promise<void> {
	const legacyDir = path.join(await getDocumentsPath(), "Dirac", subdir)
	try {
		await migrateDir(legacyDir, destDir)
	} catch (error) {
		if (isExpectedMigrationError(error)) return
		Logger.warn(`migration: failed ${legacyDir}: ${error}`)
		throw error
	}
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
