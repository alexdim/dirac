import { strict as assert } from "node:assert"
import type { ApiStream, ApiStreamChunk } from "@core/api/transform/stream"
import type { ModelProviderSelection } from "@shared/api"
import type { DiracStorageMessage } from "@shared/messages/content"
import { describe, it, afterEach } from "mocha"
import sinon from "sinon"
import { SurfaceAdapter } from "../SurfaceAdapter"
import {
    buildConversationCondensationTrait,
    ConversationCondensationUnavailableError,
} from "../traits/ConversationCondensationTraitBuilder"
import { createMockTaskConfig } from "../../__tests__/helpers/mockTaskConfig"
import type { UtilityModelRequest } from "@core/utility-model/UtilityModelRunner"
import * as utilityModel from "@core/utility-model/UtilityModelRunner"

const selection: ModelProviderSelection = {
	provider: "openai",
	modelId: "utility-model",
}

function textStream(text: string): ApiStream {
	return (async function* (): AsyncGenerator<ApiStreamChunk> {
		yield { type: "text", text }
	})()
}

function createEnvironment(history: DiracStorageMessage[] = [{ role: "user", content: "current task request" }]) {
	const { config } = createMockTaskConfig()
	const settings: Record<string, unknown> = {
		utilityModelEnabled: true,
		utilityModelSelection: selection,
	}
	const getApiConfiguration = sinon.stub().returns({
		actModeApiProvider: "openai",
		actModeApiModelId: "active-model",
		openAiApiKey: "active-key",
	})

	config.services.stateManager = {
		getGlobalSettingsKey: (key: string) => settings[key],
		getApiConfiguration,
	} as any
	config.services.contextManager = {
		getTruncatedMessages: (messages: DiracStorageMessage[]) => messages,
	} as any
	config.messageState.getApiConversationHistory = sinon.stub().returns(history)

	return { config, settings, getApiConfiguration }
}

afterEach(() => sinon.restore())

describe("ConversationCondensationTraitBuilder", () => {
	it("is unavailable when the utility model feature is disabled", async () => {
		const { config, settings } = createEnvironment()
		settings.utilityModelEnabled = false
		const trait = buildConversationCondensationTrait(config)

		assert.equal(trait.isAvailable("conversation_continuation"), false)
		await assert.rejects(
			() => trait.condenseConversation("conversation_continuation"),
			ConversationCondensationUnavailableError,
		)
	})

	it("is unavailable when the utility model selection is missing", () => {
		const { config, settings } = createEnvironment()
		settings.utilityModelSelection = undefined
		const trait = buildConversationCondensationTrait(config)

		assert.equal(trait.isAvailable("conversation_continuation"), false)
	})

	it("is unavailable when the requested template is not registered", () => {
		const { config } = createEnvironment()
		const trait = buildConversationCondensationTrait(config)

		assert.equal(trait.isAvailable("unregistered-template"), false)
	})

	it("is available only when settings and a registered template are present without constructing a utility runner", () => {
		const { config } = createEnvironment()
		const createRunner = sinon.stub(utilityModel, "createUtilityModelRunner")
		const trait = buildConversationCondensationTrait(config)

		assert.equal(trait.isAvailable("conversation_continuation"), true)
		sinon.assert.notCalled(createRunner)
	})

	it("reads current settings for each call without rebuilding or replacing the active task API", async () => {
		const { config, settings, getApiConfiguration } = createEnvironment()
		const activeApi = config.api
		const requests: UtilityModelRequest[] = []
		const updatedSelection: ModelProviderSelection = { provider: "openai", modelId: "updated-utility-model" }
		const createRunner = sinon.stub(utilityModel, "createUtilityModelRunner").returns({
			run(request: UtilityModelRequest) {
				requests.push(request)
				return textStream("complete condensation")
			},
		} as ReturnType<typeof utilityModel.createUtilityModelRunner>)
		const trait = buildConversationCondensationTrait(config)

		settings.utilityModelEnabled = false
		assert.equal(trait.isAvailable("conversation_continuation"), false)
		settings.utilityModelEnabled = true
		settings.utilityModelSelection = updatedSelection
		assert.equal(trait.isAvailable("conversation_continuation"), true)
		sinon.assert.notCalled(createRunner)

		assert.equal(await trait.condenseConversation("conversation_continuation"), "complete condensation")
		assert.equal(config.api, activeApi)
		assert.equal(requests.length, 1)
		sinon.assert.calledOnceWithExactly(createRunner, getApiConfiguration.returnValues[0], updatedSelection, { ulid: config.ulid })
	})

	it("serializes history from the current task only", async () => {
		const history: DiracStorageMessage[] = [{ role: "user", content: "current task-only history" }]
		const { config } = createEnvironment(history)
		const requests: UtilityModelRequest[] = []
		sinon.stub(utilityModel, "createUtilityModelRunner").returns({
			run(request: UtilityModelRequest) {
				requests.push(request)
				return textStream("complete condensation")
			},
		} as ReturnType<typeof utilityModel.createUtilityModelRunner>)
		const trait = buildConversationCondensationTrait(config)

		await trait.condenseConversation("conversation_continuation")

		assert.equal(config.messageState.getApiConversationHistory.callCount, 1)
		assert.match(requests[0].messages[0].content as string, /current task-only history/)
		assert.deepEqual(history, [{ role: "user", content: "current task-only history" }])
	})

	it("exposes a narrow facade for parent tasks and no capability for subagents", () => {
		const { config } = createEnvironment()
		config.isSubagentExecution = false
		const parentEnvironment = new SurfaceAdapter(config)

		assert.ok(parentEnvironment.conversationCondensation)
		assert.equal("api" in parentEnvironment.conversationCondensation!, false)
		assert.equal("createHandler" in parentEnvironment.conversationCondensation!, false)

		config.isSubagentExecution = true
		const subagentEnvironment = new SurfaceAdapter(config)
		assert.equal(subagentEnvironment.conversationCondensation, undefined)
	})
})
