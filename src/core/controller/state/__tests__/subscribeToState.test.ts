import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { EmptyRequest } from "@shared/proto/dirac/common"
import type { ExtensionState } from "@shared/ExtensionMessage"
import type { Controller } from "../../index"
import { getRequestRegistry } from "../../grpc-handler"
import { sendStateUpdate, subscribeToState } from "../subscribeToState"

describe("subscribeToState", () => {
	it("hydrates through the ordered publisher and forwards its sequence number", async () => {
		const requestId = "ordered-state-subscription"
		const receivedSequences: number[] = []
		const state = { version: "test" } as ExtensionState
		const controller = {
			postStateToWebview: async () => {
				await sendStateUpdate(state, 42)
			},
		} as Controller

		try {
			await subscribeToState(
				controller,
				EmptyRequest.create(),
				async (_response, _isLast, sequenceNumber) => {
					receivedSequences.push(sequenceNumber ?? -1)
				},
				requestId,
			)

			assert.deepEqual(receivedSequences, [42])
		} finally {
			getRequestRegistry().cancelRequest(requestId)
		}
	})
})
