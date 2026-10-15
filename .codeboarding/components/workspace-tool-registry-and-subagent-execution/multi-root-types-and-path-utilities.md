---
component_id: 6.4
component_name: Multi-Root Types & Path Utilities
---

# Multi-Root Types & Path Utilities

## Component Description

Defines shared multi-root workspace types and cross-platform path normalization, comparison, and working directory utilities.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/utils/path.ts (lines 106-109)
```
export async function getCwd(defaultCwd = ""): Promise<string> {
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	return workspacePaths.paths.shift() || defaultCwd
}
```

### /Users/highlands/pools/Development/dirac/src/utils/path.ts (lines 55-70)
```
export function arePathsEqual(path1?: string, path2?: string): boolean {
	if (!path1 && !path2) {
		return true
	}
	if (!path1 || !path2) {
		return false
	}

	path1 = normalizePath(path1)
	path2 = normalizePath(path2)

	if (process.platform === "win32") {
		return path1.toLowerCase() === path2.toLowerCase()
	}
	return path1 === path2
}
```

### /Users/highlands/pools/Development/dirac/src/utils/path.ts (lines 83-103)
```
export function getReadablePath(cwd: string, relPath?: string): string {
	relPath = relPath || ""
	// path.resolve is flexible in that it will resolve relative paths like '../../' to the cwd and even ignore the cwd if the relPath is actually an absolute path
	const absolutePathResult = workspaceResolver.resolveWorkspacePath(cwd, relPath, "Utils.path.getReadablePath")
	const absolutePath = typeof absolutePathResult === "string" ? absolutePathResult : absolutePathResult.absolutePath
	if (arePathsEqual(cwd, getDesktopDir())) {
		// User opened vscode without a workspace, so cwd is the Desktop. Show the full absolute path to keep the user aware of where files are being created
		return absolutePath.toPosix()
	}
	if (arePathsEqual(path.normalize(absolutePath), path.normalize(cwd))) {
		const basenameResult = workspaceResolver.getBasename(absolutePath, "Utils.path.getReadablePath")
		return basenameResult.toPosix()
	}
	// show the relative path to the cwd
	const normalizedRelPath = path.relative(cwd, absolutePath)
	if (isLocatedInPath(cwd, absolutePath)) {
		return normalizedRelPath.toPosix()
	}
	// we are outside the cwd, so show the absolute path (useful for when dirac passes in '../../' for example)
	return absolutePath.toPosix()
}
```


## Source Files:

- `src/shared/multi-root/types.ts`
- `src/utils/path.ts`

