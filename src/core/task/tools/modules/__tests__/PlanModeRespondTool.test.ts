import { strict as assert } from "node:assert"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { CardStatus } from "@shared/ExtensionMessage"
import { PlanModeRespondTool } from "../plan_mode_respond/PlanModeRespondTool"
import { ToolSkippedByUserMessage } from "../../types/ToolSkippedByUserMessage"

function createMocks(mode: "plan" | "act") {
	const card = {
		update: sinon.stub().resolves(),
		appendBody: sinon.stub().resolves(),
		finalize: sinon.stub().resolves(),
		waitForInteraction: sinon.stub(),
	}
	const state: Record<string, unknown> = { consecutiveMistakeCount: 0, isAwaitingPlanResponse: false }
	const env = {
		ui: {
			createCard: sinon.stub().resolves(card),
			upsertText: sinon.stub().resolves(),
		},
		orchestration: {
			getTaskState: sinon.stub().callsFake((key: string) => state[key]),
			setTaskState: sinon.stub().callsFake((key: string, value: unknown) => {
				state[key] = value
			}),
			switchToActMode: sinon.stub().resolves(true),
			saveCheckpoint: sinon.stub().resolves(),
		},
		config: {
			yoloModeToggled: true,
			mode,
			callbacks: {
				postStateToWebview: sinon.stub().resolves(),
			},
		},
	}
	return { card, env }
}

describe("PlanModeRespondTool", () => {
	afterEach(() => sinon.restore())

	it("renders and accepts the plan before switching from plan mode in YOLO mode", async () => {
		const { card, env } = createMocks("plan")
		const response = "1. Inspect the flow\n2. Apply the fix"

		const result = await new PlanModeRespondTool().processCall({ response }, env as any)

		assert.ok(
			env.ui.createCard.calledWithMatch({
				header: "Proposed Plan",
				body: response,
				renderType: "markdown",
				requireFeedback: false,
				collapsed: false,
				do_not_auto_collapse: true,
			}),
		)
		assert.equal(card.waitForInteraction.callCount, 0)
		assert.equal(env.orchestration.switchToActMode.callCount, 1)
		assert.ok(card.update.calledWith({ header: "Plan Accepted" }))
		assert.ok(card.finalize.calledWith(CardStatus.SUCCESS, true))
		assert.match(result, /switched to ACT MODE/)
	})

	it("renders and accepts the plan without switching when already in act mode", async () => {
		const { card, env } = createMocks("act")
		const response = "1. Continue implementation"

		const result = await new PlanModeRespondTool().processCall({ response }, env as any)

		assert.ok(env.ui.createCard.calledWithMatch({ body: response }))
		assert.equal(card.waitForInteraction.callCount, 0)
		assert.equal(env.orchestration.switchToActMode.callCount, 0)
		assert.ok(card.finalize.calledWith(CardStatus.SUCCESS, true))
		assert.match(result, /Go ahead and execute/)
	})
	it("clears the plan waiting flag when a plain text response interrupts the plan tool", async () => {
		const { card, env } = createMocks("plan")
		env.config.yoloModeToggled = false
		card.waitForInteraction.rejects(new ToolSkippedByUserMessage("Revise the plan"))

		await assert.rejects(new PlanModeRespondTool().processCall({ response: "1. Inspect the flow" }, env as any))

		assert.equal(env.orchestration.getTaskState("isAwaitingPlanResponse"), false)
		assert.equal(env.config.callbacks.postStateToWebview.callCount, 2)
	})

	it("clears the plan waiting flag when the interaction fails", async () => {
		const { card, env } = createMocks("plan")
		env.config.yoloModeToggled = false
		const interruption = new Error("interaction interrupted")
		card.waitForInteraction.rejects(interruption)

		await assert.rejects(
			new PlanModeRespondTool().processCall({ response: "1. Inspect the flow" }, env as any),
			interruption,
		)

		assert.equal(env.orchestration.getTaskState("isAwaitingPlanResponse"), false)
	})

	it("does not set the plan waiting flag when card creation fails", async () => {
		const { env } = createMocks("plan")
		env.config.yoloModeToggled = false
		env.ui.createCard.rejects(new Error("card failed"))

		await assert.rejects(new PlanModeRespondTool().processCall({ response: "1. Inspect the flow" }, env as any))

		assert.equal(env.orchestration.getTaskState("isAwaitingPlanResponse"), false)
		assert.equal(env.config.callbacks.postStateToWebview.callCount, 0)
	})
})
