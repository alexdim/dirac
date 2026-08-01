import { strict as assert } from "node:assert"
import { DiracDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { toolSpecFunctionDefinition } from "@core/prompts/system-prompt/spec"
import { new_task_spec, NewTaskTool } from "../new_task/NewTaskTool"

function createMocks() {
	const card = {
		update: sinon.stub().resolves(),
		appendBody: sinon.stub().resolves(),
		finalize: sinon.stub().resolves(),
		waitForInteraction: sinon.stub().resolves({
			action: DiracDefaultTool.NEW_TASK,
			response: "approve",
			value: DiracDefaultTool.NEW_TASK,
		}),
	}
	const abortController = new AbortController()
	const state: Record<string, unknown> = {
		consecutiveMistakeCount: 0,
		abortSignal: abortController.signal,
	}
	const conversationCondensation = {
		isAvailable: sinon.stub().returns(false),
		condenseConversation: sinon.stub(),
	}
	const env = {
		ui: {
			createCard: sinon.stub().resolves(card),
			upsertText: sinon.stub().resolves(),
		},
		conversationCondensation,
		logging: { warn: sinon.stub() },
		orchestration: {
			getTaskState: sinon.stub().callsFake((key: keyof typeof state) => state[key]),
			setTaskState: sinon.stub().callsFake((key: string, value: unknown) => {
				state[key] = value
			}),
			requestTaskReplacement: sinon.stub(),
		},
		config: {
			isSubagentExecution: false,
			autoApprovalSettings: { enableNotifications: false },
			ulid: "ulid-1",
			mode: "act",
			api: { getModel: () => ({ id: "model-1" }) },
			services: {
				stateManager: {
					getApiConfiguration: () => ({ actModeApiProvider: "provider-1", planModeApiProvider: "provider-1" }),
				},
			},
		},
	}
	return { abortController, card, env, state, conversationCondensation }
}

describe("NewTaskTool", () => {
	afterEach(() => sinon.restore())

	it("exposes a required context only when Utility handoff generation is unavailable", () => {
		const tool = toolSpecFunctionDefinition(
			new_task_spec,
			{
				providerInfo: { providerId: "openai", model: { id: "model", info: { supportsStrictTools: true } }, mode: "act" },
				ide: "test",
				taskHandoffCondensationAvailable: false,
			} as any,
			true,
		) as any

		assert.deepEqual(Object.keys(tool.function.parameters.properties), ["context"])
		assert.deepEqual(tool.function.parameters.required, ["context"])
		assert.match(tool.function.description, /handoff that you generate/)
	})

	it("exposes only a bounded concise intent when Utility handoff generation is available", () => {
		const tool = toolSpecFunctionDefinition(
			new_task_spec,
			{
				providerInfo: { providerId: "openai", model: { id: "model", info: { supportsStrictTools: true } }, mode: "act" },
				ide: "test",
				taskHandoffCondensationAvailable: true,
			} as any,
			true,
		) as any

		assert.deepEqual(Object.keys(tool.function.parameters.properties), ["intent"])
		assert.deepEqual(tool.function.parameters.required, ["intent"])
		assert.match(tool.function.parameters.properties.intent.description, /one or two short sentences/)
		assert.match(tool.function.parameters.properties.intent.description, /no more than 40 words/)
		assert.match(tool.function.description, /concise intent/)
	})

	it("creates an expanded completion-sized markdown card with promoted new-task actions", async () => {
		const { card, env } = createMocks()
		const context = "# Current work\n\nContinue from this exact context."

		await new NewTaskTool().processCall({ context }, env as any)

		assert.ok(
			env.ui.createCard.calledWithMatch({
				header: "New Task",
				body: context,
				renderType: "markdown",
				rawInput: { tool: DiracDefaultTool.NEW_TASK },
				collapsed: false,
				maxHeight: 1200,
				do_not_auto_collapse: true,
				actions: [{ label: "Approve New Task", value: DiracDefaultTool.NEW_TASK, primary: true }],
			}),
		)
		assert.ok(card.waitForInteraction.calledOnce)
		assert.ok(card.finalize.calledWith("success"))
		assert.ok(env.orchestration.requestTaskReplacement.calledOnceWithExactly(context))
	})

	it("treats composer content as feedback instead of replacing the task", async () => {
		const { card, env } = createMocks()
		card.waitForInteraction.resolves({
			action: DiracDefaultTool.NEW_TASK,
			response: "approve",
			value: DiracDefaultTool.NEW_TASK,
			text: "Change the plan",
			images: ["data:image/png;base64,iVBORw0KGgo="],
		})

		await new NewTaskTool().processCall({ context: "Generated context" }, env as any)

		assert.ok(card.finalize.calledWith("cancelled"))
		assert.ok(env.ui.upsertText.calledWith("Change the plan", false, "user"))
		assert.equal(env.orchestration.requestTaskReplacement.called, false)
	})

	it("uses the Utility model task-handoff capability for a concise intent", async () => {
		const { card, env, conversationCondensation } = createMocks()
		conversationCondensation.isAvailable.returns(true)
		conversationCondensation.condenseConversation.resolves("# Completed handoff")

		await new NewTaskTool().processCall({ intent: "Continue the requested implementation." }, env as any)

		assert.ok(conversationCondensation.isAvailable.calledWith("task_handoff"))
		assert.ok(
			conversationCondensation.condenseConversation.calledWithMatch(
				"task_handoff",
				sinon.match({ additionalSourceText: sinon.match(/Continue the requested implementation/) }),
			),
		)
		assert.ok(env.ui.createCard.calledWithMatch({ body: "# Completed handoff" }))
		assert.ok(card.finalize.calledWith("success"))
		assert.ok(env.orchestration.requestTaskReplacement.calledOnceWithExactly("# Completed handoff"))
	})
	it("does not fall back to context when Utility availability changes after the request schema", async () => {
		const { env, conversationCondensation } = createMocks()
		conversationCondensation.isAvailable.returns(false)

		const result = await new NewTaskTool().processCall(
			{ intent: "Continue the requested implementation." },
			env as any,
		)

		assert.match(result, /no longer available/)
		assert.equal(conversationCondensation.condenseConversation.callCount, 0)
		assert.equal(env.ui.createCard.callCount, 0)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
	})



	it("does not preview a generated handoff until the completed result is available", async () => {
		const { env, conversationCondensation } = createMocks()
		conversationCondensation.isAvailable.returns(true)
		let resolveHandoff: (handoff: string) => void = () => assert.fail("Expected handoff resolution")
		conversationCondensation.condenseConversation.returns(
			new Promise<string>((resolve) => {
				resolveHandoff = resolve
			}),
		)

		const processing = new NewTaskTool().processCall({ intent: "Continue the requested implementation." }, env as any)
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(env.ui.createCard.callCount, 0)

		resolveHandoff("# Completed handoff")
		await processing
		assert.equal(env.ui.createCard.callCount, 1)
	})

	it("returns active-model fallback instructions without previewing or replacing on Utility failure", async () => {
		const { env, state, conversationCondensation } = createMocks()
		conversationCondensation.isAvailable.returns(true)
		conversationCondensation.condenseConversation.rejects(new Error("utility unavailable"))

		const fallback = await new NewTaskTool().processCall(
			{ intent: "Continue the requested implementation." },
			env as any,
		)

		assert.equal(env.ui.createCard.callCount, 0)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
		assert.equal(state.consecutiveMistakeCount, 0)
		assert.match(fallback, /same concise intent/)
	})

	it("propagates task cancellation without fallback, preview, or replacement", async () => {
		const { abortController, env, conversationCondensation } = createMocks()
		conversationCondensation.isAvailable.returns(true)
		conversationCondensation.condenseConversation.callsFake(async (_template: string, options: { signal?: AbortSignal }) => {
			assert.equal(options.signal, abortController.signal)
			abortController.abort()
			throw new Error("cancelled")
		})

		await assert.rejects(
			new NewTaskTool().processCall({ intent: "Continue the requested implementation." }, env as any),
			/cancelled/,
		)

		assert.equal(env.logging.warn.callCount, 0)
		assert.equal(env.ui.createCard.callCount, 0)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
	})

	it("does not replace the task when cancellation arrives after approval", async () => {
		const { abortController, card, env } = createMocks()
		card.waitForInteraction.callsFake(async () => {
			abortController.abort()
			return {
				action: DiracDefaultTool.NEW_TASK,
				response: "approve",
				value: DiracDefaultTool.NEW_TASK,
			}
		})

		await assert.rejects(new NewTaskTool().processCall({ context: "handoff" }, env as any), /Task instance aborted/)

		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
	})

	it("keeps the committed replacement when final presentation is interrupted", async () => {
		const { abortController, card, env } = createMocks()
		card.finalize.callsFake(async () => {
			abortController.abort()
		})

		const result = await new NewTaskTool().processCall({ context: "handoff" }, env as any)

		assert.match(result, /created a new task/)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 1)
	})
})
