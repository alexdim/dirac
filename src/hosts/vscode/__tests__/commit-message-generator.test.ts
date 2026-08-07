import { strict as assert } from "node:assert"
import * as api from "@core/api"
import type { ApiStream } from "@core/api/transform/stream"
import type { Controller } from "@core/controller"
import type { ApiConfiguration, ModelProviderSelection } from "@shared/api"
import type { DiracStorageMessage } from "@shared/messages/content"
import * as utilityModel from "@core/utility-model/UtilityModelRunner"
import { afterEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import * as gitUtils from "@/utils/git"
import { createConfiguredCommitMessageStream, getGitDiffStagedFirst } from "../commit-message-generator"

describe("commit-message-generator", () => {
	describe("getGitDiffStagedFirst", () => {
		afterEach(() => {
			sinon.restore()
		})

		it("should return staged changes when they exist", async () => {
			const stub = sinon.stub(gitUtils, "getGitDiff")
			stub.withArgs("/repo", true).resolves("staged diff content")

			const result = await getGitDiffStagedFirst("/repo")
			result.should.equal("staged diff content")
			stub.calledOnceWith("/repo", true).should.be.true()
		})

		it("should fall back to all changes when no staged changes exist", async () => {
			const stub = sinon.stub(gitUtils, "getGitDiff")
			stub.withArgs("/repo", true).rejects(new Error("No changes in workspace for commit message"))
			stub.withArgs("/repo", false).resolves("all diff content")

			const result = await getGitDiffStagedFirst("/repo")
			result.should.equal("all diff content")
			stub.calledTwice.should.be.true()
			stub.firstCall.args.should.deepEqual(["/repo", true])
			stub.secondCall.args.should.deepEqual(["/repo", false])
		})

		it("should propagate error when both staged and all changes fail", async () => {
			const stub = sinon.stub(gitUtils, "getGitDiff")
			stub.withArgs("/repo", true).rejects(new Error("No changes"))
			stub.withArgs("/repo", false).rejects(new Error("No changes in workspace for commit message"))

			let error: Error | undefined
			try {
				await getGitDiffStagedFirst("/repo")
			} catch (e) {
				error = e as Error
			}
			;(error !== undefined).should.be.true()
			error!.message.should.equal("No changes in workspace for commit message")
		})
	})
})

async function* emptyStream(): ApiStream {}

function createController(settings: Record<string, unknown>, apiConfiguration: ApiConfiguration): Controller {
	return {
		stateManager: {
			getApiConfiguration: () => apiConfiguration,
			getGlobalSettingsKey: (key: string) => settings[key],
		},
	} as unknown as Controller
}

describe("createConfiguredCommitMessageStream", () => {
	afterEach(() => sinon.restore())

	const messages: DiracStorageMessage[] = [{ role: "user", content: "commit prompt" }]

	it("uses the existing Act-mode handler when commit-message Utility use is disabled", () => {
		const selection: ModelProviderSelection = { provider: "openai", modelId: "utility-model" }
		const apiConfiguration: ApiConfiguration = { actModeApiProvider: "openai", actModeOpenAiModelId: "act-model" }
		const controller = createController(
			{ utilityModelUseGenerateCommitMessage: false, utilityModelSelection: selection },
			apiConfiguration,
		)
		const expectedStream = emptyStream()
		const createMessage = sinon.stub().returns(expectedStream)
		const buildApiHandler = sinon.stub(api, "buildApiHandler").returns({ createMessage } as any)
		const createUtilityModelRunner = sinon.stub(utilityModel, "createUtilityModelRunner")
		const signal = new AbortController().signal

		const stream = createConfiguredCommitMessageStream(controller, "system prompt", messages, signal)

		assert.equal(stream, expectedStream)
		sinon.assert.calledOnceWithExactly(buildApiHandler, apiConfiguration, "act")
		sinon.assert.calledOnceWithExactly(createMessage, "system prompt", messages)
		sinon.assert.notCalled(createUtilityModelRunner)
	})

	it("uses the selected Utility model and forwards the unchanged prompt when enabled", () => {
		const selection: ModelProviderSelection = { provider: "openai", modelId: "utility-model" }
		const apiConfiguration: ApiConfiguration = { actModeApiProvider: "openai", actModeOpenAiModelId: "act-model" }
		const controller = createController(
			{ utilityModelUseGenerateCommitMessage: true, utilityModelSelection: selection },
			apiConfiguration,
		)
		const expectedStream = emptyStream()
		const run = sinon.stub().returns(expectedStream)
		const createUtilityModelRunner = sinon
			.stub(utilityModel, "createUtilityModelRunner")
			.returns({ run } as unknown as ReturnType<typeof utilityModel.createUtilityModelRunner>)
		const buildApiHandler = sinon.stub(api, "buildApiHandler")
		const signal = new AbortController().signal

		const stream = createConfiguredCommitMessageStream(controller, "system prompt", messages, signal)

		assert.equal(stream, expectedStream)
		sinon.assert.calledOnceWithExactly(createUtilityModelRunner, apiConfiguration, selection)
		sinon.assert.calledOnceWithExactly(run, { systemPrompt: "system prompt", messages, signal })
		sinon.assert.notCalled(buildApiHandler)
	})

	it("falls back to the Act model when commit-message Utility use has no selection", () => {
		const apiConfiguration: ApiConfiguration = { actModeApiProvider: "openai", actModeOpenAiModelId: "act-model" }
		const controller = createController({ utilityModelUseGenerateCommitMessage: true }, apiConfiguration)
		const expectedStream = emptyStream()
		const createMessage = sinon.stub().returns(expectedStream)
		const createUtilityModelRunner = sinon.stub(utilityModel, "createUtilityModelRunner")
		const buildApiHandler = sinon.stub(api, "buildApiHandler").returns({ createMessage } as any)

		const stream = createConfiguredCommitMessageStream(controller, "system prompt", messages, new AbortController().signal)

		assert.equal(stream, expectedStream)
		sinon.assert.notCalled(createUtilityModelRunner)
		sinon.assert.calledOnceWithExactly(buildApiHandler, apiConfiguration, "act")
	})

	it("uses the legacy switch when the independent commit-message setting is absent", () => {
		const selection: ModelProviderSelection = { provider: "openai", modelId: "utility-model" }
		const apiConfiguration: ApiConfiguration = { actModeApiProvider: "openai", actModeOpenAiModelId: "act-model" }
		const controller = createController({ utilityModelEnabled: true, utilityModelSelection: selection }, apiConfiguration)
		const expectedStream = emptyStream()
		const run = sinon.stub().returns(expectedStream)
		const createUtilityModelRunner = sinon
			.stub(utilityModel, "createUtilityModelRunner")
			.returns({ run } as unknown as ReturnType<typeof utilityModel.createUtilityModelRunner>)

		const stream = createConfiguredCommitMessageStream(controller, "system prompt", messages, new AbortController().signal)

		assert.equal(stream, expectedStream)
		sinon.assert.calledOnceWithExactly(createUtilityModelRunner, apiConfiguration, selection)
	})
})
