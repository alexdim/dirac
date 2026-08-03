import { Card, CardStatus, isFinalStatus } from "@shared/ExtensionMessage"
import { ArrowRightIcon, CheckCircle2Icon, KeyboardIcon, MessageCircleQuestionIcon } from "lucide-react"
import React from "react"
import { cn } from "@/lib/utils"
import { CardDecorator } from "./types"
import { isQuestionResponseCard } from "@shared/responseTool"

export function isAskQuestionCard(card: Card): boolean {
	return isQuestionResponseCard(card)
}

interface AskQuestionChoicesProps {
	card: Card
	isActive?: boolean
	onAction?: (value: string) => void
}

export const AskQuestionChoices: React.FC<AskQuestionChoicesProps> = ({ card, isActive, onAction }) => {
	const isWaiting = !isFinalStatus(card.status) && (isActive || card.status === CardStatus.WAITING_FOR_INPUT)
	const actions = card.actions ?? []

	if (!isWaiting) return null

	return (
		<div className="border-t border-foreground/10 bg-foreground/[0.018] p-3">
			{actions.length > 0 && (
				<>
					<div className="mb-2 flex items-center justify-between gap-3">
						<span className="text-xs font-medium text-foreground/80">Choose a response</span>
						<span className="text-[11px] text-muted-foreground">One click to continue</span>
					</div>
					<div className="grid gap-2">
						{actions.map((action, index) => (
							<button
								key={action.value}
								aria-label={`Choose ${action.label}`}
								className={cn(
									"group flex min-h-11 w-full items-center gap-3 rounded-md border border-foreground/10 bg-foreground/[0.035] px-3 py-2.5 text-left text-sm text-foreground",
									"transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-button-background/55 hover:bg-button-background/10",
									"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
								)}
								onClick={() => onAction?.(action.value)}
								type="button">
								<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-button-background/15 text-xs font-semibold text-link transition-colors group-hover:bg-button-background group-hover:text-primary-foreground">
									{index + 1}
								</span>
								<span className="min-w-0 flex-1 break-words font-medium leading-5">{action.label}</span>
								<ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
							</button>
						))}
					</div>
				</>
			)}

			<div className={cn("flex items-center gap-2 text-[11px] text-muted-foreground", actions.length > 0 && "mt-3")}>
				<KeyboardIcon className="size-3.5 shrink-0" />
				<span>{actions.length > 0 ? "Need something else? Type your own answer below." : "Type your answer below."}</span>
			</div>
		</div>
	)
}

export const AskQuestionDecorator: CardDecorator = {
	id: "ask-question",
	shouldApply: isAskQuestionCard,
	renderBodyWrapper: (card: Card, children: React.ReactNode) => {
		const completed = isFinalStatus(card.status)
		const QuestionIcon = completed && card.status === CardStatus.SUCCESS ? CheckCircle2Icon : MessageCircleQuestionIcon

		return (
			<div className="relative overflow-hidden border-l-2 border-l-button-background bg-button-background/[0.055]">
				<div
					className={cn(
						"absolute left-3 top-3 flex size-6 items-center justify-center rounded-full",
						completed && card.status === CardStatus.SUCCESS
							? "bg-success/12 text-success"
							: "bg-button-background/15 text-link",
					)}
					aria-hidden="true">
					<QuestionIcon className="size-3.5" />
				</div>
				<div className="pl-9 [&_p:first-child]:text-[15px] [&_p:first-child]:font-medium [&_p:first-child]:leading-6">
					{children}
				</div>
			</div>
		)
	},
	suppressDefaultActions: true,
	renderFooterExtra: (card, onAction, isActive) => <AskQuestionChoices card={card} isActive={isActive} onAction={onAction} />,
}
