---
component_id: 4.4
component_name: External Host Providers & Bridge Client
---

# External Host Providers & Bridge Client

## Component Description

Implements external host adapters for authentication, diff views, webviews, comment reviews, and gRPC host-bridge client management.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/external/AuthHandler.ts (lines 139-199)
```
	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		Logger.log("AuthHandler: Received request", req.url)

		if (!req.url) {
			this.sendResponse(res, 404, "text/plain", "Not found")
			return
		}

		// Only accept exact paths SharedUriHandler can route. Prefix matching would
		// let /callback/../x or /authxyz through, and allowing unhandled paths means
		// a stray probe tears down the listener instead of getting a 404.
		const ALLOWED_CALLBACK_PATHS = new Set(["/openrouter", "/requesty", "/task"])
		let pathname: string
		try {
			pathname = new URL(req.url, "http://127.0.0.1").pathname
		} catch {
			pathname = ""
		}
		if (!ALLOWED_CALLBACK_PATHS.has(pathname)) {
			Logger.warn(`AuthHandler: Rejecting unexpected path: ${pathname || req.url}`)
			this.sendResponse(res, 404, "text/plain", "Not found")
			return
		}

		// Lifecycle: the listener stays up for non-callback probes (404 above) and is
		// torn down after the first actual auth attempt — success, malformed callback,
		// or processing error — so the callback port is not left open indefinitely.
		// SERVER_TIMEOUT is the backstop for the no-callback case.
		try {
			const fullUrl = `http://127.0.0.1:${this.port}${req.url}`

			// Use SharedUriHandler directly - it handles all validation and processing
			const success = await SharedUriHandler.handleUri(fullUrl)

			if (!success) {
				this.sendResponse(res, 400, "text/plain", "Bad request")
				this.stop()
				return
			}

			// Try to get redirect URI, but don't fail if not implemented (CLI/JetBrains)
			let redirectUri: string | undefined
			try {
				redirectUri = (await HostProvider.env.getIdeRedirectUri({})).value
				Logger.log("AuthHandler: Got redirect URI:", redirectUri)
			} catch (error) {
				// CLI or JetBrains mode - redirect not available
				Logger.log("AuthHandler: No redirect URI available (CLI/JetBrains mode)")
				redirectUri = undefined
			}

			const html = createAuthSucceededHtml(redirectUri)
			this.sendResponse(res, 200, "text/html", html)
		} catch (error) {
			Logger.error("AuthHandler: Error processing request", error)
			this.sendResponse(res, 400, "text/plain", "Bad request")
		}

		// Auth attempt finished (success or error); stop the callback listener
		this.stop()
	}
```

### /Users/highlands/pools/Development/dirac/src/hosts/external/ExternalDiffviewProvider.ts (lines 106-109)
```
	protected override async closeAllDiffViews(): Promise<void> {
		await HostProvider.diff.closeAllDiffs({})
		this.activeDiffEditorId = undefined
	}
```

### /Users/highlands/pools/Development/dirac/src/hosts/external/ExternalDiffviewProvider.ts (lines 90-104)
```
	protected override async getDocumentText(): Promise<string | undefined> {
		if (!this.activeDiffEditorId) {
			return undefined
		}
		try {
			return (
				await HostProvider.diff.getDocumentText({
					diffId: this.activeDiffEditorId,
				})
			).content
		} catch (err) {
			Logger.log("Error getting contents of diff editor", err)
			return undefined
		}
	}
```


## Source Files:

- `src/hosts/external/AuthHandler.ts`
- `src/hosts/external/ExternalCommentReviewController.ts`
- `src/hosts/external/ExternalDiffviewProvider.ts`
- `src/hosts/external/ExternalWebviewProvider.ts`
- `src/hosts/external/grpc-types.ts`
- `src/hosts/external/host-bridge-client-manager.ts`

