import { strict as assert } from "node:assert"
import * as diracRules from "@core/context/instructions/user-instructions/dirac-rules"
import * as externalRules from "@core/context/instructions/user-instructions/external-rules"
import { RuleContextBuilder } from "@core/context/instructions/user-instructions/RuleContextBuilder"
import * as skills from "@core/context/instructions/user-instructions/skills"
import { DiracToolSet } from "@core/prompts/system-prompt"
import * as systemPrompt from "@core/prompts/system-prompt"
import * as disk from "@core/storage/disk"
import { use_subagents_spec } from "@core/task/tools/modules/use_subagents/UseSubagentsTool"
import { AgentConfigLoader } from "@core/task/tools/subagent/AgentConfigLoader"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { buildApiRequestParams, type TaskRequestBuilderContext } from "../TaskRequestBuilder"

const providerInfo = {
	providerId: "anthropic",
	model: { id: "primary-model", info: { supportsPromptCache: false } },
	mode: "act",
} as const

const nativeTools = [{ name: "native-tool" }] as any[]
const fullHistory = [
	{ role: "user", content: "first" },
	{ role: "assistant", content: "second" },
]
const deletedRange: [number, number] = [0, 0]

describe("TaskRequestBuilder", () => {
	let sandbox: sinon.SinonSandbox
	let configuredAgents: any[]

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		configuredAgents = []
		sandbox.stub(HostProvider, "env" as any).value({
			getHostVersion: sandbox.stub().resolves({ platform: "test", diracType: 0 }),
		})
		sandbox.stub(HostProvider, "window" as any).value({
			getOpenTabs: sandbox.stub().resolves({ paths: [] }),
			getVisibleTabs: sandbox.stub().resolves({ paths: [] }),
		})
		sandbox.stub(diracRules, "refreshDiracRulesToggles").resolves({ globalToggles: {}, localToggles: {} })
		sandbox.stub(diracRules, "getGlobalDiracRules").resolves({ instructions: undefined, activatedConditionalRules: [] })
		sandbox.stub(diracRules, "getLocalDiracRules").resolves({ instructions: undefined, activatedConditionalRules: [] })
		sandbox.stub(externalRules, "refreshExternalRulesToggles").resolves({
			windsurfLocalToggles: {},
			cursorLocalToggles: {},
			agentsLocalToggles: {},
		})
		sandbox.stub(externalRules, "getLocalCursorRules").resolves([undefined, undefined])
		sandbox.stub(externalRules, "getLocalWindsurfRules").resolves(undefined)
		sandbox.stub(externalRules, "getLocalAgentsRules").resolves(undefined)
		sandbox.stub(RuleContextBuilder.prototype, "buildEvaluationContext").resolves({})
		sandbox.stub(skills, "getOrDiscoverSkills").resolves([])
		sandbox.stub(disk, "ensureRulesDirectoryExists").resolves("/tmp/rules")
		sandbox.stub(disk, "ensureTaskDirectoryExists").resolves("/tmp/task")
		sandbox.stub(systemPrompt, "getSystemPrompt").resolves({ systemPrompt: "built system prompt" })
		sandbox.stub(AgentConfigLoader, "getInstance").returns({
			getAllCachedConfigsWithToolNames: () => configuredAgents,
		} as unknown as AgentConfigLoader)
	})

	afterEach(() => sandbox.restore())

	function createContext(utilityModelSelection: unknown) {
		let capturedPromptContext: SystemPromptContext | undefined
		const writePromptMetadataArtifacts = sandbox.stub().resolves()
		const getGlobalSettingsKey = sandbox.stub().callsFake((key: string) => {
			if (key === "utilityModelSelection") return utilityModelSelection
			if (key === "subagentsEnabled") return true
			return undefined
		})
		const getSnapshotForRequest = sandbox.stub().callsFake(async (context: SystemPromptContext) => {
			capturedPromptContext = context
			return {
				inventoryVersion: 1,
				requestId: "request-1",
				promptVisibleSpecs: [],
				inventoryEnabledTools: [],
				activeSkillIds: [],
				nativeTools,
				coordinator: {},
				executableToolNames: new Set(),
				dynamicSubagentToolNames: new Set(),
			}
		})
		const context = {
			taskId: "task-1",
			cwd: "/tmp/workspace",
			terminalExecutionMode: "backgroundExec",
			api: {},
			stateManager: {
				getGlobalSettingsKey,
				getGlobalStateKey: sandbox.stub().returns(undefined),
				getWorkspaceStateKey: sandbox.stub().returns(undefined),
			},
			messageStateHandler: {
				getApiConversationHistory: sandbox.stub().returns(fullHistory),
				getDiracMessages: sandbox.stub().returns([]),
			},
			taskMessenger: { upsertText: sandbox.stub().resolves() },
			toolExecutor: {
				getSnapshotForRequest,
				activateSnapshot: sandbox.stub(),
			},
			contextManager: {
				getNewContextMessagesAndMetadata: sandbox.stub().resolves({
					truncatedConversationHistory: fullHistory.map((message) => ({ ...message })),
					updatedConversationHistoryDeletedRange: false,
					conversationHistoryDeletedRange: deletedRange,
				}),
			},
			apiConversationManager: { scheduleProviderConversationCompaction: sandbox.stub().resolves() },
			diracIgnoreController: { yoloMode: false, diracIgnoreContent: undefined },
			taskState: {
				availableSkills: [],
				useNativeToolCalls: false,
				conversationHistoryDeletedRange: deletedRange,
			},
			getCurrentProviderInfo: () => providerInfo,
			isParallelToolCallingEnabled: () => false,
			writePromptMetadataArtifacts,
		} as unknown as TaskRequestBuilderContext
		return { context, getCapturedPromptContext: () => capturedPromptContext, writePromptMetadataArtifacts }
	}

	function genericSubagentProperties(context: SystemPromptContext): Record<string, unknown> {
		const [spec] = DiracToolSet.withDynamicSubagentToolSpecs([use_subagents_spec], context)
		const subagents = spec.parameters?.find((parameter) => parameter.name === "subagents")
		return subagents?.items?.properties ?? {}
	}

	it("exposes Utility routing in generic and dynamic subagent schemas for a valid selection", async () => {
		const { context, getCapturedPromptContext, writePromptMetadataArtifacts } = createContext({
			provider: "anthropic",
			modelId: "utility-model",
		})

		await buildApiRequestParams(context, { previousApiReqIndex: 0 })

		const promptContext = getCapturedPromptContext()
		assert.ok(promptContext)
		assert.equal(promptContext.utilityModelConfigured, true)
		assert.ok("use_utility_model" in genericSubagentProperties(promptContext))
		configuredAgents = [
			{
				toolName: "subagent_reviewer",
				config: {
					name: "reviewer",
					description: "Reviews code",
					tools: [],
					systemPrompt: "Review the code.",
				},
			},
		]
		const [dynamicSpec] = DiracToolSet.getDynamicSubagentToolSpecs(promptContext)
		assert.equal(dynamicSpec.parameters?.some((parameter) => parameter.name === "use_utility_model"), true)
		sinon.assert.calledOnce(writePromptMetadataArtifacts)
		assert.deepEqual(writePromptMetadataArtifacts.firstCall.args[0], {
			systemPrompt: "built system prompt",
			providerInfo,
			tools: nativeTools,
			fullHistory,
			deletedRange,
		})
	})

	it("does not expose Utility routing for absent or invalid selections", async () => {
		const selections = [
			undefined,
			{ provider: "not-a-provider", modelId: "utility-model" },
			{ provider: "anthropic", modelId: "   " },
		]

		for (const selection of selections) {
			const { context, getCapturedPromptContext, writePromptMetadataArtifacts } = createContext(selection)
			await buildApiRequestParams(context, { previousApiReqIndex: 0 })

			const promptContext = getCapturedPromptContext()
			assert.ok(promptContext)
			assert.equal(promptContext.utilityModelConfigured, false)
			assert.equal("use_utility_model" in genericSubagentProperties(promptContext), false)
			configuredAgents = [
				{
					toolName: "subagent_reviewer",
					config: {
						name: "reviewer",
						description: "Reviews code",
						tools: [],
						systemPrompt: "Review the code.",
					},
				},
			]
			const [dynamicSpec] = DiracToolSet.getDynamicSubagentToolSpecs(promptContext)
			assert.equal(dynamicSpec.parameters?.some((parameter) => parameter.name === "use_utility_model"), false)
			configuredAgents = []
			sinon.assert.calledOnce(writePromptMetadataArtifacts)
		}
	})
})
