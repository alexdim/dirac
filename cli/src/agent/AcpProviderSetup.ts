import { randomBytes } from "node:crypto"
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import type { ApiProvider } from "@shared/api"
import { ProviderToApiKeyMap, ProviderToBaseUrlKeyMap } from "@shared/storage"
import { configureApiKeyProvider } from "../utils/provider-config.js"
import { openUrlInBrowser } from "../utils/browser.js"
import { getDefaultModelId } from "../utils/model-metadata.js"
import { getProviderLabel, getValidCliProviders } from "../utils/providers.js"

const SETUP_TIMEOUT_MS = 10 * 60 * 1000
const MAX_REQUEST_BYTES = 32 * 1024

type ProviderOption = {
	id: string
	label: string
	defaultModel: string
	acceptsBaseUrl: boolean
}

function providerOptions(): ProviderOption[] {
	return getValidCliProviders()
		.filter((provider) => provider !== "bedrock" && ProviderToApiKeyMap[provider as ApiProvider])
		.map((provider) => ({
			id: provider,
			label: getProviderLabel(provider),
			defaultModel: getDefaultModelId(provider),
			acceptsBaseUrl: Boolean(ProviderToBaseUrlKeyMap[provider as ApiProvider]),
		}))
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

function setupPage(
	nonce: string,
	values: { provider?: string; modelId?: string; baseUrl?: string; azureApiVersion?: string } = {},
	errorMessage?: string,
): string {
	const providers = providerOptions()
	const selectedProvider = providers.find((provider) => provider.id === values.provider) ?? providers[0]
	const options = providers
		.map(
			(provider) =>
				`<option value="${escapeHtml(provider.id)}" data-model="${escapeHtml(provider.defaultModel)}" data-base-url="${provider.acceptsBaseUrl}"${provider.id === selectedProvider?.id ? " selected" : ""}>${escapeHtml(provider.label)}</option>`,
		)
		.join("")
	const initialModel = values.modelId ?? selectedProvider?.defaultModel ?? ""
	const error = errorMessage ? `<p role="alert" style="color:#b42318;font-weight:600">${escapeHtml(errorMessage)}</p>` : ""

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configure Dirac</title>
<style>
body{font:16px system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#171717}form{display:grid;gap:14px}label{display:grid;gap:6px;font-weight:600}input,select,button{font:inherit;padding:10px;border:1px solid #aaa;border-radius:6px}small{font-weight:400;color:#666}button{background:#171717;color:#fff;cursor:pointer}
</style>
</head>
<body>
<h1>Configure Dirac</h1>
<p>Choose an API provider. Credentials are submitted only to Dirac on this machine.</p>
${error}
<form method="post" action="/setup/${nonce}">
<input type="hidden" name="nonce" value="${nonce}">
<label>Provider<select id="provider" name="provider" required>${options}</select></label>
<label>API key<input name="apiKey" type="password" autocomplete="new-password" required></label>
<label>Model ID<input id="model" name="modelId" value="${escapeHtml(initialModel)}" required><small>Use the provider's exact model identifier.</small></label>
<label>Base URL <small>Optional; supported by compatible providers.</small><input id="baseUrl" name="baseUrl" type="url" value="${escapeHtml(values.baseUrl ?? "")}"></label>
<label>Azure API version <small>Optional; OpenAI-compatible Azure endpoints only.</small><input name="azureApiVersion" value="${escapeHtml(values.azureApiVersion ?? "")}"></label>
<button type="submit">Save provider</button>
</form>
<script>
const provider=document.getElementById("provider"),model=document.getElementById("model"),baseUrl=document.getElementById("baseUrl");
provider.addEventListener("change",()=>{const option=provider.selectedOptions[0];model.value=option.dataset.model||"";baseUrl.disabled=option.dataset.baseUrl!=="true";});
baseUrl.disabled=provider.selectedOptions[0].dataset.baseUrl!=="true";
</script>
</body>
</html>`
}

function resultPage(title: string, message: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font:16px system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
	response.writeHead(status, {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Security-Policy":
			"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
		Connection: "close",
	})
	response.end(body)
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
	let body = ""
	for await (const chunk of request) {
		body += chunk
		if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error("Provider setup request is too large")
	}
	return body
}

async function listenOnLoopback(server: Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject)
			resolve()
		})
	})
	return (server.address() as AddressInfo).port
}

async function closeServer(server: Server): Promise<void> {
	if (!server.listening) return
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

export class AcpProviderSetup {
	private server?: Server
	private settle?: { resolve: () => void; reject: (error: Error) => void }
	private submissionStarted = false

	async authenticate(): Promise<void> {
		if (this.server) throw new Error("Dirac provider setup is already in progress")
		this.submissionStarted = false

		const nonce = randomBytes(24).toString("base64url")
		const path = `/setup/${nonce}`
		const server = http.createServer((request, response) => {
			void this.handleRequest(request, response, path, nonce)
		})
		this.server = server
		const completion = new Promise<void>((resolve, reject) => {
			this.settle = { resolve, reject }
		})
		const timeout = setTimeout(() => this.settleActiveSetup(new Error("Dirac provider setup timed out")), SETUP_TIMEOUT_MS)

		try {
			const port = await listenOnLoopback(server)
			await openUrlInBrowser(`http://127.0.0.1:${port}${path}`)
			await completion
		} finally {
			clearTimeout(timeout)
			this.settle = undefined
			this.submissionStarted = false
			this.server = undefined
			await closeServer(server)
		}
	}

	cancel(): void {
		this.settleActiveSetup(new Error("Dirac provider setup was cancelled"))
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse, path: string, nonce: string): Promise<void> {
		if (request.url !== path) {
			sendHtml(response, 404, resultPage("Not found", "This Dirac provider setup link is not valid."))
			return
		}
		if (request.method === "GET") {
			sendHtml(response, 200, setupPage(nonce))
			return
		}
		if (request.method !== "POST") {
			sendHtml(response, 405, resultPage("Method not allowed", "Use the provider setup form."))
			return
		}

		let form: URLSearchParams
		try {
			form = new URLSearchParams(await readRequestBody(request))
		} catch (error) {
			const failure = error instanceof Error ? error : new Error(String(error))
			sendHtml(response, 400, setupPage(nonce, {}, failure.message))
			return
		}
		if (form.get("nonce") !== nonce) {
			sendHtml(response, 400, setupPage(nonce, {}, "Provider setup session is invalid"))
			return
		}
		if (this.submissionStarted) {
			sendHtml(response, 409, resultPage("Provider setup in progress", "Wait for the current submission to finish."))
			return
		}

		const values = {
			provider: form.get("provider") ?? "",
			modelId: form.get("modelId") ?? "",
			baseUrl: form.get("baseUrl") || undefined,
			azureApiVersion: form.get("azureApiVersion") || undefined,
		}
		this.submissionStarted = true
		try {
			await configureApiKeyProvider({
				...values,
				apiKey: form.get("apiKey") ?? "",
			})
			sendHtml(response, 200, resultPage("Dirac is configured", "Return to your ACP client to continue."))
			this.settleActiveSetup()
		} catch (error) {
			this.submissionStarted = false
			const failure = error instanceof Error ? error : new Error(String(error))
			sendHtml(response, 400, setupPage(nonce, values, failure.message))
		}
	}

	private settleActiveSetup(error?: Error): void {
		const settle = this.settle
		this.settle = undefined
		if (!settle) return
		if (error) settle.reject(error)
		else settle.resolve()
	}
}
