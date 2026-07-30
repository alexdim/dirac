import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { ApiConversationManager } from "../ApiConversationManager"
import { TaskState } from "../TaskState"

describe("ApiConversationManager steering delivery", () => {
	it("does not consume steering before the provider dispatch boundary", async () => {
		const claimSteeringMessages = sinon.stub()
		const dependencies: any = {
			taskState: new TaskState(),
			stateManager: { getGlobalSettingsKey: sinon.stub() },
			runUserPromptSubmitHook: sinon.stub().resolves({}),
			loadContext: sinon.stub().callsFake(async (content: any[]) => [content, "", false, [], false, undefined]),
			claimSteeringMessages,
			taskMessenger: { upsertApiStatus: sinon.stub().resolves(), createCard: sinon.stub() },
			messageStateHandler: {
				addToApiConversationHistory: sinon.stub().resolves(),
				getDiracMessages: sinon.stub().returns([]),
				updateDiracMessage: sinon.stub().resolves(),
			},
			postStateToWebview: sinon.stub().resolves(),
			onContextCompacted: sinon.stub(),
			taskInitializationStartTime: performance.now(),
			ulid: "task-ulid",
			taskId: "task-id",
		}
		const manager = new ApiConversationManager(dependencies)

		const result = await manager.prepareApiRequest({
			userContent: [],
			shouldCompact: false,
			includeFileDetails: false,
			useCompactPrompt: false,
			previousApiReqIndex: 0,
			isFirstRequest: false,
			providerId: "provider",
			modelId: "model",
			mode: "act",
		})

		assert.equal(claimSteeringMessages.callCount, 0)
		assert.equal(
			result.userContent.some((block: any) => block.text?.includes("<steering_messages>")),
			false,
		)
	})

	describe("provider-native conversation compaction", () => {
		function createCompactionDependencies() {
			const taskState = new TaskState()
			const history: any[] = [
				{ role: "user", content: "old question" },
				{ role: "assistant", content: "condense call", id: "resp_old", modelInfo: { providerId: "openai-codex", modelId: "model" } },
				{ role: "user", content: "condense result" },
			]
			let providerState: any = {}
			const compactConversation = sinon.stub().resolves({ input: [{ type: "compaction", encrypted_content: "opaque" }] })
			const dependencies: any = {
				taskState,
				api: { compactConversation },
				contextManager: {
					getTruncatedMessages: sinon.stub().callsFake((messages: any[]) => messages),
					getNextTruncationRange: sinon.stub().returns([0, 1]),
					shouldCompactContextWindow: sinon.stub().returns(false),
				},
				messageStateHandler: {
					getApiConversationHistory: () => history,
					getApiConversationProviderState: () => providerState,
					overwriteApiConversationProviderState: sinon.stub().callsFake(async (state: any) => {
						providerState = state
					}),
					getDiracMessages: sinon.stub().returns([]),
					saveDiracMessagesAndUpdateHistory: sinon.stub().resolves(),
				},
				stateManager: { getGlobalSettingsKey: sinon.stub() },
				getCurrentProviderInfo: () => ({ providerId: "openai-codex" }),
			}
			return { dependencies, history, compactConversation, getProviderState: () => providerState }
		}

		it("installs a checkpoint after the condense result is in API history", async () => {
			const { dependencies, history, compactConversation, getProviderState } = createCompactionDependencies()
			dependencies.taskState.pendingApiConversationCompaction = {
				conversationHistoryDeletedRange: [0, 1],
			}
			const dispatch = await new ApiConversationManager(dependencies).prepareProviderConversationDispatch({
				systemPrompt: "system",
				tools: [],
				truncatedMessages: history,
				providerId: "openai-codex",
				modelId: "model",
			})

			compactConversation.firstCall.args[0].messages.should.deepEqual(history)
			getProviderState().checkpoint.compactedThroughHistoryIndex.should.equal(2)
			dispatch.messages.should.deepEqual([])
			assert.equal(dispatch.options.breakProviderContinuation, true)
			assert.equal(dependencies.taskState.pendingApiConversationCompaction, undefined)
		})

		it("falls back to plaintext truncation and breaks stale continuation", async () => {
			const { dependencies, compactConversation, getProviderState } = createCompactionDependencies()
			compactConversation.rejects(new Error("compact unavailable"))
			dependencies.taskState.pendingApiConversationCompaction = {
				conversationHistoryDeletedRange: [0, 1],
			}
			const localHistory = [{ role: "user", content: "summary" }] as any
			dependencies.contextManager.getTruncatedMessages.returns(localHistory)
			const dispatch = await new ApiConversationManager(dependencies).prepareProviderConversationDispatch({
				systemPrompt: "system",
				tools: [],
				truncatedMessages: localHistory,
				providerId: "openai-codex",
				modelId: "model",
			})

			dispatch.messages.should.deepEqual(localHistory)
			assert.equal(dispatch.options.breakProviderContinuation, true)
			assert.equal(getProviderState().checkpoint, undefined)
		})

		it("uses the openai-codex-specific auto-condense threshold", async () => {
			const { dependencies } = createCompactionDependencies()
			dependencies.stateManager.getGlobalSettingsKey.callsFake((key: string) => {
				if (key === "useAutoCondense") return true
				if (key === "autoCondenseContextLimits") return { "openai-codex": 123456 }
				return undefined
			})
			dependencies.contextManager.shouldCompactContextWindow.returns(true)

			await new ApiConversationManager(dependencies).determineContextCompaction(4)

			dependencies.contextManager.shouldCompactContextWindow.firstCall.args[3].should.equal(123456)
		})

		it("recompacts the active checkpoint plus only its post-checkpoint suffix", async () => {
			const { dependencies, history, compactConversation, getProviderState } = createCompactionDependencies()
			const priorCheckpoint = {
				providerId: "openai-codex",
				modelId: "model",
				compactedThroughHistoryIndex: 0,
				input: [{ type: "compaction", encrypted_content: "prior-opaque" }],
			}
			getProviderState().checkpoint = priorCheckpoint
			dependencies.taskState.pendingApiConversationCompaction = {
				conversationHistoryDeletedRange: [0, 1],
			}

			await new ApiConversationManager(dependencies).prepareProviderConversationDispatch({
				systemPrompt: "system",
				tools: [],
				truncatedMessages: history,
				providerId: "openai-codex",
				modelId: "model",
			})

			compactConversation.firstCall.args[0].checkpoint.should.equal(priorCheckpoint)
			compactConversation.firstCall.args[0].messages.should.deepEqual(history.slice(1))
		})

		it("schedules provider compaction after emergency plaintext truncation", async () => {
			const { dependencies } = createCompactionDependencies()
			dependencies.taskState.conversationHistoryDeletedRange = [0, 0]
			dependencies.contextManager.getNextTruncationRange.returns([0, 1])

			await new ApiConversationManager(dependencies).handleContextWindowExceededError()

			assert.deepEqual(dependencies.taskState.pendingApiConversationCompaction, {
				conversationHistoryDeletedRange: [0, 1],
				previousConversationHistoryDeletedRange: [0, 0],
			})
			assert.deepEqual(getProviderState().pendingCompaction, {
				conversationHistoryDeletedRange: [0, 1],
				previousConversationHistoryDeletedRange: [0, 0],
			})
		})

		it("resumes a persisted pending compaction after restart", async () => {
			const { dependencies, compactConversation, getProviderState } = createCompactionDependencies()
			getProviderState().pendingCompaction = {
				conversationHistoryDeletedRange: [0, 1],
				previousConversationHistoryDeletedRange: [0, 0],
			}

			await new ApiConversationManager(dependencies).prepareProviderConversationDispatch({
				systemPrompt: "system",
				tools: [],
				truncatedMessages: [],
				providerId: "openai-codex",
				modelId: "model",
			})

			assert.equal(compactConversation.callCount, 1)
			assert.equal(getProviderState().pendingCompaction, undefined)
		})


		it("restores the persisted target truncation range before plaintext fallback", async () => {
			const { dependencies, getProviderState } = createCompactionDependencies()
			const targetMessages = [{ role: "user", content: "retained summary" }] as any
			dependencies.api = {}
			dependencies.taskState.conversationHistoryDeletedRange = [0, 0]
			dependencies.contextManager.getTruncatedMessages.returns(targetMessages)
			getProviderState().pendingCompaction = {
				conversationHistoryDeletedRange: [1, 2],
				previousConversationHistoryDeletedRange: [0, 0],
			}

			const dispatch = await new ApiConversationManager(dependencies).prepareProviderConversationDispatch({
				systemPrompt: "system",
				tools: [],
				truncatedMessages: [{ role: "user", content: "stale range" }] as any,
				providerId: "openai-codex",
				modelId: "model",
			})

			assert.deepEqual(dependencies.taskState.conversationHistoryDeletedRange, [1, 2])
			assert.deepEqual(dispatch.messages, targetMessages)
			assert.equal(dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory.callCount, 1)
			assert.equal(getProviderState().pendingCompaction, undefined)
		})


		it("propagates cancellation without consuming pending compaction", async () => {
			const { dependencies, compactConversation } = createCompactionDependencies()
			const abortError = new Error("aborted")
			compactConversation.callsFake(async () => {
				dependencies.taskState.abort = true
				throw abortError
			})
			dependencies.taskState.pendingApiConversationCompaction = {
				conversationHistoryDeletedRange: [0, 1],
			}

			await assert.rejects(
				new ApiConversationManager(dependencies).prepareProviderConversationDispatch({
					systemPrompt: "system",
					tools: [],
					truncatedMessages: [],
					providerId: "openai-codex",
					modelId: "model",
				}),
				(error) => error === abortError,
			)

			assert.notEqual(dependencies.taskState.pendingApiConversationCompaction, undefined)
			assert.equal(dependencies.messageStateHandler.overwriteApiConversationProviderState.callCount, 0)
		})


		it("propagates cancellation that occurs while compacted state is persisted", async () => {
			const { dependencies } = createCompactionDependencies()
			dependencies.taskState.pendingApiConversationCompaction = {
				conversationHistoryDeletedRange: [0, 1],
			}
			dependencies.messageStateHandler.overwriteApiConversationProviderState.callsFake(async () => {
				dependencies.taskState.abort = true
			})

			await assert.rejects(
				new ApiConversationManager(dependencies).prepareProviderConversationDispatch({
					systemPrompt: "system",
					tools: [],
					truncatedMessages: [],
					providerId: "openai-codex",
					modelId: "model",
				}),
				/Task instance aborted/,
			)
		})


		it("skips the pre-condense token sample once after a successful condense", async () => {
			const { dependencies } = createCompactionDependencies()
			dependencies.stateManager.getGlobalSettingsKey.withArgs("useAutoCondense").returns(true)
			dependencies.taskState.skipNextAutoCondenseCheck = true

			const shouldCompact = await new ApiConversationManager(dependencies).determineContextCompaction(4)

			assert.equal(shouldCompact, false)
			assert.equal(dependencies.taskState.skipNextAutoCondenseCheck, false)
			assert.equal(dependencies.contextManager.shouldCompactContextWindow.callCount, 0)
		})

	})

})
