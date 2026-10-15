---
component_id: 2.3
component_name: ACP Server & Dirac Agent Adapter
---

# ACP Server & Dirac Agent Adapter

## Component Description

Runs the Agent Client Protocol (ACP) server mode, manages ACP session state and host bridge clients, and adapts Dirac agent sessions and diffs to ACP protocol streams.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/acp/index.ts (lines 115-199)
```
export async function runAcpMode(options: AcpModeOptions = {}): Promise<void> {
  redirectConsoleToStderr();
  configureCliLogDirectoryFromDiracHome(options.config);
  initAcpFileLogger();

  // Opt-in debug tap: mirror all Logger output to stderr when DIRAC_ACP_DEBUG is set.
  const unsubscribeDebugLogger = process.env.DIRAC_ACP_DEBUG
    ? Logger.subscribe((msg) => originalConsole.error(`[LOG] ${msg}`))
    : undefined;

  if (options.listen) {
    try {
      await runDetachedAcpMode(options, unsubscribeDebugLogger);
    } catch (error) {
      await disposeAcpModeLogging(unsubscribeDebugLogger);
      throw error;
    }
    return;
  }

  const outputStream = nodeToWebWritable(process.stdout);
  const inputStream = nodeToWebReadable(process.stdin);
  const stream = createResilientNdJsonStream(outputStream, inputStream);
  let agent: AcpAgent | null = null;

  try {
    new AgentSideConnection((conn) => {
      agent = new AcpAgent(conn, {
        debug: Boolean(options.verbose),
        diracDir: options.config,
        cwd: options.cwd,
        provider: options.provider,
        model: options.model,
        mode: options.mode,
        autoApprove: options.autoApprove,
        yolo: options.yolo,
        thinkingBudgetTokens: options.thinkingBudgetTokens,
        reasoningEffort: options.reasoningEffort,
        inferenceSpeed: options.inferenceSpeed,
        hooksDir: options.hooksDir,
      });
      return agent;
    }, stream);
  } catch (error) {
    await disposeAcpModeLogging(unsubscribeDebugLogger);
    throw error;
  }

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) {
      // Force exit on second signal
      process.exit(1);
    }
    isShuttingDown = true;
    try {
      await agent?.shutdown();
    } catch (error) {
      Logger.error("[ACP] Error during shutdown:", error);
    } finally {
      await disposeAcpModeLogging(unsubscribeDebugLogger);
    }

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the process alive
  // The ndJsonStream will handle stdin events automatically.
  // We need to ensure the process doesn't exit while waiting for input.
  process.stdin.resume();

  // Handle stdin end (client disconnected)
  process.stdin.on("end", shutdown);

  // Handle stdin errors
  process.stdin.on("error", async (error) => {
    Logger.error("[ACP] stdin error:", error);
    await shutdown();
  });

  Logger.info("[ACP] Process is now listening for ACP requests on stdin");
}
```

### /Users/highlands/pools/Development/dirac/cli/src/agent/DiracAgent.ts (lines 1143-1215)
```
	async initialize(params: acp.InitializeRequest, connection?: acp.AgentSideConnection): Promise<acp.InitializeResponse> {
		this.ctx = initializeCliContext({
			diracDir: this.options.diracDir,
			workspaceDir: this.options.cwd,
		})
		DiracTempManager.startPeriodicCleanup()
		this.clientCapabilities = params.clientCapabilities
		this.initializeHostProvider(this.clientCapabilities, connection)
		// Shared with initializeCli — see initCoreServices for why both modes
		// must route through it.
		await initCoreServices({
			extensionDir: this.ctx.EXTENSION_DIR,
			storageContext: this.ctx.storageContext,
		})
		this.applyStartupProviderInfrastructure()
		const startupOverrides = this.createStartupSessionOverrides()
		const authMethods = this.authentication.listAuthenticationMethods(
			this.isStartupProviderConfigured(startupOverrides),
			this.clientCapabilities,
		)

		return {
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {
				_meta: {
					"dev.dirac/session.close": true,
					"dev.dirac/session.delete": true,
					...(this.options.detached ? { "dev.dirac/detached_mode": true } : {}),
					"dev.dirac/auth.logout": true,

					"dev.dirac/seq": true,

					"dev.dirac/permissions.list": true,
					"dev.dirac/permissions.delete": true,

					"dev.dirac/whisper": true,
					"dev.dirac/steering_status": true,
					"dev.dirac/client_annotation": true,

					"dev.dirac/checkpoints.list": true,
					"dev.dirac/checkpoints.restore": true,
					"dev.dirac/messages.pin": true,
					"dev.dirac/messages.unpin": true,
					"dev.dirac/messages.pinned": true,
					"dev.dirac/pinned_messages_update": true,
					"dev.dirac/permission.effect_previews": true,
					"dev.dirac/worktree.provision": {
						requestMetaKey: "dev.dirac/worktree",
						requestShape: "true | { baseBranch?: string }",
					},
					"dev.dirac/worktree.integrate": true,
				},
				loadSession: true,
				auth: { logout: {} },
				providers: {},
				sessionCapabilities: {
					resume: {},
					close: {},
					delete: {},
				},
				promptCapabilities: {
					image: true,
					audio: false,
					embeddedContext: true,
				},
			},
			agentInfo: {
				name: "dirac",
				version: AGENT_VERSION,
			},
			authMethods,
		}
	}
```

### /Users/highlands/pools/Development/dirac/cli/src/agent/DiracAgent.ts (lines 1345-1452)
```
	async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
		const sessionId = params.sessionId
		const existingSession = this.sessions.get(sessionId)
		if (existingSession) {
			return this.runSessionRuntimeMutation(sessionId, async () => {
				const configOptions = await this.getNormalizedConfigOptions(existingSession)
				const sessionOverrides = this.acpSessionOverrides.get(sessionId)!
				return {
					modes: this.sessionConfig.getSessionModeState(existingSession.mode, sessionOverrides),
					configOptions,
				}
			})
		}

		Logger.debug("[DiracAgent] loadSession called:", { sessionId })

		const persistedRuntimeConfig = getSessionRuntimeConfig(this.ctx.DATA_DIR, sessionId)
		if (!persistedRuntimeConfig) {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.SessionRuntimeMissing,
				`Task runtime configuration not found for ACP session ${sessionId}; this session predates task-owned runtime configuration and cannot be loaded safely`,
				"Start a new session under the current provider and model settings.",
			)
		}
		const persistedMode = persistedRuntimeConfig.settings.mode
		if (persistedMode !== "plan" && persistedMode !== "act") {
			throw new ApiConfigurationError(
				ApiConfigurationErrorCode.SessionRuntimeMalformed,
				`Task runtime configuration for ACP session ${sessionId} has no valid mode`,
				"Start a new session or repair/remove the corrupted runtime record before retrying.",
			)
		}

		const history = resolveHistorySession(sessionId, persistedRuntimeConfig.taskId ?? getLatestTaskIdForSession(sessionId))
		if (
			!history &&
			getSessionUpdates(sessionId).some(
				(entry) =>
					entry.kind === "session_update" &&
					["user_message_chunk", "agent_message_chunk", "tool_call", "tool_call_update"].includes(
						entry.update.sessionUpdate,
					),
			)
		) {
			throw new Error(`Persisted conversation history not found for ACP session ${sessionId}`)
		}
		const persistedHistory = history?.historyItem

		const ownedWorktree = getSessionWorktree(sessionId)
		if (ownedWorktree) {
			try {
				await fs.access(ownedWorktree.worktreePath)
			} catch {
				throw new Error(
					`ACP session ${sessionId} owns a missing worktree at ${ownedWorktree.worktreePath}; restore it or delete the session before loading`,
				)
			}
		}

		const historyCwd =
			ownedWorktree?.worktreePath ??
			(persistedHistory
				? getHistoryItemCwd(persistedHistory, params.cwd, this.options.cwd)
				: persistedRuntimeConfig.cwd || params.cwd || this.options.cwd)
		if (!historyCwd) throw new Error(`Working directory not found for ACP session ${sessionId}`)

		const controller = new Controller(this.ctx.extensionContext, {
			workspaceCwd: historyCwd,
		})

		const session: DiracAcpSession = {
			sessionId,
			cwd: historyCwd,
			mode: persistedMode,
			createdAt: persistedRuntimeConfig.createdAt ?? Date.now(),
			lastActivityAt: Date.now(),
			...(persistedHistory
				? {
					isLoadedFromHistory: true,
					loadedTaskId: history!.taskId,
					taskId: history!.taskId,
				}
				: {}),
		}
		const sessionOverrides = copyTaskRuntimeSettings(persistedRuntimeConfig.settings)
		const configOptions = await this.sessionConfig.getSessionConfigOptions(session, sessionOverrides)
		const loadRuntime = StateManager.get().captureEffectiveTaskConfiguration(sessionOverrides)
		validateApiConfiguration(loadRuntime.apiConfiguration as ApiConfiguration, persistedMode)

		if (history) {
			await controller.getTaskWithId(history.taskId)
		}

		this.#sessionControllers.set(session, controller)
		this.sessions.set(sessionId, session)
		this.acpSessionOverrides.set(sessionId, sessionOverrides)
		this.sessionStates.set(sessionId, {
			sessionId,
			status: AcpSessionStatus.Idle,
			pendingToolCalls: new Map(),
		})
		this.writeSessionRuntimeConfig(session, sessionOverrides)

		return {
			modes: this.sessionConfig.getSessionModeState(session.mode, sessionOverrides),
			configOptions,
		}
	}
```

### /Users/highlands/pools/Development/dirac/cli/src/agent/AcpAuthenticationManager.ts (lines 88-102)
```
	async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
		if (params.methodId === DIRAC_PROVIDER_SETUP_AUTH_METHOD_ID) {
			await this.providerSetup.authenticate()
			return {}
		}
		if (params.methodId === OPENAI_CODEX_AUTH_METHOD_ID) {
			const authorizationUrl = openAiCodexOAuthManager.startAuthorizationFlow()
			await openUrlInBrowser(authorizationUrl)
			await openAiCodexOAuthManager.waitForCallback()
			await applyProviderConfig({ providerId: "openai-codex" })
			openAiCodexUsageService.clear()
			return {}
		}
		throw new Error(`Unsupported authentication method: ${params.methodId}`)
	}
```

### /Users/highlands/pools/Development/dirac/cli/src/agent/diffUtils.ts (lines 16-86)
```
export function parseUnifiedDiff(content: string): ComputedDiff {
	const lines = content.split("\n")
	const blocks: DiffBlock[] = []
	let currentLines: DiffLine[] = []
	let additions = 0
	let deletions = 0
	let totalAdditions = 0
	let totalDeletions = 0
	let oldLineNum = 0
	let newLineNum = 0
	let inHunk = false

	for (const line of lines) {
		// Detect hunk header: @@ -oldStart,oldCount +newStart,newCount @@
		const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
		if (hunkMatch) {
			// Flush previous block
			if (currentLines.length > 0) {
				blocks.push({ lines: currentLines, additions, deletions })
				totalAdditions += additions
				totalDeletions += deletions
			}
			currentLines = []
			additions = 0
			deletions = 0
			oldLineNum = parseInt(hunkMatch[1], 10)
			newLineNum = parseInt(hunkMatch[2], 10)
			inHunk = true
			continue
		}

		if (!inHunk) continue

		if (line.startsWith("-")) {
			currentLines.push({
				type: "remove",
				content: line.slice(1),
				oldLineNumber: oldLineNum,
			})
			oldLineNum++
			deletions++
		} else if (line.startsWith("+")) {
			currentLines.push({
				type: "add",
				content: line.slice(1),
				newLineNumber: newLineNum,
			})
			newLineNum++
			additions++
		} else {
			// Context line (starts with space) or other non-hunk line
			currentLines.push({
				type: "context",
				content: line.startsWith(" ") ? line.slice(1) : line,
				oldLineNumber: oldLineNum,
				newLineNumber: newLineNum,
			})
			oldLineNum++
			newLineNum++
		}
	}

	// Flush last block
	if (currentLines.length > 0) {
		blocks.push({ lines: currentLines, additions, deletions })
		totalAdditions += additions
		totalDeletions += deletions
	}

	return { blocks, totalAdditions, totalDeletions }
}
```


## Source Files:

- `cli/acp-spawn-debug.mjs`
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
- `cli/src/agent/AcpAuthenticationManager.ts`
- `cli/src/agent/AcpProviderSetup.ts`
- `cli/src/agent/DiracAgent.ts`
- `cli/src/agent/DiracSessionEmitter.ts`
- `cli/src/agent/browserActionTranslator.ts`
- `cli/src/agent/diffUtils.ts`
- `cli/src/agent/messageTranslator.ts`
- `cli/src/agent/permissionHandler.ts`
- `cli/src/agent/promptContent.ts`
- `cli/src/agent/providerConfiguration.ts`
- `cli/src/agent/public-types.ts`
- `cli/src/agent/questionCard.ts`
- `cli/src/agent/review.ts`
- `cli/src/agent/sessionConfig.ts`
- `cli/src/agent/sessionHistory.ts`
- `cli/src/agent/taskMessageBridge.ts`
- `private/plans/scc-prototype.mjs`

