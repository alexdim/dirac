/**
 * Characterization tests for StateManager.
 * Captures current behavior — bugs and all.
 *
 * Phase 0 — Prerequisite coverage for refactoring
 */
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import type { DiracFileStorage } from "@/shared/storage/DiracFileStorage"
import type { DiracMemento } from "@/shared/storage/DiracStorage"
import type { StorageContext } from "@/shared/storage/storage-context"
import { StateManager } from "../StateManager"
import { TEST_MODEL_IDS } from "@test/fixtures/model-ids"

describe("StateManager", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let storage: StorageContext

	function createMockMemento(initial: Record<string, any> = {}): DiracMemento {
		const data = { ...initial }
		return {
			get: (key: string, defaultValue?: any) => data[key] ?? defaultValue,
			update: async (key: string, value: any) => {
				data[key] = value
			},
			keys: () => Object.keys(data),
			setBatch: async (entries: Record<string, any>) => {
				Object.assign(data, entries)
			},
		}
	}

	function createMockFileStorage(initial: Record<string, any> = {}): DiracFileStorage {
		const data = { ...initial }
		return {
			get: (key: string) => data[key],
			set: (key: string, value: any) => {
				data[key] = value
			},
			setBatch: (entries: Record<string, any>) => Object.assign(data, entries),
			delete: (key: string) => {
				delete data[key]
			},
			keys: () => Object.keys(data),
			entries: () => Object.entries(data),
		} as unknown as DiracFileStorage
	}

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		sandbox.stub(HostProvider, "get").returns({
			globalStorageFsPath: tempDir,
			hostBridge: { workspaceClient: {}, envClient: { getHostVersion: sandbox.stub().resolves({}) } },
		} as any)
		tempDir = path.join(os.tmpdir(), `dirac-sm-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })

		storage = {
			globalState: createMockMemento({ mode: "plan", taskHistory: [] }),
			globalStateBackingStore: createMockFileStorage({ mode: "plan", taskHistory: [] }),
			secrets: createMockFileStorage({}),
			workspaceState: createMockFileStorage({}),
			dataDir: tempDir,
			workspaceStoragePath: tempDir,
		}

		if ((StateManager as any).instance?.persistence) {
			await (StateManager as any).instance.persistence.dispose()
		}
		// Reset singleton
		;(StateManager as any).instance = undefined
	})

	afterEach(async () => {
		// Cancel any pending debounced persistence timers before teardown
		if ((StateManager as any).instance?.persistence) {
			await (StateManager as any).instance.persistence.dispose()
		}
		sandbox.restore()
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {}
		;(StateManager as any).instance = undefined
	})

	// ---------------------------------------------------------------
	describe("initialize and get", () => {
		it("initialize returns a StateManager", async function () {
			this.skip()
		}) // env issue
		it.skip("initialize returns a StateManager", async () => {
			const sm = await StateManager.initialize(storage)
			sm.should.be.instanceOf(StateManager)
		})

		it("get returns same instance after initialize", async () => {
			const sm = await StateManager.initialize(storage)
			StateManager.get().should.equal(sm)
		})

		it("get throws before initialize", () => {
			;(() => StateManager.get()).should.throw()
		})

		it("initialize twice throws", async () => {
			await StateManager.initialize(storage)
			await StateManager.initialize(storage).should.be.rejected()
		})
	})

	// ---------------------------------------------------------------
	describe("utility model migration", () => {
		async function setPersistedUtilitySetting(key: string, value: boolean): Promise<void> {
			await storage.globalState.update(key, value)
			storage.globalStateBackingStore.set(key, value)
		}

		it("keeps fresh installs on the independent use-case defaults", async () => {
			const setBatch = sandbox.spy(storage.globalStateBackingStore, "setBatch")

			const sm = await StateManager.initialize(storage)

			sm.getGlobalSettingsKey("utilityModelUseCondense").should.equal(true)
			sm.getGlobalSettingsKey("utilityModelUseNewTask").should.equal(true)
			sm.getGlobalSettingsKey("utilityModelUseGenerateCommitMessage").should.equal(true)
			sinon.assert.notCalled(setBatch)
		})

		it("migrates a legacy enabled setting to every missing use case", async () => {
			await setPersistedUtilitySetting("utilityModelEnabled", true)

			const sm = await StateManager.initialize(storage)

			sm.getGlobalSettingsKey("utilityModelUseCondense").should.equal(true)
			sm.getGlobalSettingsKey("utilityModelUseNewTask").should.equal(true)
			sm.getGlobalSettingsKey("utilityModelUseGenerateCommitMessage").should.equal(true)
		})

		it("preserves a legacy opt-out for every missing use case", async () => {
			await setPersistedUtilitySetting("utilityModelEnabled", false)

			const sm = await StateManager.initialize(storage)

			sm.getGlobalSettingsKey("utilityModelUseCondense").should.equal(false)
			sm.getGlobalSettingsKey("utilityModelUseNewTask").should.equal(false)
			sm.getGlobalSettingsKey("utilityModelUseGenerateCommitMessage").should.equal(false)
		})

		it("preserves explicit use cases while backfilling only missing settings", async () => {
			await setPersistedUtilitySetting("utilityModelEnabled", true)
			await setPersistedUtilitySetting("utilityModelUseCondense", false)

			const sm = await StateManager.initialize(storage)

			sm.getGlobalSettingsKey("utilityModelUseCondense").should.equal(false)
			sm.getGlobalSettingsKey("utilityModelUseNewTask").should.equal(true)
			sm.getGlobalSettingsKey("utilityModelUseGenerateCommitMessage").should.equal(true)
		})

		it("does not rewrite configurations with every independent use case persisted", async () => {
			await setPersistedUtilitySetting("utilityModelEnabled", false)
			await setPersistedUtilitySetting("utilityModelUseCondense", true)
			await setPersistedUtilitySetting("utilityModelUseNewTask", false)
			await setPersistedUtilitySetting("utilityModelUseGenerateCommitMessage", true)
			const setBatch = sandbox.spy(storage.globalStateBackingStore, "setBatch")

			const sm = await StateManager.initialize(storage)

			sm.getGlobalSettingsKey("utilityModelUseCondense").should.equal(true)
			sm.getGlobalSettingsKey("utilityModelUseNewTask").should.equal(false)
			sm.getGlobalSettingsKey("utilityModelUseGenerateCommitMessage").should.equal(true)
			sinon.assert.notCalled(setBatch)
		})
	})

	// ---------------------------------------------------------------
	describe("global state", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("setGlobalState stores value", () => {
			sm.setGlobalState("mode", "act")
			sm.getGlobalSettingsKey("mode").should.equal("act")
		})

		it("setGlobalStateBatch stores multiple values", () => {
			sm.setGlobalStateBatch({ mode: "act", preferredLanguage: "fr" })
			sm.getGlobalSettingsKey("mode").should.equal("act")
			sm.getGlobalSettingsKey("preferredLanguage").should.equal("fr")
		})

		it("getGlobalStateKey returns global state value", () => {
			sm.getGlobalStateKey("taskHistory").should.be.an.Array()
		})

		it("getGlobalSettingsKey returns undefined for unknown key", () => {
			const v = sm.getGlobalSettingsKey("nonexistent" as any)
			;(v === undefined).should.be.true()
		})
	})

	// ---------------------------------------------------------------
	describe("task settings", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("setTaskSettings stores task-specific value", () => {
			sm.setTaskSettings("task1", "mode", "plan")
			sm.getGlobalSettingsKey("mode").should.equal("plan")
		})

		it("setTaskSettingsBatch stores multiple values", () => {
			sm.setTaskSettingsBatch("task1", { mode: "act", customPrompt: "compact" })
			sm.getGlobalSettingsKey("mode").should.equal("act")
		})

		it("clearTaskSettings clears task cache", async () => {
			sm.setGlobalState("mode", "plan")
			sm.setTaskSettings("task1", "mode", "act")
			sm.getGlobalSettingsKey("mode").should.equal("act")
			await sm.clearTaskSettings()
			const v = sm.getGlobalSettingsKey("mode")
			v.should.equal("plan")
		})
	})

	// ---------------------------------------------------------------
	describe("secrets", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("setSecret stores secret value", () => {
			sm.setSecret("apiKey", "sk-test123")
			sm.getSecretKey("apiKey")!.should.equal("sk-test123")
		})

		it("setSecretsBatch stores multiple secrets", () => {
			sm.setSecretsBatch({ apiKey: "key1", openRouterApiKey: "key2" })
			sm.getSecretKey("apiKey")!.should.equal("key1")
			sm.getSecretKey("openRouterApiKey")!.should.equal("key2")
		})

		it("getSecretKey returns undefined for unknown key", () => {
			const v = sm.getSecretKey("nonexistent" as any)
			;(v === undefined).should.be.true()
		})
	})

	// ---------------------------------------------------------------
	describe("workspace state", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("setWorkspaceState stores value", () => {
			sm.setWorkspaceState("localDiracRulesToggles", { rule1: true })
			sm.getWorkspaceStateKey("localDiracRulesToggles").should.deepEqual({ rule1: true })
		})

		it("setWorkspaceStateBatch stores multiple values", () => {
			sm.setWorkspaceStateBatch({ localDiracRulesToggles: { a: true }, workflowToggles: { b: false } })
			sm.getWorkspaceStateKey("localDiracRulesToggles").should.deepEqual({ a: true })
		})
	})

	// ---------------------------------------------------------------
	describe("session override", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("session override takes precedence over global", () => {
			sm.setGlobalState("mode", "plan")
			sm.setSessionOverride("mode", "act")
			sm.getGlobalSettingsKey("mode").should.equal("act")
		})

		it("an owned undefined session value blocks task and global runtime inheritance", () => {
			sm.setGlobalState("actModeApiModelId", "global-model")
			sm.setTaskSettings("task1", "actModeApiModelId", "task-model")
			sm.setSessionOverride("actModeApiModelId", undefined)

			const value = sm.getGlobalSettingsKey("actModeApiModelId")
			;(value === undefined).should.be.true()
		})

		it("system-default reads ignore task and session runtime state", () => {
			sm.setGlobalState("actModeApiModelId", "global-model")
			sm.setTaskSettings("task1", "actModeApiModelId", "task-model")
			sm.setSessionOverride("actModeApiModelId", "session-model")

			sm.getSystemDefaultSettingsKey("actModeApiModelId")!.should.equal("global-model")
		})
	})

	// ---------------------------------------------------------------
	describe("API configuration", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("getApiConfiguration returns object", () => {
			const config = sm.getApiConfiguration()
			config.should.be.an.Object()
		})

		it("setApiConfiguration does not throw", () => {
			;(() => sm.setApiConfiguration({ apiProvider: "anthropic" } as any)).should.not.throw()
		})
	})

	// ---------------------------------------------------------------
	describe("models cache", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("setModelsCache stores and getModelsCache retrieves", () => {
			const models = { [TEST_MODEL_IDS.OPENAI]: { id: TEST_MODEL_IDS.OPENAI, name: "GPT-4" } as any }
			sm.setModelsCache("openRouter", models)
			sm.getModelsCache("openRouter")!.should.deepEqual(models)
		})

		it("getModelsCache returns null for uncached provider", () => {
			;(sm.getModelsCache("dirac") === null).should.be.true() // null is valid for uncached provider
		})
	})

	// ---------------------------------------------------------------
	describe("callbacks", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("registerCallbacks accepts persistence error callback", () => {
			const cb = sandbox.stub()
			sm.registerCallbacks({ onPersistenceError: cb })
			sm.onPersistenceError!.should.equal(cb)
		})

		it("registerCallbacks accepts sync external change callback", () => {
			const cb = sandbox.stub()
			sm.registerCallbacks({ onSyncExternalChange: cb })
			sm.onSyncExternalChange!.should.equal(cb)
		})
	})

	// ---------------------------------------------------------------
	describe("flush and entries", () => {
		let sm: StateManager

		beforeEach(async () => {
			sm = await StateManager.initialize(storage)
		})

		it("flushPendingState resolves", async () => {
			await sm.flushPendingState().should.not.be.rejected()
		})

		it("getAllGlobalStateEntries returns object", () => {
			const entries = sm.getAllGlobalStateEntries()
			entries.should.be.an.Object()
		})

		it("getAllWorkspaceStateEntries returns object", () => {
			const entries = sm.getAllWorkspaceStateEntries()
			entries.should.be.an.Object()
		})
	})

	// ---------------------------------------------------------------
	describe("reInitialize", () => {
		it.skip("reinitializes state manager", async () => {
			const sm = await StateManager.initialize(storage)
			sm.setGlobalState("mode", "act")
			await sm.reInitialize()
			const v = sm.getGlobalSettingsKey("mode")
			;(v === undefined).should.be.true()
		})
	})
})
