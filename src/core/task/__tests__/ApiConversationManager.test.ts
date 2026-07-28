import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { ApiConversationManager } from "../ApiConversationManager"
import { SteeringDeliveryState } from "../steering"
import { TaskState } from "../TaskState"

describe("ApiConversationManager steering delivery", () => {
	it("leaves steering unclaimed during automatic compaction and claims it on the next working turn", async () => {
		const taskState = new TaskState()
		const claim = {
			id: "claim-1",
			messages: [
				{
					id: "steering-1",
					text: "Use the enum helper",
					createdAt: 1,
					transcriptMessageId: "transcript-1",
					deliveryState: SteeringDeliveryState.CLAIMED,
				},
			],
		}
		const claimSteeringMessages = sinon.stub().resolves(claim)
		const commitSteeringClaim = sinon.stub().resolves()
		const dependencies: any = {
			taskState,
			stateManager: { getGlobalSettingsKey: sinon.stub() },
			runUserPromptSubmitHook: sinon.stub().resolves({}),
			loadContext: sinon.stub().callsFake(async (content: any[]) => [content, "", false, [], false, undefined]),
			claimSteeringMessages,
			commitSteeringClaim,
			rollbackSteeringClaim: sinon.stub().resolves(),
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
		const baseParams = {
			userContent: [] as any[],
			includeFileDetails: false,
			useCompactPrompt: false,
			previousApiReqIndex: 0,
			isFirstRequest: false,
			providerId: "provider",
			modelId: "model",
			mode: "act",
		}

		await manager.prepareApiRequest({ ...baseParams, shouldCompact: true })
		assert.equal(claimSteeringMessages.callCount, 0)
		assert.equal(commitSteeringClaim.callCount, 0)

		const result = await manager.prepareApiRequest({ ...baseParams, shouldCompact: false })
		assert.equal(claimSteeringMessages.callCount, 1)
		assert.equal(commitSteeringClaim.calledOnceWithExactly(claim.id), true)
		assert.equal(
			result.userContent.some(
				(block: any) => block.type === "text" && block.text.includes("<steering_message>Use the enum helper</steering_message>"),
			),
			true,
		)
	})
})
