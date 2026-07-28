import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	CardKind,
	CardStatus,
	DiracMessageType,
	SteeringTranscriptStatus,
} from "@shared/ExtensionMessage"
import {
	CardKind as ProtoCardKind,
	CardStatus as ProtoCardStatus,
	DiracMessage as ProtoDiracMessage,
	SteeringTranscriptStatus as ProtoSteeringTranscriptStatus,
} from "@shared/proto/dirac/ui"
import { convertDiracMessageToProto, convertProtoToDiracMessage } from "./dirac-message"

describe("Dirac message proto conversion", () => {
	it("round trips semantic card identity and steering status enums", () => {
		const message: import("@shared/ExtensionMessage").DiracMessage = {
			id: "completion",
			ts: 1,
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "card",
					kind: CardKind.TASK_COMPLETION,
					header: "Localized completion",
					status: CardStatus.SUCCESS,
					renderType: "markdown",
				},
			},
		}

		const proto = convertDiracMessageToProto(message)
		assert.equal(proto.card?.kind, ProtoCardKind.CARD_KIND_TASK_COMPLETION)
		assert.equal(convertProtoToDiracMessage(proto).content.type, DiracMessageType.CARD)
		if (!proto.card) assert.fail("Expected card")
		const roundTripped = convertProtoToDiracMessage(proto)
		if (roundTripped.content.type !== DiracMessageType.CARD) assert.fail("Expected card")
		assert.equal(roundTripped.content.card.kind, CardKind.TASK_COMPLETION)

		const steering = convertDiracMessageToProto({
			id: "steering",
			ts: 2,
			content: {
				type: DiracMessageType.MARKDOWN,
				content: "Keep going",
				steering: { status: SteeringTranscriptStatus.QUEUED },
			},
		})
		assert.equal(
			steering.markdown?.steeringTranscriptStatus,
			ProtoSteeringTranscriptStatus.STEERING_TRANSCRIPT_STATUS_QUEUED,
		)
		assert.equal(steering.markdown?.steeringStatus, SteeringTranscriptStatus.QUEUED)
	})

	it("reads the enum before the deprecated steering string and falls back for legacy messages", () => {
		const enumMessage = ProtoDiracMessage.create({
			id: "enum",
			ts: 1,
			markdown: {
				content: "enum",
				isReasoning: false,
				images: [],
				files: [],
				steeringStatus: SteeringTranscriptStatus.SENT,
				steeringTranscriptStatus: ProtoSteeringTranscriptStatus.STEERING_TRANSCRIPT_STATUS_QUEUED,
			},
		})
		const enumConverted = convertProtoToDiracMessage(enumMessage)
		if (enumConverted.content.type !== DiracMessageType.MARKDOWN) assert.fail("Expected markdown")
		assert.equal(enumConverted.content.steering?.status, SteeringTranscriptStatus.QUEUED)

		const legacyMessage = ProtoDiracMessage.create({
			id: "legacy",
			ts: 2,
			markdown: {
				content: "legacy",
				isReasoning: false,
				images: [],
				files: [],
				steeringStatus: SteeringTranscriptStatus.SENT,
				steeringTranscriptStatus: ProtoSteeringTranscriptStatus.STEERING_TRANSCRIPT_STATUS_UNSPECIFIED,
			},
		})
		const legacyConverted = convertProtoToDiracMessage(legacyMessage)
		if (legacyConverted.content.type !== DiracMessageType.MARKDOWN) assert.fail("Expected markdown")
		assert.equal(legacyConverted.content.steering?.status, SteeringTranscriptStatus.SENT)
	})

	it("preserves unspecified card identity for legacy header compatibility", () => {
		const legacy = ProtoDiracMessage.create({
			id: "legacy-card",
			ts: 3,
			card: {
				id: "card",
				header: "Task Completed",
				status: ProtoCardStatus.CARD_SUCCESS,
				kind: ProtoCardKind.CARD_KIND_UNSPECIFIED,
			},
		})
		const converted = convertProtoToDiracMessage(legacy)
		if (converted.content.type !== DiracMessageType.CARD) assert.fail("Expected card")
		assert.equal(converted.content.card.kind, undefined)
	})
})
