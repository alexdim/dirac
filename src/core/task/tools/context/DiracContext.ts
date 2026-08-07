import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { isDeepStrictEqual } from "node:util"
import { randomUUID } from "node:crypto"
import Mutex from "p-mutex"
import { Logger } from "@shared/services/Logger"
import { AnchorStateManager, PersistedAnchorState } from "@utils/AnchorStateManager"

import { IDiracContext } from "../interfaces/IDiracContext"
import { StateManager } from "../../../storage/StateManager"

const ANCHOR_STATE_KEY = "anchorState"

export class DiracContext implements IDiracContext {
	private taskData: Record<string, any> = {}
	private taskPath: string
	private loaded = false
	private anchorStateLoaded = false
	private mutationRevision = 0
	private persistedRevision = 0
	private stateMutex = new Mutex()

	constructor(
		private taskId: string,
		private stateManager: StateManager,
		private conversationUlid: string,
	) {
		const diracHome = process.env.DIRAC_DIR || path.join(os.homedir(), ".dirac")
		this.taskPath = path.join(diracHome, "data", "tasks", taskId, "tool_context.json")
	}

	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	private async loadTaskData(): Promise<void> {
		if (this.loaded) return
		this.taskData = await this.readJson(this.taskPath)
		this.loaded = true
	}

	private ensureAnchorStateLoaded(): void {
		if (this.anchorStateLoaded) return
		const persistedAnchorState = this.taskData[ANCHOR_STATE_KEY] as PersistedAnchorState | undefined
		AnchorStateManager.hydrate(this.conversationUlid, persistedAnchorState)
		this.anchorStateLoaded = true
	}

	private markDirty(): void {
		this.mutationRevision++
	}

	private async saveInternal(): Promise<void> {
		if (!this.loaded || this.persistedRevision === this.mutationRevision) return
		if (this.anchorStateLoaded) {
			this.taskData[ANCHOR_STATE_KEY] = AnchorStateManager.exportState(this.conversationUlid)
		}
		const revision = this.mutationRevision
		if (this.taskId.toLowerCase().includes("test")) return
		await this.writeJson(this.taskPath, structuredClone(this.taskData))
		this.persistedRevision = revision
		await this.stateManager.flushPendingState()
	}

	public async load(): Promise<void> {
		await this.withStateLock(() => this.loadTaskData())
	}

	public async ensureAnchorState(): Promise<void> {
		await this.withStateLock(async () => {
			await this.loadTaskData()
			this.ensureAnchorStateLoaded()
		})
	}

	public markAnchorStateDirty(): void {
		this.markDirty()
	}

	public async save(): Promise<void> {
		await this.withStateLock(() => this.saveInternal())
	}

	private async readJson(filePath: string): Promise<Record<string, any>> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			return JSON.parse(content)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
			throw error
		}
	}

	private async writeJson(filePath: string, data: Record<string, any>): Promise<void> {
		const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
		try {
			await fs.mkdir(path.dirname(filePath), { recursive: true })
			await fs.writeFile(temporaryPath, JSON.stringify(data), "utf-8")
			await fs.rename(temporaryPath, filePath)
		} catch (error) {
			await fs.rm(temporaryPath, { force: true })
			Logger.error(`Failed to write context to ${filePath}:`, error)
			throw error
		}
	}

	private async replaceTaskValue<T>(key: string, value: T): Promise<void> {
		await this.loadTaskData()
		if (isDeepStrictEqual(this.taskData[key], value)) return
		this.taskData[key] = structuredClone(value)
		this.markDirty()
	}

	public task = {
		get: async <T>(key: string): Promise<T | undefined> =>
			await this.withStateLock(async () => {
				await this.loadTaskData()
				const value = this.taskData[key] as T | undefined
				return value === undefined ? undefined : structuredClone(value)
			}),
		set: async <T>(key: string, value: T): Promise<void> => {
			await this.withStateLock(() => this.replaceTaskValue(key, value))
		},
		update: async <T>(key: string, updater: (value: T | undefined) => T): Promise<void> => {
			await this.withStateLock(async () => {
				await this.loadTaskData()
				const value = this.taskData[key] as T | undefined
				await this.replaceTaskValue(key, updater(value === undefined ? undefined : structuredClone(value)))
			})
		},
	}

	public workspace = {
		get: <T>(key: string): T | undefined => this.stateManager.getWorkspaceStateKey(key as any) as T,
		set: <T>(key: string, value: T): void => {
			this.stateManager.setWorkspaceState(key as any, value as any)
		},
	}

	public async resetTaskContext(): Promise<void> {
		await this.withStateLock(async () => {
			await this.loadTaskData()
			this.ensureAnchorStateLoaded()
			this.taskData = {
				[ANCHOR_STATE_KEY]: AnchorStateManager.exportState(this.conversationUlid),
			}
			this.markDirty()
			await this.saveInternal()
		})
	}

	public global = {
		get: <T>(key: string): T | undefined => this.stateManager.getGlobalStateKey(key as any) as T,
		set: <T>(key: string, value: T): void => {
			this.stateManager.setGlobalState(key as any, value as any)
		},
	}
}
