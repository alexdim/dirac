---
component_id: 2.3.2
component_name: ACP Protocol Session & Host Bridge
---

# ACP Protocol Session & Host Bridge

## Component Description

Implements the Agent Client Protocol (ACP) agent interface, detached server, host bridge and terminal/file providers, and per-session state registries for tasks, runtime configs, pins, and worktrees.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/acp/AcpAgent.ts (lines 69-481)
```
export class AcpAgent implements acp.Agent {
	private readonly connection: AgentSideConnection
	private readonly diracAgent: DiracAgent

	/** Track which sessions we've subscribed to for event forwarding */
	private readonly subscribedSessions: Set<string> = new Set()
	/** Track which sessions have already published initial ACP setup updates */
	private readonly initializedSessions: Set<string> = new Set()
	/** Deduplicate in-flight initial session setup update publication */
	private readonly sessionInitializationPromises: Map<string, Promise<void>> = new Map()
	/** Listener cleanup functions owned by this transport connection. */
	private readonly sessionEventCleanup = new Map<string, Array<() => void>>()
	/** A superseded detached transport must not continue serving RPCs. */
	private disconnected = false

	constructor(
		connection: acp.AgentSideConnection,
		options: AcpAgentOptions,
		diracAgent: DiracAgent = new DiracAgent(options),
		permissionHandler?: PermissionHandler,
	) {
		this.connection = connection
		this.diracAgent = diracAgent
		this.diracAgent.setPermissionHandler(permissionHandler ?? this.connectionPermissionHandler())

		this.diracAgent.setElicitationHandler(this.connectionElicitationHandler())
	}

	/** Request a permission decision from this transport's client. */
	requestPermission(request: Parameters<PermissionHandler>[0]): ReturnType<AgentSideConnection["requestPermission"]> {
		this.assertConnected()
		return this.connection.requestPermission(request)
	}

	private assertConnected(): void {
		if (this.disconnected) {
			throw new Error("ACP transport has been disconnected")
		}
	}

	private connectionPermissionHandler(): PermissionHandler {
		return (request, resolve) => {
			this.requestPermission(request)
				.then(resolve)
				.catch((error) => {
					Logger.debug("[AcpAgent] Error requesting permission:", error)
					resolve({ outcome: { outcome: "cancelled" } })
				})
		}
	}

	private connectionElicitationHandler(): ElicitationHandler {
		return (request, resolve) => {
			this.connection
				.unstable_createElicitation(request)
				.then(resolve)
				.catch((error) => {
					Logger.error("[AcpAgent] Error requesting elicitation:", error)
					resolve({ action: "cancel" })
				})
		}
	}

	private subscribeToSessionEvents(sessionId: string): void {
		if (this.subscribedSessions.has(sessionId)) {
			return
		}

		const emitter = this.diracAgent.emitterForSession(sessionId)
		const cleanup: Array<() => void> = []
		const subscribe = <K extends SessionUpdateType>(eventName: K, listener: (payload: Record<string, unknown>) => void) => {
			emitter.on(eventName, listener as never)
			cleanup.push(() => emitter.off(eventName, listener as never))
		}
		const forwardSessionUpdate = <K extends SessionUpdateType>(eventName: K) => {
			subscribe(eventName, (payload) => {
				const update = {
					sessionUpdate: eventName,
					...payload,
				} as acp.SessionUpdate
				this.connection.sessionUpdate({ sessionId, update }).catch((error) => {
					Logger.error(`[AcpAgent] Error forwarding ${eventName}:`, error)
				})
			})
		}

		forwardSessionUpdate("agent_message_chunk")
		forwardSessionUpdate("agent_thought_chunk")
		forwardSessionUpdate("tool_call")
		forwardSessionUpdate("tool_call_update")
		forwardSessionUpdate("available_commands_update")
		forwardSessionUpdate("plan")
		forwardSessionUpdate("current_mode_update")
		forwardSessionUpdate("user_message_chunk")
		forwardSessionUpdate("config_option_update")
		forwardSessionUpdate("session_info_update")

		forwardSessionUpdate("usage_update")

		const clientAnnotationListener = (payload: Record<string, unknown>) => {
			this.connection
				.extNotification("dev.dirac/client_annotation", {
					sessionId,
					...payload,
				})
				.catch((error) => {
					Logger.error("[AcpAgent] Error forwarding client annotation:", error)
				})
		}
		emitter.on("client_annotation", clientAnnotationListener)
		cleanup.push(() => emitter.off("client_annotation", clientAnnotationListener))

		const pinnedMessagesListener = (payload: Record<string, unknown>) => {
			this.connection
				.extNotification("dev.dirac/pinned_messages_update", {
					sessionId,
					...payload,
				})
				.catch((error) => {
					Logger.error("[AcpAgent] Error forwarding pinned-message update:", error)
				})
		}
		emitter.on("pinned_messages_update", pinnedMessagesListener)
		cleanup.push(() => emitter.off("pinned_messages_update", pinnedMessagesListener))

		const steeringStatusListener = (payload: Record<string, unknown>) => {
			this.connection
				.extNotification("dev.dirac/steering_status", {
					sessionId,
					...payload,
				})
				.catch((error) => {
					Logger.error("[AcpAgent] Error forwarding steering-status update:", error)
				})
		}
		emitter.on("steering_status", steeringStatusListener)
		cleanup.push(() => emitter.off("steering_status", steeringStatusListener))
		const errorListener = (error: Error) => Logger.error("[AcpAgent] Session error:", error)
		emitter.on("error", errorListener)
		cleanup.push(() => emitter.off("error", errorListener))

		this.sessionEventCleanup.set(sessionId, cleanup)
		this.subscribedSessions.add(sessionId)
	}

	private removeSessionSubscription(sessionId: string): void {
		for (const cleanup of this.sessionEventCleanup.get(sessionId) ?? []) {
			cleanup()
		}
		this.sessionEventCleanup.delete(sessionId)
		this.subscribedSessions.delete(sessionId)
	}

	/**
	 * Publish session setup updates once per session.
	 *
	 * This is intentionally separated from `newSession()` response handling so
	 * ACP clients such as Zed only receive command/config notifications after
	 * the session creation response has been delivered.
	 */
	private async ensureSessionSetupUpdates(sessionId: string): Promise<void> {
		if (this.initializedSessions.has(sessionId)) {
			return
		}

		const existingPromise = this.sessionInitializationPromises.get(sessionId)
		if (existingPromise) {
			await existingPromise
			return
		}

		const publishPromise = this.diracAgent
			.publishSessionSetupUpdates(sessionId)
			.then(() => {
				this.initializedSessions.add(sessionId)
			})
			.finally(() => {
				this.sessionInitializationPromises.delete(sessionId)
			})

		this.sessionInitializationPromises.set(sessionId, publishPromise)
		await publishPromise
	}

	private scheduleSessionSetupUpdates(sessionId: string): void {
		setImmediate(() => {
			this.ensureSessionSetupUpdates(sessionId).catch((error) =>
				Logger.error("[AcpAgent] session setup update error:", error),
			)
		})
	}

	// ============================================================
	// acp.Agent Interface Implementation - Delegate to DiracAgent
	// ============================================================

	async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
		this.assertConnected()
		return await this.diracAgent.initialize(params, this.connection)
	}

	async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
		this.assertConnected()
		if (method === "dev.dirac/auth.logout") {
			await this.diracAgent.logout()
			return {}
		}

		const sessionId = params.sessionId
		if (typeof sessionId !== "string") {
			throw RequestError.invalidParams(undefined, "sessionId is required")
		}

		switch (method) {
			case "dev.dirac/session.close":
				return await this.closeSession({ sessionId })
			case "dev.dirac/session.delete":
				return await this.deleteSession({ sessionId })
			case "dev.dirac/permissions.list":
				return { rules: await this.diracAgent.listPermissionRules(sessionId) }
			case "dev.dirac/permissions.delete": {
				const rule = permissionRuleFromParams(params)
				await this.diracAgent.deletePermissionRule(sessionId, rule)
				return {}
			}

			case "dev.dirac/messages.pin": {
				const messageId = params.messageId
				if (typeof messageId !== "string") {
					throw RequestError.invalidParams(undefined, "messageId is required")
				}
				await this.diracAgent.pinMessage(sessionId, messageId)
				return {}
			}
			case "dev.dirac/messages.unpin": {
				const messageId = params.messageId
				if (typeof messageId !== "string") {
					throw RequestError.invalidParams(undefined, "messageId is required")
				}
				await this.diracAgent.unpinMessage(sessionId, messageId)
				return {}
			}
			case "dev.dirac/messages.pinned":
				return { messages: this.diracAgent.listPinnedMessages(sessionId) }

			case "dev.dirac/checkpoints.list":
				return {
					checkpoints: await this.diracAgent.listWorkspaceCheckpoints(sessionId),
				}
			case "dev.dirac/checkpoints.restore": {
				const checkpointId = params.checkpointId
				if (typeof checkpointId !== "string") {
					throw RequestError.invalidParams(undefined, "checkpointId is required")
				}
				await this.diracAgent.restoreWorkspaceCheckpoint(sessionId, checkpointId)
				return {}
			}

			case "dev.dirac/worktree.integrate": {
				const { targetBranch, deleteAfterMerge } = worktreeIntegrationParams(params)
				return await this.diracAgent.integrateSessionWorktree(sessionId, targetBranch, deleteAfterMerge)
			}
			default:
				throw RequestError.methodNotFound(method)
		}
	}

	/** Handle Dirac vendor notifications; unknown JSON-RPC notifications remain ignored. */
	async extNotification(method: string, params: Record<string, unknown>): Promise<void> {
		this.assertConnected()
		if (method === "dev.dirac/whisper") {
			await this.diracAgent.queueWhisper(params)
			return
		}
		if (method === "dev.dirac/client_annotation") {
			this.diracAgent.recordClientAnnotation(params)
		}
	}

	async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		this.assertConnected()
		const response = await this.diracAgent.newSession(params)
		// Subscribe to events for this new session
		this.subscribeToSessionEvents(response.sessionId)
		this.scheduleSessionSetupUpdates(response.sessionId)
		return response
	}

	async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
		this.assertConnected()
		const response = await this.diracAgent.loadSession(params)
		this.subscribeToSessionEvents(params.sessionId)
		// Replay history after subscribing so events reach the client
		await this.diracAgent.replayLoadedSessionHistory(params.sessionId)
		this.scheduleSessionSetupUpdates(params.sessionId)
		return response
	}

	async unstable_resumeSession(params: acp.ResumeSessionRequest): Promise<acp.ResumeSessionResponse> {
		this.assertConnected()
		const response = await this.diracAgent.unstable_resumeSession(params)
		this.subscribeToSessionEvents(params.sessionId)
		this.scheduleSessionSetupUpdates(params.sessionId)
		return response
	}

	async unstable_listSessions(params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
		this.assertConnected()
		return this.diracAgent.unstable_listSessions(params)
	}

	async listProviders(params: acp.ListProvidersRequest): Promise<acp.ListProvidersResponse> {
		this.assertConnected()
		void params
		return this.diracAgent.listProviders()
	}

	async setProvider(params: acp.SetProviderRequest): Promise<void> {
		this.assertConnected()
		return this.diracAgent.setProvider(params)
	}

	async disableProvider(params: acp.DisableProviderRequest): Promise<void> {
		this.assertConnected()
		return this.diracAgent.disableProvider(params)
	}

	async unstable_listProviders(params: acp.ListProvidersRequest): Promise<acp.ListProvidersResponse> {
		return this.listProviders(params)
	}

	async unstable_setProvider(params: acp.SetProviderRequest): Promise<void> {
		return this.setProvider(params)
	}

	async unstable_disableProvider(params: acp.DisableProviderRequest): Promise<void> {
		return this.disableProvider(params)
	}

	async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
		this.assertConnected()
		const response = await this.diracAgent.closeSession(params)
		this.removeSessionSubscription(params.sessionId)
		this.initializedSessions.delete(params.sessionId)
		this.sessionInitializationPromises.delete(params.sessionId)

		return response
	}

	async deleteSession(params: acp.DeleteSessionRequest): Promise<acp.DeleteSessionResponse> {
		this.assertConnected()
		const response = await this.diracAgent.deleteSession(params)
		this.removeSessionSubscription(params.sessionId)
		this.initializedSessions.delete(params.sessionId)
		this.sessionInitializationPromises.delete(params.sessionId)

		return response
	}

	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		this.assertConnected()
		// Ensure we're subscribed to this session's events
		this.subscribeToSessionEvents(params.sessionId)
		await this.ensureSessionSetupUpdates(params.sessionId)
		return this.diracAgent.prompt(params)
	}

	async cancel(params: acp.CancelNotification): Promise<void> {
		this.assertConnected()
		return this.diracAgent.cancel(params)
	}

	async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
		this.assertConnected()
		return this.diracAgent.setSessionMode(params)
	}

	async setSessionConfigOption(params: acp.SetSessionConfigOptionRequest): Promise<acp.SetSessionConfigOptionResponse> {
		this.assertConnected()
		return this.diracAgent.setSessionConfigOption(params)
	}

	async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
		this.assertConnected()
		return this.diracAgent.authenticate(params)
	}

	async logout(params: acp.LogoutRequest): Promise<acp.LogoutResponse> {
		this.assertConnected()
		await this.diracAgent.logout()
		return {}
	}

	/** Release only this client transport; active Dirac sessions remain running. */
	disconnect(): void {
		if (this.disconnected) return
		this.disconnected = true
		for (const cleanup of this.sessionEventCleanup.values()) {
			for (const unsubscribe of cleanup) {
				unsubscribe()
			}
		}
		this.sessionEventCleanup.clear()
		this.subscribedSessions.clear()
		this.initializedSessions.clear()
		this.sessionInitializationPromises.clear()
	}

	async shutdown(): Promise<void> {
		this.disconnect()
		return this.diracAgent.shutdown()
	}
}
```

### /Users/highlands/pools/Development/dirac/cli/src/acp/acp-session-runtime-config.ts (lines 109-121)
```
export function copyTaskRuntimeSettings(settings: Partial<Settings>): Partial<Settings> {
	const legacyUpdates = buildLegacyModelIdStateUpdates(settings)
	const normalizedSettings: Partial<Settings> = { ...settings, ...legacyUpdates }
	normalizedSettings.planModeInferenceSpeed = normalizeInferenceSpeed(normalizedSettings.planModeInferenceSpeed)
	normalizedSettings.actModeInferenceSpeed = normalizeInferenceSpeed(normalizedSettings.actModeInferenceSpeed)

	const copy: Partial<Settings> = {}
	for (const key of TASK_RUNTIME_SETTINGS_KEYS) {
		const value = normalizedSettings[key]
			; (copy as Record<SettingsKey, unknown>)[key] = value === undefined ? undefined : structuredClone(value)
	}
	return copy
}
```

### /Users/highlands/pools/Development/dirac/cli/src/acp/acp-session-tasks.ts (lines 44-48)
```
export function deleteTasksForSession(sessionId: string): void {
	const map = readSessionTasksMap()
	delete map[sessionId]
	writeSessionTasksMap(map)
}
```

### /Users/highlands/pools/Development/dirac/cli/src/acp/acp-session-pins.ts (lines 56-60)
```
export function deletePinnedSessionMessages(sessionId: string): void {
	const map = readSessionPinsMap()
	delete map[sessionId]
	writeSessionPinsMap(map)
}
```


## Source Files:

- `cli/src/acp/ACPHostBridgeClientProvider.ts`
- `cli/src/acp/ACPTextFileAccess.ts`
- `cli/src/acp/AcpAgent.ts`
- `cli/src/acp/AcpTerminalManager.ts`
- `cli/src/acp/acp-session-pins.ts`
- `cli/src/acp/acp-session-runtime-config.ts`
- `cli/src/acp/acp-session-tasks.ts`
- `cli/src/acp/acp-session-updates.ts`
- `cli/src/acp/acp-session-worktrees.ts`
- `cli/src/acp/active-session.ts`
- `cli/src/acp/detachedServer.ts`
- `cli/src/acp/index.ts`
- `cli/src/acp/streamUtils.ts`

