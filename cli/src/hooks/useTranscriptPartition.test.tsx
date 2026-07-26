import { Text } from "ink"
import { render } from "ink-testing-library"
// biome-ignore lint/correctness/noUnusedImports: Vitest transforms this test with the classic JSX runtime.
import React from "react"
import { describe, expect, it } from "vitest"
import { useTranscriptPartition } from "./useTranscriptPartition"

interface Message {
	id: string
	mutable?: boolean
}

function TranscriptPartitionHarness({
	messages,
	conversationKey,
}: {
	messages: Message[]
	conversationKey?: string
}) {
	const result = useTranscriptPartition(
		messages,
		(message) => message.mutable === true,
		conversationKey,
	)
	return (
		<Text>
			{result.staticPrefix.map((message) => message.id).join(",")}|{result.dynamicTail.map((message) => message.id).join(",")}
		</Text>
	)
}

describe("useTranscriptPartition", () => {
	it("commits every finalized message to terminal scrollback", () => {
		const { lastFrame } = render(
			<TranscriptPartitionHarness
				conversationKey="task"
				messages={[{ id: "first" }, { id: "recent" }]}
			/>,
		)

		expect(lastFrame()).toBe("first,recent|")
	})

	it("keeps the mutable suffix out of the static transcript", () => {
		const { lastFrame } = render(
			<TranscriptPartitionHarness
				conversationKey="task"
				messages={[{ id: "user" }, { id: "running", mutable: true }, { id: "queued" }]}
			/>,
		)

		expect(lastFrame()).toBe("user|running,queued")
	})

	it("commits a mutable message immediately when it finalizes", () => {
		const first = { id: "first" }
		const streaming = { id: "streaming", mutable: true }
		const view = render(
			<TranscriptPartitionHarness conversationKey="task" messages={[first, streaming]} />,
		)
		expect(view.lastFrame()).toBe("first|streaming")

		view.rerender(
			<TranscriptPartitionHarness conversationKey="task" messages={[first, { id: "streaming" }]} />,
		)
		expect(view.lastFrame()).toBe("first,streaming|")
	})

	it("resets the static watermark when another task replaces the transcript", () => {
		const oldMessages = Array.from({ length: 5 }, (_, index) => ({ id: `old-${index}` }))
		const view = render(
			<TranscriptPartitionHarness conversationKey="old" messages={oldMessages} />,
		)

		view.rerender(
			<TranscriptPartitionHarness
				conversationKey="new"
				messages={[{ id: "new-user" }, { id: "new-stream", mutable: true }]}
			/>,
		)

		expect(view.lastFrame()).toBe("new-user|new-stream")
	})
})
