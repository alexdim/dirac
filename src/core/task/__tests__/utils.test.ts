import assert from "node:assert/strict"
import { afterEach, describe, it } from "mocha"
import proxyquire from "proxyquire"
import sinon from "sinon"
import { extractProviderDomainFromUrl } from "../utils"

describe("src/core/task/utils", () => {
	describe("detectAvailableCliTools", () => {
		const sandbox = sinon.createSandbox()

		afterEach(() => {
			sandbox.restore()
		})

		function loadWithExecFileSync(execFileSync: sinon.SinonStub) {
			return proxyquire.noCallThru().load("../utils", {
				child_process: { execFileSync },
			}).detectAvailableCliTools as () => Promise<string[]>
		}

		it("checks each tool with an argument array (no shell interpolation)", async () => {
			const execFileSync = sandbox.stub().returns(Buffer.from(""))
			const detectAvailableCliTools = loadWithExecFileSync(execFileSync)

			const result = await detectAvailableCliTools()

			assert.ok(execFileSync.called)
			for (const call of execFileSync.getCalls()) {
				const checkCommand = call.args[0] as string
				const args = call.args[1] as string[]
				assert.ok(checkCommand === "which" || checkCommand === "where")
				// The tool name must be passed as a separate element of the argument array
				assert.ok(Array.isArray(args), "Command args must be passed as an array")
				assert.strictEqual(args.length, 1, "Args array must contain exactly 1 element")
			}
			assert.ok(result.includes("git"))
			assert.ok(result.includes("node"))
		})

		it("reports only the tools whose availability check succeeds", async () => {
			const execFileSync = sandbox.stub().callsFake((_checkCommand: string, args?: ReadonlyArray<string>) => {
				const tool = args?.[0]
				if (tool === "git" || tool === "gh") {
					return Buffer.from(`/usr/bin/${tool}`)
				}
				throw new Error(`Command failed: ${tool} not found`)
			})
			const detectAvailableCliTools = loadWithExecFileSync(execFileSync)

			const result = await detectAvailableCliTools()

			assert.deepEqual(result, ["gh", "git"])
		})

		it("skips a tool when its availability check throws", async () => {
			const execFileSync = sandbox.stub().callsFake((_checkCommand: string, args?: ReadonlyArray<string>) => {
				if (args?.[0] === "curl") {
					throw new Error("execFileSync curl ENOENT")
				}
				return Buffer.from("")
			})
			const detectAvailableCliTools = loadWithExecFileSync(execFileSync)

			const result = await detectAvailableCliTools()

			assert.ok(result.includes("git"))
			assert.ok(!result.includes("curl"))
		})

		it("runs live detection without throwing", async () => {
			const { detectAvailableCliTools } = await import("../utils")
			const result = await detectAvailableCliTools()
			assert.ok(Array.isArray(result))
		})
	})

	describe("extractProviderDomainFromUrl", () => {
		it("returns undefined for undefined url", () => {
			assert.strictEqual(extractProviderDomainFromUrl(undefined), undefined)
		})

		it("returns undefined for empty string", () => {
			assert.strictEqual(extractProviderDomainFromUrl(""), undefined)
		})

		it("extracts hostname from valid URL", () => {
			assert.strictEqual(extractProviderDomainFromUrl("https://api.openai.com/v1"), "api.openai.com")
			assert.strictEqual(extractProviderDomainFromUrl("http://localhost:11434"), "localhost")
		})

		it("returns undefined for invalid URL", () => {
			assert.strictEqual(extractProviderDomainFromUrl("not-a-valid-url"), undefined)
		})
	})
})
