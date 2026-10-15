---
component_id: 7.5
component_name: Banner Management Service
---

# Banner Management Service

## Component Description

Fetches remote promotional or informational banners, manages welcome banners, and reports banner interaction events.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/services/banner/RemoteBannerService.ts (lines 128-155)
```
	async sendBannerEvent(bannerId: string, eventType: "dismiss"): Promise<void> {
		try {
			const url = new URL("/banners/v2/messages", DiracEnv.config().apiBaseUrl).toString()
			const ideType = this.getIdeType()
			const surface = ideType === "cli" ? "cli" : ideType === "jetbrains" ? "jetbrains" : "vscode"

			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

			try {
				await fetch(url, {
					method: "POST",
					headers: { ...jsonHeaders(), ...(await buildBasicDiracHeaders()) },
					body: JSON.stringify({
						banner_id: bannerId,
						instance_id: this.hostInfo.distinctId,
						surface,
						event_type: eventType,
					}),
					signal: controller.signal,
				})
			} finally {
				clearTimeout(timeoutId)
			}
		} catch (error) {
			Logger.error("[RemoteBannerService] Error sending banner event", error)
		}
	}
```

### /Users/highlands/pools/Development/dirac/src/services/banner/RemoteBannerService.ts (lines 157-209)
```
	async fetchBanners(): Promise<Banner[]> {
		// Do not fetch banners when feature flag is off
		if (!featureFlagsService.getBooleanFlagEnabled(FeatureFlag.REMOTE_BANNERS)) return []

		this.abortController = new AbortController()
		const { signal } = this.abortController
		const timeoutId = setTimeout(() => this.abortController?.abort(), FETCH_TIMEOUT_MS)

		try {
			const url = this.buildFetchUrl()
			const headers: Record<string, string> = { ...jsonHeaders(), ...(await buildBasicDiracHeaders()) }
			const authToken = undefined
			if (authToken) headers.Authorization = `Bearer ${authToken}`

			const response = await fetch(url, { method: "GET", headers, signal })
			clearTimeout(timeoutId)

			if (!response.ok) {
				throw Object.assign(new Error(`HTTP ${response.status}`), {
					status: response.status,
					headers: response.headers,
				})
			}

			const data = (await response.json()) as BannersResponse
			if (!data?.data?.items || !Array.isArray(data.data.items)) return []

			const banners = data.data.items.filter((b) => this.matchesProviderRule(b))
			this.cachedBanners = banners
			this.lastFetchTime = Date.now()
			this.consecutiveFailures = 0

			Logger.log(
				`[RemoteBannerService] After provider filter: ${banners.length} banners: ${JSON.stringify(
					banners.map((b) => ({ id: b.id, placement: b.placement })),
				)}`,
			)

			this.controller.postStateToWebview().catch((error) => {
				Logger.error("Failed to post state to webview after fetching banners:", error)
			})
			return banners
		} catch (error) {
			clearTimeout(timeoutId)

			if (error instanceof Error && error.name === "AbortError") return this.cachedBanners

			this.handleFetchError(error)
			return this.cachedBanners
		} finally {
			this.abortController = null
		}
	}
```


## Source Files:

- `src/services/banner/BannerService.ts`
- `src/services/banner/RemoteBannerService.ts`
- `src/services/banner/WelcomeBannerService.ts`

