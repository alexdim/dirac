import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MAX_CLIPBOARD_IMAGE_BYTES = 50 * 1024 * 1024
const clipboardImagePaths = new Set<string>()

function registerClipboardImage(filePath: string): string | null {
	if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return null
	clipboardImagePaths.add(filePath)
	return filePath
}

function writeCommandImage(filePath: string, command: string, args: string[]): string | null {
	const image = execFileSync(command, args, { maxBuffer: MAX_CLIPBOARD_IMAGE_BYTES })
	if (image.length === 0) return null
	fs.writeFileSync(filePath, image)
	return registerClipboardImage(filePath)
}

function readMacOsClipboardImage(filePath: string): string | null {
	const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
	const script = `
		set found to false
		set theData to missing value
		try
			set theData to the clipboard as «class PNGf»
			set found to true
		on error
			try
				set theData to the clipboard as «class TIFF»
				set found to true
			on error
				try
					set theData to the clipboard as JPEG picture
					set found to true
				end try
			end try
		end try
		if found then
			set theFile to (open for access POSIX file "${escapedPath}" with write permission)
			set eof theFile to 0
			write theData to theFile
			close access theFile
			return "OK"
		end if
		return "NO_IMAGE"
	`
	const result = execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim()
	return result === "OK" ? registerClipboardImage(filePath) : null
}

function readLinuxClipboardImage(filePath: string): string | null {
	try {
		execFileSync("wl-paste", ["--version"], { stdio: "ignore" })
		return writeCommandImage(filePath, "wl-paste", ["-t", "image/png"])
	} catch {
		return writeCommandImage(filePath, "xclip", ["-selection", "clipboard", "-t", "image/png", "-o"])
	}
}

function readWindowsClipboardImage(filePath: string): string | null {
	const escapedPath = filePath.replace(/'/g, "''")
	const command = `Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Clipboard]::ContainsImage()) { $img = [System.Windows.Forms.Clipboard]::GetImage(); $img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'OK' }`
	const result = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
		encoding: "utf8",
	}).trim()
	return result === "OK" ? registerClipboardImage(filePath) : null
}

/**
 * Read an image from the system clipboard and save it to a tracked temporary file.
 * A text-only or unavailable clipboard returns null.
 */
export async function readImageFromClipboard(): Promise<string | null> {
	const temporaryPath = path.join(os.tmpdir(), `dirac-clipboard-${randomUUID()}.png`)

	try {
		switch (process.platform) {
			case "darwin":
				return readMacOsClipboardImage(temporaryPath)
			case "linux":
				return readLinuxClipboardImage(temporaryPath)
			case "win32":
				return readWindowsClipboardImage(temporaryPath)
			default:
				return null
		}
	} catch {
		return null
	} finally {
		if (!clipboardImagePaths.has(temporaryPath) && fs.existsSync(temporaryPath)) {
			fs.unlinkSync(temporaryPath)
		}
	}
}

/** Remove temporary clipboard images created during this CLI process. */
export function disposeClipboardImages(): void {
	for (const imagePath of clipboardImagePaths) {
		if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
		clipboardImagePaths.delete(imagePath)
	}
}
