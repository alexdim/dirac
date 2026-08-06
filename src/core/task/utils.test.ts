import assert from "node:assert/strict"
import { afterEach, describe, it } from "mocha"
import proxyquire from "proxyquire"
import sinon from "sinon"

describe("detectAvailableCliTools", () => {
	const sandbox = sinon.createSandbox()

	afterEach(() => {
		sandbox.restore()
	})

	function loadWithSpawnSync(spawnSync: sinon.SinonStub) {
		return proxyquire.noCallThru().load("./utils", { child_process: { spawnSync } }).detectAvailableCliTools as () => Promise<
			string[]
		>
	}

	it("checks each tool with an argument array (no shell interpolation)", async () => {
		const spawnSync = sandbox.stub().returns({ status: 0, stdout: "", stderr: "", signal: null })
		const detectAvailableCliTools = loadWithSpawnSync(spawnSync)

		const result = await detectAvailableCliTools()

		assert.ok(spawnSync.called)
		for (const call of spawnSync.getCalls()) {
			const checkCommand = call.args[0] as string
			const args = call.args[1] as string[]
			assert.ok(checkCommand === "which" || checkCommand === "where")
			// The tool name must be passed as a separate element of the argument
			// array — never interpolated into a shell command string.
			assert.ok(Array.isArray(args))
			assert.strictEqual(args.length, 1)
		}
		assert.ok(result.includes("git"))
	})

	it("reports only the tools whose availability check succeeds", async () => {
		const spawnSync = sandbox
			.stub()
			.callsFake((_checkCommand: string, args?: ReadonlyArray<string>) => ({ status: args?.[0] === "git" ? 0 : 1 }))
		const detectAvailableCliTools = loadWithSpawnSync(spawnSync)

		const result = await detectAvailableCliTools()

		assert.deepEqual(result, ["git"])
	})

	it("skips a tool when its availability check throws", async () => {
		const spawnSync = sandbox.stub().callsFake((_checkCommand: string, args?: ReadonlyArray<string>) => {
			if (args?.[0] === "curl") throw new Error("boom")
			return { status: 0 }
		})
		const detectAvailableCliTools = loadWithSpawnSync(spawnSync)

		const result = await detectAvailableCliTools()

		assert.ok(result.includes("git"))
		assert.ok(!result.includes("curl"))
	})
})
