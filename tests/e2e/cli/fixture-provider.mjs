import { once } from "node:events"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"

export const LONG_RESPONSE = Array.from(
	{ length: 80 },
	(_, index) => `Response line ${String(index + 1).padStart(2, "0")}: deterministic CLI scrolling fixture.`,
).join("\n")

export const LONG_PLAN = Array.from(
	{ length: 80 },
	(_, index) => `Plan line ${String(index + 1).padStart(2, "0")}: deterministic CLI scrolling fixture.`,
).join("\n")

export const MARKDOWN_PLAN = [
	"Markdown plan start.",
	...Array.from({ length: 3 }, (_, block) => [
		"```text",
		...Array.from({ length: 24 }, (_, line) => `Code ${block + 1}.${String(line + 1).padStart(2, "0")}: **literal**`),
		"```",
		`**Prose between blocks ${block + 1} and ${block + 2}.**`,
		"",
	]).flat(),
	"Markdown plan end.",
].join("\n")

export const CREATE_FILE_PATH =
	"src/features/permission-dialog/regressions/long-directory-name-for-file-creation/a-very-long-file-name-that-must-remain-readable-in-the-permission-prompt.txt"
export const CREATE_FILE_CONTENT = "Permission prompt regression fixture.\n"

/** Deterministic tool calls; all UI, provider parsing, task execution and storage remain real. */
export async function startFixtureProvider(home, scenario = "long-response") {
	if (!["long-response", "long-plan", "markdown-plan", "create-file"].includes(scenario)) {
		throw new Error(`Unknown fixture: ${scenario}`)
	}
	let requests = 0
	const server = createServer(async (request, response) => {
		try {
			if (request.method === "GET" && request.url === "/v1/models") {
				response.setHeader("content-type", "application/json")
				response.end(JSON.stringify({ object: "list", data: [{ id: "tui-fixture", object: "model" }] }))
				return
			}
			if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
				response.writeHead(404).end("Unsupported fixture endpoint")
				return
			}
			let body = ""
			for await (const chunk of request) body += chunk
			const completion = JSON.parse(body)
			const createFile = scenario === "create-file" && requests === 0
			const toolName = createFile ? "write_to_file" : "respond"
			const tool = completion.tools?.find((candidate) => candidate.function?.name === toolName)
			if (!tool) throw new Error(`Fixture requires the native ${toolName} tool`)
			const args = createFile
				? { path: CREATE_FILE_PATH, content: CREATE_FILE_CONTENT }
				: {
						operation: scenario === "long-plan" || scenario === "markdown-plan" ? "plan" : "complete",
						text:
							scenario === "markdown-plan"
								? MARKDOWN_PLAN
								: scenario === "long-plan"
									? LONG_PLAN
									: scenario === "create-file"
										? "File creation fixture completed."
										: LONG_RESPONSE,
					}
			requests++
			const chunk = (delta, finishReason = null) => ({
				id: `tui-completion-${requests}`,
				object: "chat.completion.chunk",
				created: 0,
				model: "tui-fixture",
				choices: [{ index: 0, delta, finish_reason: finishReason }],
			})
			response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
			response.write(
				`data: ${JSON.stringify(
					chunk({
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: `tui-tool-${requests}`,
								type: "function",
								function: {
									name: toolName,
									arguments: JSON.stringify(args),
								},
							},
						],
					}),
				)}\n\n`,
			)
			response.write(`data: ${JSON.stringify(chunk({}, "tool_calls"))}\n\n`)
			response.write(
				`data: ${JSON.stringify({ ...chunk({}), choices: [], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } })}\n\n`,
			)
			response.end("data: [DONE]\n\n")
		} catch (error) {
			response
				.writeHead(500, { "content-type": "application/json" })
				.end(JSON.stringify({ error: { message: error.message } }))
		}
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
	const dataDir = path.join(home, "data")
	await mkdir(dataDir, { recursive: true })
	await writeFile(
		path.join(dataDir, "globalState.json"),
		JSON.stringify({
			welcomeViewCompleted: true,
			isNewUser: false,
			mode: "act",
			actModeApiProvider: "openai",
			planModeApiProvider: "openai",
			actModeOpenAiModelId: "tui-fixture",
			planModeOpenAiModelId: "tui-fixture",
			openAiBaseUrl: baseUrl,
			telemetrySetting: "disabled",
			openTelemetryEnabled: false,
			doubleCheckCompletionEnabled: false,
			utilityModelUseCases: { condense: false, approval: false, earlyExit: false },
			cliTerminalColorMode: "dark",
		}),
	)
	await writeFile(path.join(dataDir, "secrets.json"), JSON.stringify({ openAiApiKey: "local-tui-fixture" }), { mode: 0o600 })
	return {
		baseUrl,
		get requests() {
			return requests
		},
		async stop() {
			server.closeAllConnections()
			await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		},
	}
}
