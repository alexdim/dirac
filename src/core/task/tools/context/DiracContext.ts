import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { Logger } from "@shared/services/Logger"
import { AnchorStateManager, PersistedAnchorState } from "@utils/AnchorStateManager"

import { IDiracContext } from "../interfaces/IDiracContext"
import { StateManager } from "../../../storage/StateManager"

const ANCHOR_STATE_KEY = "anchorState"

export class DiracContext implements IDiracContext {
	private taskData: Record<string, any> = {}
	private taskPath: string

	constructor(
		private taskId: string,
		private stateManager: StateManager,
		private conversationUlid: string,
	) {
		const diracHome = process.env.DIRAC_DIR || path.join(os.homedir(), ".dirac")
		this.taskPath = path.join(diracHome, "data", "tasks", taskId, "tool_context.json")
	}

	public async load(): Promise<void> {
		this.taskData = await this.readJson(this.taskPath)
		const persistedAnchorState = this.taskData[ANCHOR_STATE_KEY] as PersistedAnchorState | undefined
		AnchorStateManager.hydrate(this.conversationUlid, persistedAnchorState)
	}

	public async save(): Promise<void> {
		this.taskData[ANCHOR_STATE_KEY] = AnchorStateManager.exportState(this.conversationUlid)
		if (this.taskId.toLowerCase().includes("test")) {
			return
		}
		await this.writeJson(this.taskPath, this.taskData)
		await this.stateManager.flushPendingState()
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
		const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
		try {
			await fs.mkdir(path.dirname(filePath), { recursive: true })
			await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2), "utf-8")
			await fs.rename(temporaryPath, filePath)
		} catch (error) {
			await fs.rm(temporaryPath, { force: true })
			Logger.error(`Failed to write context to ${filePath}:`, error)
			throw error
		}
	}

	public task = {
		get: <T>(key: string): T | undefined => this.taskData[key],
		set: <T>(key: string, value: T): void => {
			this.taskData[key] = value
		},
	}

	public workspace = {
		get: <T>(key: string): T | undefined => this.stateManager.getWorkspaceStateKey(key as any) as T,
		set: <T>(key: string, value: T): void => {
			this.stateManager.setWorkspaceState(key as any, value as any)
		},
	}

	public async resetTaskContext(): Promise<void> {
		this.taskData = {
			[ANCHOR_STATE_KEY]: AnchorStateManager.exportState(this.conversationUlid),
		}
		await this.save()
	}

	public global = {
		get: <T>(key: string): T | undefined => this.stateManager.getGlobalStateKey(key as any) as T,
		set: <T>(key: string, value: T): void => {
			this.stateManager.setGlobalState(key as any, value as any)
		},
	}
}
