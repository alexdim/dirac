import { strict as assert } from "node:assert"
import type { ApiHandler } from "@core/api"
import type { ApiStream, ApiStreamChunk } from "@core/api/transform/stream"
import type { ModelProviderSelection } from "@shared/api"
import type { DiracStorageMessage } from "@shared/messages/content"
import type { DiracTool } from "@shared/tools"
import { describe, it } from "mocha"
import { UtilityModelCancelledError, UtilityModelRunner } from "../UtilityModelRunner"

const selection: ModelProviderSelection = {
	provider: "openai",
	modelId: "utility-model",
}

function streamChunks(chunks: ApiStreamChunk[]): ApiStream {
	return (async function* () {
		for (const chunk of chunks) yield chunk
	})()
}

function fakeHandler(createMessage: ApiHandler["createMessage"], abort?: () => void, modelId = "utility-model"): ApiHandler {
	return {
		createMessage,
		abort,
		getModel: () => ({ id: modelId, info: { supportsPromptCache: false } }),
	}
}

describe("UtilityModelRunner", () => {
	it("builds its independent handler lazily and forwards the exact request without executing tool calls", async () => {
		let handlerBuilds = 0
		const calls: Parameters<ApiHandler["createMessage"]>[] = []
		const tools = [{ name: "future-caller-tool" }] as unknown as DiracTool[]
		const messages = [] as DiracStorageMessage[]
		const toolCall: ApiStreamChunk = {
			type: "tool_calls",
			tool_call: { function: { name: "future-caller-tool", arguments: "{}" } },
		}
		const runner = new UtilityModelRunner(selection, () => {
			handlerBuilds++
			return fakeHandler((...args) => {
				calls.push(args)
				return streamChunks([{ type: "text", text: "result" }, { type: "reasoning", reasoning: "trace" }, toolCall])
			})
		})

		const stream = runner.run({ systemPrompt: "trusted prompt", messages, tools })
		assert.equal(handlerBuilds, 0)

		const chunks: ApiStreamChunk[] = []
		for await (const chunk of stream) chunks.push(chunk)

		assert.equal(handlerBuilds, 1)
		assert.equal(calls.length, 1)
		assert.equal(calls[0][0], "trusted prompt")
		assert.equal(calls[0][1], messages)
		assert.equal(calls[0][2], tools)
		assert.deepEqual(chunks, [{ type: "text", text: "result" }, { type: "reasoning", reasoning: "trace" }, toolCall])
	})

	it("publishes usage separately from the active API stream", async () => {
		const usages: number[] = []
		const runner = new UtilityModelRunner(
			selection,
			() =>
				fakeHandler(() =>
					streamChunks([
						{ type: "usage", inputTokens: 11, outputTokens: 7 },
						{ type: "text", text: "result" },
					]),
				),
			{ onUsage: ({ usage }) => usages.push(usage.totalCost ?? usage.inputTokens + usage.outputTokens) },
		)

		const chunks: ApiStreamChunk[] = []
		for await (const chunk of runner.run({ systemPrompt: "prompt", messages: [] })) chunks.push(chunk)

		assert.deepEqual(usages, [18])
		assert.equal(chunks[0].type, "usage")
	})

	it("publishes the model resolved by the handler after a successful request", async () => {
		const resolvedModels: string[] = []
		const runner = new UtilityModelRunner(
			selection,
			() => fakeHandler(() => streamChunks([{ type: "text", text: "result" }]), undefined, "resolved-utility-model"),
			{
				onModelResolved: ({ selection: resolvedSelection, modelId }) => {
					assert.equal(resolvedSelection, selection)
					resolvedModels.push(modelId)
				},
			},
		)

		for await (const _chunk of runner.run({ systemPrompt: "prompt", messages: [] })) {
			// Consume the complete request.
		}

		assert.deepEqual(resolvedModels, ["resolved-utility-model"])
	})

	it("does not construct a handler for a pre-aborted request", async () => {
		const controller = new AbortController()
		controller.abort()
		let handlerBuilds = 0
		const runner = new UtilityModelRunner(selection, () => {
			handlerBuilds++
			return fakeHandler(() => streamChunks([]))
		})

		await assert.rejects(
			async () => {
				for await (const _chunk of runner.run({ systemPrompt: "prompt", messages: [], signal: controller.signal })) {
					// The request must fail before producing a chunk.
				}
			},
			UtilityModelCancelledError,
		)
		assert.equal(handlerBuilds, 0)
	})

	it("aborts the handler and stops yielding when cancelled mid-stream", async () => {
		const controller = new AbortController()
		let aborts = 0
		const runner = new UtilityModelRunner(selection, () =>
			fakeHandler(() => streamChunks([{ type: "text", text: "first" }, { type: "text", text: "second" }]), () => {
				aborts++
			}),
		)

		const stream = runner.run({ systemPrompt: "prompt", messages: [], signal: controller.signal })
		assert.deepEqual(await stream.next(), { value: { type: "text", text: "first" }, done: false })
		controller.abort()

		await assert.rejects(() => stream.next(), UtilityModelCancelledError)
		assert.equal(aborts, 1)
	})

	it("does not retry or hide a provider failure", async () => {
		let calls = 0
		const providerFailure = new Error("provider failed")
		const runner = new UtilityModelRunner(selection, () =>
			fakeHandler(() => {
				calls++
				return (async function* (): ApiStream {
					throw providerFailure
				})()
			}),
		)

		await assert.rejects(
			async () => {
				for await (const _chunk of runner.run({ systemPrompt: "prompt", messages: [] })) {
					// The provider always fails.
				}
			},
			providerFailure,
		)
		assert.equal(calls, 1)
	})
})
