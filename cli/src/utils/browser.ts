/**
 * Opens a URL in the user's default browser.
 * Uses dynamic import of the 'open' package to open URLs.
 *
 * @param url - The URL to open in the browser
 */
export async function openUrlInBrowser(url: string): Promise<void> {
	const { default: open } = await import("open")
	const child = await open(url)
	if (child.pid !== undefined) return
	await new Promise<void>((resolve, reject) => {
		child.once("spawn", resolve)
		child.once("error", reject)
	})
}
