import { AgentSideConnection, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { describe, expect, it } from "vitest"
import { createResilientNdJsonStream } from "./streamUtils.js"

describe("createResilientNdJsonStream", () => {
	it("continues serving valid requests after malformed and schema-invalid stdin frames", async () => {
		const inbound = new TransformStream<Uint8Array, Uint8Array>()
		const outputChunks: Uint8Array[] = []
		const outbound = new WritableStream<Uint8Array>({
			write(chunk) {
				outputChunks.push(chunk)
			},
		})
		const initialized = awaitableCounter()

		new AgentSideConnection(
			() => ({
				async initialize() {
					initialized.increment()
					return {
						protocolVersion: PROTOCOL_VERSION,
						agentCapabilities: {},
						agentInfo: { name: "test-agent", version: "1.0.0" },
					}
				},
				async newSession() {
					return { sessionId: "unused" }
				},
				async prompt() {
					return { stopReason: "end_turn" as const }
				},
				async cancel() {},
				async authenticate() {},
			}),
			createResilientNdJsonStream(outbound, inbound.readable),
		)

		const input = inbound.writable.getWriter()
		await input.write(new TextEncoder().encode("this is not JSON\n"))
		await input.write(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'))
		await input.write(
			new TextEncoder().encode(
				`{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":${PROTOCOL_VERSION},"clientCapabilities":{}}}\n`,
			),
		)

		await expect.poll(() => initialized.count()).toBe(1)
		await expect.poll(() => parseJsonFrames(outputChunks).length).toBe(2)
		const responses = parseJsonFrames(outputChunks)
		await input.close()

		expect(responses).toEqual([
			expect.objectContaining({ id: 1, error: expect.objectContaining({ code: -32602 }) }),
			expect.objectContaining({ id: 2, result: expect.objectContaining({ protocolVersion: PROTOCOL_VERSION }) }),
		])
		expect(initialized.count()).toBe(1)
	})
})

function awaitableCounter(): { increment(): void; count(): number } {
	let value = 0
	return {
		increment: () => value++,
		count: () => value,
	}
}

function parseJsonFrames(chunks: Uint8Array[]): unknown[] {
	const decoder = new TextDecoder()
	return decoder
		.decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line))
}
