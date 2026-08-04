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

describe("StatePersistenceManager", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-persistence-"))
		setVscodeHostProviderMock({ globalStorageFsPath: tempDir })
	})

	afterEach(async () => {
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
