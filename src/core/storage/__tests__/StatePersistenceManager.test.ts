import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import "should"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import type { StorageContext } from "@shared/storage/storage-context"
import { readTaskSettingsFromStorage } from "../disk"
import { StatePersistenceManager } from "../StatePersistenceManager"
import { StateManager } from "../StateManager"
import type { DiracFileStorage } from "@/shared/storage/DiracFileStorage"
import type { DiracMemento } from "@/shared/storage/DiracStorage"

describe("StatePersistenceManager", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-persistence-"))
		setVscodeHostProviderMock({ globalStorageFsPath: tempDir })
	})

	afterEach(async () => {
		if ((StateManager as any).instance?.persistence) {
			await (StateManager as any).instance.persistence.dispose()
		}
		;(StateManager as any).instance = undefined
		sandbox.restore()
		HostProvider.reset()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("preserves task settings queued while a flush is in progress", async () => {
		const taskId = `flush-race-${Date.now()}`
		const taskSettings = { mode: "act", customPrompt: "compact" }
		const persistence = new StatePersistenceManager(createStorage(), {
			getGlobalStateValue: () => undefined,
			getTaskStateValue: (key) => taskSettings[key as keyof typeof taskSettings],
			getSecretValue: () => undefined,
			getWorkspaceStateValue: () => undefined,
			setTaskHistoryInCache: () => {},
		})
		persistence.addPendingTaskState(taskId, "mode")
		const originalRename = fs.rename.bind(fs)
		let releaseRename!: () => void
		let renameStarted!: () => void
		const renameGate = new Promise<void>((resolve) => {
			releaseRename = resolve
		})
		const renameStartedGate = new Promise<void>((resolve) => {
			renameStarted = resolve
		})
		sandbox.stub(fs, "rename").callsFake(async (oldPath, newPath) => {
			renameStarted()
			await renameGate
			await originalRename(oldPath, newPath)
		})

		const firstFlush = persistence.flushPendingState()
		await renameStartedGate
		persistence.addPendingTaskState(taskId, "customPrompt")
		releaseRename()
		await firstFlush
		await persistence.flushPendingState()
		await persistence.dispose()

		const settings = await readTaskSettingsFromStorage(taskId) as any
		settings.mode.should.equal("act")
		settings.customPrompt.should.equal("compact")
	})

	it("T-DISPOSE-FLUSH U5 persists secrets before dispose returns", async () => {
		const storage = createStateManagerStorage()
		;(StateManager as any).instance = undefined
		const stateManager = await StateManager.initialize(storage)

		stateManager.setSecret("apiKey", "secret-before-dispose")
		await (stateManager as any).dispose()
		;(StateManager as any).instance = undefined

		const reinitialized = await StateManager.initialize(storage)
		reinitialized.getSecretKey("apiKey")!.should.equal("secret-before-dispose")
	})
})

function createStorage(): StorageContext {
	return {
		globalState: {} as any,
		globalStateBackingStore: { setBatch: () => {} } as any,
		secrets: { setBatch: () => {} } as any,
		workspaceState: { setBatch: () => {} } as any,
		dataDir: "",
		workspaceStoragePath: "",
	}
}

function createStateManagerStorage(): StorageContext {
	const globalData: Record<string, any> = {}
	const secretData: Record<string, string | undefined> = {}
	const workspaceData: Record<string, any> = {}
	const createMemento = (data: Record<string, any>): DiracMemento => ({
		get: (key: string, defaultValue?: any) => data[key] ?? defaultValue,
		update: async (key: string, value: any) => {
			data[key] = value
		},
		keys: () => Object.keys(data),
		setBatch: async (entries: Record<string, any>) => Object.assign(data, entries),
	})
	const createFileStorage = (data: Record<string, any>): DiracFileStorage =>
		({
			get: (key: string) => data[key],
			set: (key: string, value: any) => {
				data[key] = value
			},
			setBatch: (entries: Record<string, any>) => {
				for (const [key, value] of Object.entries(entries)) {
					if (value === undefined) delete data[key]
					else data[key] = value
				}
			},
			delete: (key: string) => {
				delete data[key]
			},
			keys: () => Object.keys(data),
			entries: () => Object.entries(data),
		}) as DiracFileStorage

	return {
		globalState: createMemento(globalData),
		globalStateBackingStore: createFileStorage(globalData),
		secrets: createFileStorage(secretData),
		workspaceState: createFileStorage(workspaceData),
		dataDir: "",
		workspaceStoragePath: "",
	}
}
