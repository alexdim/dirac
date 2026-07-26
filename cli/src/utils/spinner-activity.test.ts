import { describe, expect, it } from "vitest"
import { CardStatus, DiracMessageType } from "@shared/ExtensionMessage"
import { getSpinnerActivity } from "./spinner-activity"

describe("getSpinnerActivity", () => {
	it("does not treat a completed API status as permanent activity", () => {
		expect(
			getSpinnerActivity({
				isApiRequestActive: false,
				diracMessages: [
					{
						id: "api-1",
						ts: 100,
						content: { type: DiracMessageType.API_STATUS, status: {} },
					},
				],
			}),
		).toEqual({ isActive: false })
	})

	it("uses the API status timestamp while an API request is active", () => {
		expect(
			getSpinnerActivity({
				isApiRequestActive: true,
				diracMessages: [
					{
						id: "api-1",
						ts: 100,
						content: { type: DiracMessageType.API_STATUS, status: {} },
					},
				],
			}),
		).toEqual({ isActive: true, startTime: 100 })
	})

	it("keeps waiting-for-input cards inactive even if the API flag is stale", () => {
		expect(
			getSpinnerActivity({
				isApiRequestActive: true,
				diracMessages: [
					{
						id: "card-1",
						ts: 200,
						content: {
							type: DiracMessageType.CARD,
							card: {
								id: "card-1",
								header: "Choose",
								status: CardStatus.WAITING_FOR_INPUT,
								renderType: "text",
								requireFeedback: true,
							},
						},
					},
				],
			}),
		).toEqual({ isActive: false })
	})
})
