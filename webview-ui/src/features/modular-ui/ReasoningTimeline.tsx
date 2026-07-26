import React, { memo } from "react"
import MarkdownBlock from "@/shared/ui/MarkdownBlock"

interface ReasoningTimelineProps {
	content: string
}

export const ReasoningTimeline: React.FC<ReasoningTimelineProps> = memo(({ content }) => {
	// Split content into steps based on double newlines
	const steps = content.split("\n\n").filter((s) => s.trim().length > 0)

	if (steps.length === 0) return null

	return (
		<div className="flex flex-col gap-1.5">
			{steps.map((step, index) => (
				<div key={index} className="text-sm leading-relaxed text-description/90 [&_p]:m-0">
					<MarkdownBlock compact markdown={step.trim()} />
				</div>
			))}
		</div>
	)
})

ReasoningTimeline.displayName = "ReasoningTimeline"
