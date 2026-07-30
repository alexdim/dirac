import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { getSavedApiConversationProviderState, saveApiConversationProviderState } from "../disk"

describe("API conversation provider state persistence", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-api-provider-state-"))
		setVscodeHostProviderMock({ globalStorageFsPath: tempDir })
	})

	afterEach(async () => {
		HostProvider.reset()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("round-trips an opaque compact checkpoint without altering native items", async () => {
		const taskId = "task-1"
		const state = {
			checkpoint: {
				providerId: "openai-codex",
				modelId: "gpt-5.6-terra",
				compactedThroughHistoryIndex: 42,
				input: [
					{ role: "user", content: [{ type: "input_text", text: "retained" }] },
					{ id: "cmp_1", type: "compaction", encrypted_content: "opaque-encrypted-content" },
				],
			},
			pendingCompaction: {
				conversationHistoryDeletedRange: [13, 20] as [number, number],
				previousConversationHistoryDeletedRange: [4, 12] as [number, number],
			},
			continuationReset: {
				providerId: "openai-codex",
				modelId: "gpt-5.6-terra",
				compactedThroughHistoryIndex: 42,
			},
		}

		await saveApiConversationProviderState(taskId, state)
		const restored = await getSavedApiConversationProviderState(taskId)

		restored.should.deepEqual(state)
	})
})
