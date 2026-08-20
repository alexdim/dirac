import type { FSWatcher } from "chokidar"
import { describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { ChokidarWatcherCloser } from "./ChokidarWatcherCloser"

describe("ChokidarWatcherCloser", () => {
	it("shares an in-flight close with disposal", async () => {
		let releaseClose!: () => void
		const pendingClose = new Promise<void>((resolve) => {
			releaseClose = resolve
		})
		const close = sinon.stub().returns(pendingClose)
		const watcher = { close } as unknown as FSWatcher
		const closer = new ChokidarWatcherCloser()

		const runtimeClosure = closer.close(watcher)
		const disposal = closer.closeAll()

		close.calledOnce.should.be.true()
		releaseClose()
		await Promise.all([runtimeClosure, disposal])
	})

	it("retains a watcher for a disposal retry when close fails", async () => {
		const closeFailure = new Error("injected close failure")
		const close = sinon.stub()
		close.onFirstCall().rejects(closeFailure)
		close.onSecondCall().resolves()
		const watcher = { close } as unknown as FSWatcher
		const closer = new ChokidarWatcherCloser()

		await closer.close(watcher).catch(() => undefined)
		await closer.closeAll()

		close.calledTwice.should.be.true()
	})
})
