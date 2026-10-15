---
component_id: 5.1.3
component_name: External Browser & GitHub URL Utilities
---

# External Browser & GitHub URL Utilities

## Component Description

Provides utility functions for launching external browsers and constructing and opening encoded GitHub issue URLs.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/utils/open-browser.ts (lines 2-29)
```
export async function openBrowser(url: string): Promise<void> {
	const { default: open } = await import("open")
	const child = await open(url)
	// Some Linux launchers stay alive for the browser's lifetime. Observe only startup.
	const startupObservationMs = 1000
	await new Promise<void>((resolve, reject) => {
		let timeout: ReturnType<typeof setTimeout> | undefined
		const finish = (error?: Error) => {
			clearTimeout(timeout)
			child.removeListener("spawn", onSpawn)
			child.removeListener("error", onError)
			child.removeListener("close", onClose)
			if (error) reject(error)
			else resolve()
		}
		const onSpawn = () => {
			timeout = setTimeout(() => finish(), startupObservationMs)
		}
		const onError = (error: Error) => finish(error)
		const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
			finish(code === 0 ? undefined : new Error(`Browser launcher failed (${signal ?? `exit code ${code}`})`))
		}
		child.once("error", onError)
		child.once("close", onClose)
		if (child.pid !== undefined) onSpawn()
		else child.once("spawn", onSpawn)
	})
}
```

### /Users/highlands/pools/Development/dirac/src/utils/github-url-utils.ts (lines 46-62)
```
export function createGitHubIssueUrl(baseUrl: string, params: Map<string, string>): string {
	// Build query string manually with proper encoding
	const queryParts: string[] = []

	for (const [key, value] of params.entries()) {
		const encodedKey = encodeURIComponent(key)
		const encodedValue = encodeURIComponent(value)
		queryParts.push(`${encodedKey}=${encodedValue}`)
	}

	// Determine the proper separator (? or &) based on whether baseUrl already has parameters
	const separator = baseUrl.includes("?") ? "&" : "?"

	// Join all parts to create the final URL
	const queryString = queryParts.join("&")
	return `${baseUrl}${separator}${queryString}`
}
```

### /Users/highlands/pools/Development/dirac/src/utils/github-url-utils.ts (lines 73-112)
```
export async function openUrlInBrowser(url: string): Promise<void> {
	if (!isValidHttpUrl(url)) {
		throw new Error(`Blocked URL with disallowed scheme: ${url}`)
	}

	Logger.log(`Opening URL: ${url}`)

	// Always copy to clipboard as a fallback
	try {
		await writeTextToClipboard(url)
		Logger.log("URL copied to clipboard as backup")
	} catch (error) {
		Logger.error(`Failed to copy URL to clipboard: ${error}`)
	}

	try {
		await openExternal(url)
		Logger.log("Opened URL with openExternal")
	} catch (error) {
		Logger.error(`Error with openExternal utility: ${error}`)

		// Last fallback: Show a message with instructions
		HostProvider.window
			.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Couldn't open the URL automatically. It has been copied to your clipboard.",
				options: {
					items: ["Copy URL Again"],
				},
			})
			.then((response) => {
				if (response.selectedOption === "Copy URL Again") {
					writeTextToClipboard(url)
				}
			})
			.catch((error) => {
				Logger.error("Failed to show URL open fallback message:", error)
			})
	}
}
```


## Source Files:

- `src/utils/github-url-utils.ts`
- `src/utils/open-browser.ts`

