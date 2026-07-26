import { Text } from "ink"
import { render } from "ink-testing-library"
// biome-ignore lint/correctness/noUnusedImports: Vitest transforms this test with the classic JSX runtime.
import React from "react"
import { describe, expect, it } from "vitest"
import { useTranscriptPartition } from "./useTranscriptPartition"

interface Message {
	id: string
	mutable?: boolean
	rows?: number
}

function TranscriptPartitionHarness({
	messages,
	conversationKey,
	rowBudget,
}: {
	messages: Message[]
	conversationKey?: string
	rowBudget?: number
}) {
	const result = useTranscriptPartition(
		messages,
		(message) => message.mutable === true,
		conversationKey,
		rowBudget === undefined
			? undefined
			: {
					rowBudget,
					estimateRows: (message) => message.rows ?? 1,
				},
	)
	return (
		<Text>
			{result.staticPrefix.map((message) => message.id).join(",")}|{result.dynamicTail.map((message) => message.id).join(",")}
		</Text>
	)
}

describe("useTranscriptPartition", () => {
	it("retains finalized messages that fit the rolling row budget", () => {
		const { lastFrame } = render(
			<TranscriptPartitionHarness
				conversationKey="task"
				messages={[{ id: "first" }, { id: "recent" }]}
				rowBudget={2}
			/>,
		)

		expect(lastFrame()).toBe("|first,recent")
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

	it("keeps a finalized mutable message resident until capacity displaces it", () => {
		const first = { id: "first" }
		const streaming = { id: "streaming", mutable: true }
		const view = render(
			<TranscriptPartitionHarness conversationKey="task" messages={[first, streaming]} rowBudget={2} />,
		)
		expect(view.lastFrame()).toBe("|first,streaming")

		view.rerender(
			<TranscriptPartitionHarness
				conversationKey="task"
				messages={[first, { id: "streaming" }, { id: "new", rows: 2 }]}
				rowBudget={2}
			/>,
		)
		expect(view.lastFrame()).toBe("first,streaming|new")
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

	it("keeps a partially visible finalized message dynamic", () => {
		const { lastFrame } = render(
			<TranscriptPartitionHarness
				conversationKey="task"
				messages={[{ id: "older", rows: 4 }, { id: "latest", rows: 2 }]}
				rowBudget={3}
			/>,
		)

		expect(lastFrame()).toBe("|older,latest")
	})

})
