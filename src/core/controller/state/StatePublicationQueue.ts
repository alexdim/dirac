export type StatePublisher<TState> = (state: TState, sequenceNumber: number) => Promise<void>

interface PublicationWaiter {
	targetGeneration: number
	resolve: () => void
	reject: (error: unknown) => void
}

/** Serializes whole-state assembly and publication while coalescing redundant requests. */
export class StatePublicationQueue<TState> {
	private requestedGeneration = 0
	private publishedGeneration = 0
	private isDraining = false
	private readonly waiters: PublicationWaiter[] = []
	private sequenceNumber = 0

	constructor(
		private readonly readState: () => Promise<TState>,
		private readonly publishState: StatePublisher<TState>,
	) {}

	requestPublication(): Promise<void> {
		const targetGeneration = ++this.requestedGeneration
		const completion = new Promise<void>((resolve, reject) => {
			this.waiters.push({ targetGeneration, resolve, reject })
		})
		if (!this.isDraining) {
			this.isDraining = true
			void this.drainPublications()
		}
		return completion
	}

	private async drainPublications(): Promise<void> {
		await Promise.resolve()
		try {
			while (this.publishedGeneration < this.requestedGeneration) {
				const targetGeneration = this.requestedGeneration
				const state = await this.readState()
				// State assembly is asynchronous. A newer request means this snapshot may
				// contain settings sampled before that request and must not reach the UI.
				if (targetGeneration !== this.requestedGeneration) continue
				const sequenceNumber = ++this.sequenceNumber
				await this.publishState(state, sequenceNumber)
				this.publishedGeneration = targetGeneration
				this.resolvePublishedWaiters()
			}
		} catch (error) {
			this.rejectPendingWaiters(error)
		} finally {
			this.isDraining = false
		}
	}

	private resolvePublishedWaiters(): void {
		const pending: PublicationWaiter[] = []
		for (const waiter of this.waiters) {
			if (waiter.targetGeneration <= this.publishedGeneration) waiter.resolve()
			else pending.push(waiter)
		}
		this.waiters.splice(0, this.waiters.length, ...pending)
	}

	private rejectPendingWaiters(error: unknown): void {
		const waiters = this.waiters.splice(0)
		for (const waiter of waiters) waiter.reject(error)
	}
}
