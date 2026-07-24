import { TaskStatus } from "@shared/ExtensionMessage"
import { DiracAskResponse } from "@shared/WebviewMessage"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
	let activePromptResolver: ((response: { stopReason: string }) => void) | undefined
	const controllers: MockController[] = []

	const task = {
		taskId: "session-task",
		taskState: {
			lastWaitingCardId: undefined as string | undefined,
			didAttemptCompletion: true,
			status: "awaiting_user_input",
		},
		messageStateHandler: {
			getDiracMessages: vi.fn(() => []),
		},
		submitCardResponse: vi.fn(async () => {
			activePromptResolver?.({ stopReason: "end_turn" })
		}),
	}

	class MockController {
		task: typeof task | undefined
		taskRunPromise: Promise<void> | undefined
		getStateToPostToWebview = vi.fn(async () => ({ mode: "act" }))
		onTaskReplaced = vi.fn(() => () => undefined)
		dispose = vi.fn()
		initTask = vi.fn(async () => {
			this.task = task
			return task.taskId
		})

		constructor() {
			controllers.push(this)
		}
	}

	class MockTaskMessageBridge {
		clearPromptState = vi.fn()
		promptResponse = vi.fn((stopReason: string) => ({ stopReason }))
		cancelInFlightToolCalls = vi.fn(async () => undefined)
		subscribeToTaskMessages = vi.fn(
			(
				_controller: unknown,
				_sessionId: string,
				_sessionState: unknown,
				resolvePrompt: (response: { stopReason: string }) => void,
			) => {
				activePromptResolver = resolvePrompt
			},
		)
		replayTaskMessages = vi.fn(async () => {
			activePromptResolver?.({ stopReason: "end_turn" })
		})
	}

	return {
		controllers,
		task,
		MockController,
		MockTaskMessageBridge,
		reset() {
			activePromptResolver = undefined
			controllers.splice(0)
			task.taskState.lastWaitingCardId = undefined
			task.taskState.didAttemptCompletion = true
			task.taskState.status = "awaiting_user_input"
			task.messageStateHandler.getDiracMessages.mockClear()
			task.submitCardResponse.mockClear()
		},
	}
})

const stateManager = {
	getGlobalSettingsKey: vi.fn((key: string) => {
		if (key === "mode") return "act"
		if (key === "actModeApiProvider") return "anthropic"
		return undefined
	}),
	getSessionOverrideCache: vi.fn(() => ({})),
	setSessionOverrideCache: vi.fn(),
	getApiConfiguration: vi.fn(() => ({})),
	getGlobalStateKey: vi.fn(() => []),
	flushPendingState: vi.fn(async () => undefined),
}

vi.mock("@/core/controller", () => ({ Controller: mocks.MockController }))
vi.mock("@/core/storage/disk", () => ({ setRuntimeHooksDir: vi.fn() }))
vi.mock("@/core/storage/StateManager", () => ({ StateManager: { get: vi.fn(() => stateManager) } }))
vi.mock("./taskMessageBridge.js", () => ({ TaskMessageBridge: mocks.MockTaskMessageBridge }))

const { DiracAgent } = await import("./DiracAgent.js")

describe("DiracAgent ACP conversation continuity", () => {
	afterEach(() => {
		mocks.reset()
		vi.clearAllMocks()
	})

	it("continues a completed turn on the existing task for the same session", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
			; (agent as any).ctx = { extensionContext: {} }
			; (agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
			; (agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
			; (agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "act", availableModes: [] }))
			; (agent as any).sendAvailableCommands = vi.fn(async () => undefined)
			; (agent as any).setSessionTitleFromFirstExchange = vi.fn(async () => undefined)

		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]

		await expect(
			agent.prompt({ sessionId, prompt: [{ type: "text", text: "execute ls" }] } as any),
		).resolves.toEqual({ stopReason: "end_turn" })
		expect(controller.initTask).toHaveBeenCalledTimes(1)
		const originalTask = controller.task

		mocks.task.taskState.status = TaskStatus.COMPLETED
		setTimeout(() => {
			mocks.task.taskState.status = TaskStatus.AWAITING_USER_INPUT
		}, 20)

		await expect(
			agent.prompt({ sessionId, prompt: [{ type: "text", text: "what was my last message?" }] } as any),
		).resolves.toEqual({ stopReason: "end_turn" })

		expect(controller.task).toBe(originalTask)
		expect(controller.initTask).toHaveBeenCalledTimes(1)
		expect(mocks.task.submitCardResponse).toHaveBeenCalledWith(
			"",
			DiracAskResponse.MESSAGE,
			"what was my last message?",
			[],
			[],
		)
		expect(mocks.task.taskState.status).toBe(TaskStatus.AWAITING_USER_INPUT)
	})
})
