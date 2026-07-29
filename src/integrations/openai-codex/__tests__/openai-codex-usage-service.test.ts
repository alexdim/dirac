import { describe, it } from "mocha"
import sinon from "sinon"
import "should"
import { OpenAiCodexUsageService } from "../OpenAiCodexUsageService"

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	})
}

function usagePayload(usedPercent = 25) {
	return {
		plan_type: "plus",
		rate_limit: {
			allowed: true,
			limit_reached: false,
			primary_window: {
				used_percent: usedPercent,
				limit_window_seconds: 18_000,
				reset_after_seconds: 3_600,
				reset_at: 2_000_000_000,
			},
		},
		credits: { has_credits: true, unlimited: false, balance: "12.50" },
	}
}

function activityPayload(lifetimeTokens = 1234) {
	return {
		stats: {
			lifetime_tokens: lifetimeTokens,
			peak_daily_tokens: 500,
			daily_usage_buckets: [{ start_date: "2026-07-28", tokens: 200 }],
		},
	}
}

function createOAuthManager(overrides: Partial<{
	getAccessToken: () => Promise<string | null>
	forceRefreshAccessToken: () => Promise<string | null>
	getAccountId: () => Promise<string | null>
}> = {}) {
	return {
		getAccessToken: overrides.getAccessToken ?? sinon.stub().resolves("access-token"),
		forceRefreshAccessToken: overrides.forceRefreshAccessToken ?? sinon.stub().resolves("refreshed-token"),
		getAccountId: overrides.getAccountId ?? sinon.stub().resolves("account-123"),
	}
}

describe("OpenAiCodexUsageService", () => {
	it("fetches quota and activity with ChatGPT OAuth headers", async () => {
		const fetchStub = sinon.stub()
		fetchStub.onFirstCall().resolves(jsonResponse(usagePayload()))
		fetchStub.onSecondCall().resolves(jsonResponse(activityPayload()))
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager(),
			now: () => 1_700_000_000_000,
		})

		const snapshot = await service.refresh({ force: true })

		snapshot.planType!.should.equal("plus")
		snapshot.activity!.lifetimeTokens!.should.equal(1234)
		fetchStub.callCount.should.equal(2)
		fetchStub.firstCall.args[0].should.equal("https://chatgpt.com/backend-api/wham/usage")
		fetchStub.secondCall.args[0].should.equal("https://chatgpt.com/backend-api/wham/profiles/me")
		for (const call of [fetchStub.firstCall, fetchStub.secondCall]) {
			const init = call.args[1] as RequestInit
			init.method!.should.equal("GET")
			const headers = init.headers as Record<string, string>
			headers.Authorization.should.equal("Bearer access-token")
			headers["ChatGPT-Account-Id"].should.equal("account-123")
			headers.originator.should.equal("dirac")
			headers["User-Agent"].should.be.a.String()
		}
	})

	it("omits the account header when the OAuth credentials have no account id", async () => {
		const fetchStub = sinon.stub()
		fetchStub.onFirstCall().resolves(jsonResponse(usagePayload()))
		fetchStub.onSecondCall().resolves(jsonResponse(activityPayload()))
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager({ getAccountId: sinon.stub().resolves(null) }),
		})

		await service.refresh({ force: true })

		const headers = fetchStub.firstCall.args[1].headers as Record<string, string>
		should(headers["ChatGPT-Account-Id"]).be.undefined()
	})

	it("de-duplicates concurrent refreshes", async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const fetchStub = sinon.stub().callsFake(async (url: string) => {
			await gate
			return url.endsWith("/usage") ? jsonResponse(usagePayload()) : jsonResponse(activityPayload())
		})
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager(),
		})

		const first = service.refresh({ force: true })
		const second = service.refresh({ force: true })
		;(first === second).should.be.true()
		release()
		await Promise.all([first, second])
		fetchStub.callCount.should.equal(2)
	})

	it("uses the short freshness cache unless a refresh is forced", async () => {
		let now = 10_000
		const fetchStub = sinon.stub().callsFake(async (url: string) =>
			url.endsWith("/usage") ? jsonResponse(usagePayload()) : jsonResponse(activityPayload()),
		)
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager(),
			now: () => now,
			refreshCacheMs: 60_000,
		})

		await service.refresh()
		now += 30_000
		await service.refresh()
		fetchStub.callCount.should.equal(2)
		await service.refresh({ force: true })
		fetchStub.callCount.should.equal(4)
	})

	it("retains last-known-good quota when only quota refresh fails", async () => {
		const fetchStub = sinon.stub()
		fetchStub.onCall(0).resolves(jsonResponse(usagePayload(20)))
		fetchStub.onCall(1).resolves(jsonResponse(activityPayload(100)))
		fetchStub.onCall(2).resolves(jsonResponse({ error: "temporarily unavailable" }, 503))
		fetchStub.onCall(3).resolves(jsonResponse(activityPayload(200)))
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager(),
		})

		const initial = await service.refresh({ force: true })
		const updated = await service.refresh({ force: true })

		updated.rateLimits.should.deepEqual(initial.rateLimits)
		updated.quotaFetchedAt!.should.equal(initial.quotaFetchedAt!)
		updated.quotaError!.should.match(/HTTP 503/)
		updated.activity!.lifetimeTokens!.should.equal(200)
		should(updated.activityError).be.undefined()
	})

	it("retains last-known-good activity when only activity refresh fails", async () => {
		const fetchStub = sinon.stub()
		fetchStub.onCall(0).resolves(jsonResponse(usagePayload(20)))
		fetchStub.onCall(1).resolves(jsonResponse(activityPayload(100)))
		fetchStub.onCall(2).resolves(jsonResponse(usagePayload(40)))
		fetchStub.onCall(3).rejects(new Error("activity network unavailable"))
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager(),
		})

		const initial = await service.refresh({ force: true })
		const updated = await service.refresh({ force: true })

		updated.activity!.should.deepEqual(initial.activity!)
		updated.activityFetchedAt!.should.equal(initial.activityFetchedAt!)
		updated.activityError!.should.equal("activity network unavailable")
		updated.rateLimits.should.not.deepEqual(initial.rateLimits)
		should(updated.quotaError).be.undefined()
	})

	it("retries unauthorized endpoint requests once with a forced token refresh", async () => {
		const fetchStub = sinon.stub()
		fetchStub.onCall(0).resolves(jsonResponse({ error: "unauthorized" }, 401))
		fetchStub.onCall(1).resolves(jsonResponse({ error: "unauthorized" }, 401))
		fetchStub.onCall(2).resolves(jsonResponse(usagePayload()))
		fetchStub.onCall(3).resolves(jsonResponse(activityPayload()))
		const forceRefreshAccessToken = sinon.stub().resolves("refreshed-token")
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager({ forceRefreshAccessToken }),
		})

		await service.refresh({ force: true })

		sinon.assert.calledOnce(forceRefreshAccessToken)
		fetchStub.callCount.should.equal(4)
		for (const callIndex of [2, 3]) {
			const headers = fetchStub.getCall(callIndex).args[1].headers as Record<string, string>
			headers.Authorization.should.equal("Bearer refreshed-token")
		}
	})

	it("throws a calm authentication error without making requests when no token exists", async () => {
		const fetchStub = sinon.stub()
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager({ getAccessToken: sinon.stub().resolves(null) }),
		})

		await service.refresh({ force: true }).should.be.rejectedWith(/after signing in with ChatGPT/)
		sinon.assert.notCalled(fetchStub)
	})

	it("notifies subscribers on refresh and clear, and supports unsubscribe", async () => {
		const fetchStub = sinon.stub().callsFake(async (url: string) =>
			url.endsWith("/usage") ? jsonResponse(usagePayload()) : jsonResponse(activityPayload()),
		)
		const service = new OpenAiCodexUsageService({
			fetch: fetchStub as unknown as typeof globalThis.fetch,
			oauthManager: createOAuthManager(),
		})
		const listener = sinon.spy()
		const unsubscribe = service.subscribe(listener)

		await service.refresh({ force: true })
		listener.callCount.should.equal(1)
		service.clear()
		listener.callCount.should.equal(2)
		should(listener.secondCall.args[0]).be.undefined()
		unsubscribe()
		await service.refresh({ force: true })
		listener.callCount.should.equal(2)
	})
})
