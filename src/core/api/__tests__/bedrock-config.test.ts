import { expect } from "chai"
import * as path from "path"
import { AwsBedrockHandler } from "../providers/bedrock"

const srcDir = path.join(__dirname, "..", "..", "..")

describe("Bedrock Configuration", () => {
	describe("buildApiHandler bedrock mode handling", () => {
		it("should handle plan mode bedrock configuration", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				actModeApiProvider: "bedrock",
				planModeAwsBedrockCustomSelected: "model-1",
				actModeAwsBedrockCustomSelected: "model-2",
			}
			const planHandler = buildApiHandler(config, "plan" as const)
			const actHandler = buildApiHandler(config, "act" as const)
			expect(planHandler).to.exist
			expect(actHandler).to.exist
			expect(planHandler).to.be.instanceOf(AwsBedrockHandler)
			expect(actHandler).to.be.instanceOf(AwsBedrockHandler)
		})

		it("should handle plan mode bedrock custom model base ID", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				planModeAwsBedrockCustomModelBaseId: "claude-3-sonnet",
			}
			const handler = buildApiHandler(config, "plan" as const)
			expect(handler).to.exist
		})

		it("should handle bedrock profile configurations", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				planModeAwsBedrockProfile: "default",
			}
			const handler = buildApiHandler(config, "plan" as const)
			expect(handler).to.exist
		})

		it("should handle bedrock endpoint configuration", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				awsBedrockEndpoint: "https://custom-endpoint.amazonaws.com",
			}
			const handler = buildApiHandler(config, "plan" as const)
			expect(handler).to.exist
		})

		it("should handle bedrock awsProfile configuration", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				awsProfile: "my-profile",
			}
			const handler = buildApiHandler(config, "plan" as const)
			expect(handler).to.exist
		})

		it("should handle bedrock thinking budget tokens", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				planModeThinkingBudgetTokens: 4096,
			}
			const handler = buildApiHandler(config, "plan" as const)
			expect(handler).to.exist
		})

		it("should handle bedrock region configuration", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				awsBedrockRegion: "us-east-1",
			}
			const handler = buildApiHandler(config, "plan" as const)
			expect(handler).to.exist
		})

		it("should handle bedrock startConversation configuration", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				awsBedrockStartConversation: true,
			}
			const handler = buildApiHandler(config, "plan" as const)
			expect(handler).to.exist
		})

		it("should handle bedrock updateConversation configuration", async () => {
			const { buildApiHandler } = await import(path.join(srcDir, "core", "api", "index.ts"))
			const config = {
				apiKey: "test-key",
				planModeApiProvider: "bedrock",
				awsBedrockUpdateConversation: true,
			}
			const handler = buildApiHandler(config, "plan" as const)
			expect(handler).to.exist
		})
	})
})
