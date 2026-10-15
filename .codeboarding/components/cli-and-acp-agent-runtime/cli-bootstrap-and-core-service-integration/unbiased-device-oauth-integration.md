---
component_id: 2.4.4
component_name: Unbiased Device OAuth Integration
---

# Unbiased Device OAuth Integration

## Component Description

Manages Unbiased device authorization polling and OAuth account credential validation.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/integrations/unbiased/device-auth.ts (lines 67-107)
```
export async function startUnbiasedDeviceAuth(
	deviceName: string | null,
	options: DeviceAuthOptions = {},
): Promise<UnbiasedDeviceGrant> {
	const { baseUrl = UNBIASED_PLATFORM_URL, clientId = UNBIASED_CLIENT_ID, fetcher = globalThis.fetch, signal } = options
	let response: Awaited<ReturnType<typeof postDeviceAuth>>
	try {
		response = await postDeviceAuth(
			baseUrl,
			fetcher,
			"/api/oauth/device_authorization",
			{
				client_id: clientId,
				...(deviceName ? { device_name: deviceName.slice(0, 100) } : {}),
			},
			signal,
		)
	} catch {
		throw new UnbiasedAuthError(signal?.aborted ? "cancelled" : "connection_lost")
	}
	if (response.status !== 200) throw new UnbiasedAuthError(String(response.body?.error ?? response.status))
	const grant = response.body
	if (
		typeof grant?.device_code !== "string" ||
		typeof grant.user_code !== "string" ||
		typeof grant.verification_uri !== "string" ||
		typeof grant.verification_uri_complete !== "string" ||
		typeof grant.expires_in !== "number" ||
		typeof grant.interval !== "number"
	) {
		throw new UnbiasedAuthError("invalid_response")
	}
	return {
		deviceCode: grant.device_code,
		userCode: grant.user_code,
		verificationUri: grant.verification_uri,
		verificationUriComplete: grant.verification_uri_complete,
		expiresIn: grant.expires_in,
		interval: grant.interval,
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/unbiased/device-auth.ts (lines 109-165)
```
export async function pollUnbiasedDeviceAuth(
	grant: UnbiasedDeviceGrant,
	options: DeviceAuthOptions = {},
): Promise<UnbiasedDeviceToken> {
	const { baseUrl = UNBIASED_PLATFORM_URL, clientId = UNBIASED_CLIENT_ID, fetcher = globalThis.fetch, signal } = options
	const expiresAt = Date.now() + grant.expiresIn * 1000
	let interval = Math.max(1, grant.interval)
	while (true) {
		if (signal?.aborted) throw new UnbiasedAuthError("cancelled")
		try {
			await sleep(interval * 1000, undefined, { signal })
		} catch {
			throw new UnbiasedAuthError("cancelled")
		}
		if (signal?.aborted) throw new UnbiasedAuthError("cancelled")
		if (Date.now() >= expiresAt) throw new UnbiasedAuthError("expired_token")
		let response: Awaited<ReturnType<typeof postDeviceAuth>>
		try {
			// Once dispatched, let the one-shot response finish even if the UI cancels.
			// Aborting a successful response before reading its body could lose an issued key.
			response = await postDeviceAuth(baseUrl, fetcher, "/api/oauth/token", {
				grant_type: GRANT_TYPE,
				device_code: grant.deviceCode,
				client_id: clientId,
			})
		} catch {
			throw new UnbiasedAuthError("connection_lost")
		}
		// A 200 may have issued a key even if cancellation raced with its response.
		// Keep and persist the key rather than discarding it after a successful poll.
		const body = response.body
		if (response.status === 200) {
			if (
				typeof body?.access_token !== "string" ||
				typeof body.organization_id !== "string" ||
				typeof body.workload_id !== "string" ||
				typeof body.workload_name !== "string" ||
				typeof body.key_name !== "string"
			)
				throw new UnbiasedAuthError("invalid_response")
			return {
				accessToken: body.access_token,
				organizationId: body.organization_id,
				workloadId: body.workload_id,
				workloadName: body.workload_name,
				keyName: body.key_name,
			}
		}
		const error = String(body?.error ?? response.status)
		if (error === "slow_down") {
			interval += 5
			continue
		}
		if (error === "authorization_pending" || error === "temporarily_unavailable") continue
		throw new UnbiasedAuthError(error)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/unbiased/oauth-account.ts (lines 14-19)
```
export function createUnbiasedOAuthAccount(token: UnbiasedDeviceToken) {
	return {
		unbiasedOAuthApiKeyHash: hashApiKey(token.accessToken),
		unbiasedOAuthWorkloadName: token.workloadName,
	}
}
```

### /Users/highlands/pools/Development/dirac/src/integrations/unbiased/oauth-account.ts (lines 9-11)
```
export function isUnbiasedOAuthApiKey(apiKey: string | undefined, oauthApiKeyHash: string | undefined): boolean {
	return !!apiKey && oauthApiKeyHash === hashApiKey(apiKey)
}
```


## Source Files:

- `src/integrations/unbiased/device-auth.ts`
- `src/integrations/unbiased/oauth-account.ts`

