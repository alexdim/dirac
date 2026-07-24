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
			on: vi.fn(),
			off: vi.fn(),
		},
		submitCardResponse: vi.fn(async () => {
			activePromptResolver?.({ stopReason: "end_turn" })
		}),
		rebuildApiHandler: vi.fn(),
		applyRuntimeModeChange: vi.fn(),
		createApiHandlerForRuntime: vi.fn(() => ({ getModel: () => ({ id: "act-model", info: {} }) })),
		setApiHandler: vi.fn(),
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
		reinitExistingTaskFromId = vi.fn(async () => {
			this.task = task
			task.taskState.didAttemptCompletion = true
			task.taskState.status = TaskStatus.COMPLETED
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
			task.rebuildApiHandler.mockClear()
			task.applyRuntimeModeChange.mockClear()
			task.createApiHandlerForRuntime.mockClear()
			task.setApiHandler.mockClear()
			sessionOverrideCache = {}
		},
	}
})

let sessionOverrideCache: Record<string, unknown> = {}

const stateManager: any = {
	getGlobalSettingsKey: vi.fn((key: string) => {
		if (key === "mode") return "act"
		if (key === "actModeApiProvider") return "anthropic"
		return undefined
	}),
	getSystemDefaultSettingsKey: vi.fn((key: string) => {
		if (key === "mode") return "act"
		if (key === "actModeApiProvider" || key === "planModeApiProvider") return "anthropic"
		return undefined
	}),
	getSessionOverrideCache: vi.fn(() => sessionOverrideCache),
	setSessionOverrideCache: vi.fn((overrides: Record<string, unknown>) => {
		sessionOverrideCache = overrides
	}),
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
		;(agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
		;(agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
		;(agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
		;(agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "act", availableModes: [] }))
		;(agent as any).sendAvailableCommands = vi.fn(async () => undefined)
		;(agent as any).setSessionTitleFromFirstExchange = vi.fn(async () => undefined)

		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]

		await expect(agent.prompt({ sessionId, prompt: [{ type: "text", text: "execute ls" }] } as any)).resolves.toEqual({
			stopReason: "end_turn",
		})
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

	it("starts a new task for the first prompt after loading completed history", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
		;(agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
		;(agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
		;(agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
		;(agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "act", availableModes: [] }))
		;(agent as any).sendAvailableCommands = vi.fn(async () => undefined)
		;(agent as any).setSessionTitleFromFirstExchange = vi.fn(async () => undefined)

		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]
		const session = (agent as any).sessions.get(sessionId)
		session.isLoadedFromHistory = true
		session.loadedTaskId = "completed-task"

		await expect(agent.prompt({ sessionId, prompt: [{ type: "text", text: "start a follow-up" }] } as any)).resolves.toEqual({
			stopReason: "end_turn",
		})

		expect(controller.reinitExistingTaskFromId).toHaveBeenCalledWith("completed-task", expect.any(Object))
		expect(controller.initTask).toHaveBeenCalledWith(
			"start a follow-up",
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			expect.any(Object),
		)
		expect(mocks.task.submitCardResponse).not.toHaveBeenCalled()
	})

	it("installs Act overrides immediately when the active prompt changes mode", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
		;(agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
		;(agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
		;(agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
		;(agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "plan", availableModes: [] }))

		stateManager.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (Object.hasOwn(sessionOverrideCache, key)) {
				return sessionOverrideCache[key] as "act" | "anthropic" | undefined
			}
			if (key === "mode") return "plan"
			if (key === "planModeApiProvider" || key === "actModeApiProvider") return "anthropic"
			return undefined
		})
		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const session = (agent as any).sessions.get(sessionId)
		const controller = mocks.controllers[0]
		controller.task = mocks.task
		;(agent as any).activePromptSessionId = sessionId
		sessionOverrideCache = { mode: "plan", planModeApiProvider: "anthropic", actModeApiProvider: "anthropic" }

		const nextOverrides = {
			...(agent as any).acpSessionOverrides.get(sessionId),
			mode: "act",
			actModeApiProvider: "anthropic",
		}
		;(agent as any).replaceSessionRuntimeConfig(session, nextOverrides, "act")

		expect(sessionOverrideCache.mode).toBe("act")
		expect(stateManager.getGlobalSettingsKey("mode")).toBe("act")
		expect(mocks.task.setApiHandler).toHaveBeenCalledOnce()
	})

	it("forces cleanup during shutdown while preserving close-session guards", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
		;(agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]
		;(agent as any).sessionStates.get(sessionId).status = "configuring"

		await expect(agent.closeSession({ sessionId } as any)).rejects.toThrow("applying a runtime configuration change")
		await expect(agent.shutdown()).resolves.toBeUndefined()
		expect(controller.dispose).toHaveBeenCalledOnce()
		expect((agent as any).sessions.has(sessionId)).toBe(false)
	})
})
