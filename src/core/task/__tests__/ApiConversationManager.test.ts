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
})
