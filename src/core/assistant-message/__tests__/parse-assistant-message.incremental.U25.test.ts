import { describe, it } from "mocha"

describe("T-PARSE-INCREMENTAL U25", () => {
	it.skip("does not reparse the complete 1k-character stream for every appended character", () => {
		// The production parser currently accepts only the complete accumulated string.
		// Keep this skipped characterization until an incremental parser exposes a
		// bounded-update interface that can be instrumented for the O(N²) regression.
	})
})
