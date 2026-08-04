import assert from "node:assert/strict"
import { describe, it } from "mocha"
import * as sinon from "sinon"
import { CommandExecutor } from "./CommandExecutor"
import type { CommandExecutorCallbacks, ITerminalManager } from "./types"

describe("CommandExecutor cancellation", () => {
	it("waits for foreground process termination before reporting cancellation", async () => {
		const clock = sinon.useFakeTimers()
		try {
			let finishTermination!: () => void
			const termination = new Promise<void>((resolve) => {
				finishTermination = resolve
			})
			const terminate = sinon.stub().returns(termination)
			const executor = new CommandExecutor(
				{
					cwd: "/tmp",
					taskId: "task",
					ulid: "ulid",
					terminalExecutionMode: "vscodeTerminal",
					terminalManager: {} as ITerminalManager,
				},
				createCallbacks(),
			)
			;(executor as any).currentProcess = { terminate }

			let cancellationSettled = false
			const cancellation = executor.cancelBackgroundCommand().then((result) => {
				cancellationSettled = true
				return result
			})

			await clock.tickAsync(300)
			assert.equal(cancellationSettled, false)

			finishTermination()
			await clock.tickAsync(300)

			assert.equal(await cancellation, true)
			assert.equal(terminate.callCount, 1)
		} finally {
			clock.restore()
		}
	})
})

function createCallbacks(): CommandExecutorCallbacks {
	return {
		taskMessenger: {} as any,
		updateBackgroundCommandState: () => {},
		updateDiracMessage: async () => {},
		getDiracMessages: () => [],
		addToUserMessageContent: () => {},
		getEnvironmentVariables: async () => undefined,
	}
}
