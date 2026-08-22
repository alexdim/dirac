import React, { useRef } from "react"
import { useClickAway } from "react-use"
import { useAppStore } from "@/app/store/appStore"
import { Button } from "@/shared/ui/button"

interface AutoApproveModalProps {
	isVisible: boolean
	setIsVisible: (visible: boolean) => void
	buttonRef: React.RefObject<HTMLButtonElement>
	summary: string
}

const AutoApproveModal = ({ isVisible, setIsVisible, buttonRef, summary }: AutoApproveModalProps) => {
	const navigateToSettings = useAppStore((state) => state.navigateToSettings)
	const modalRef = useRef<HTMLDivElement>(null)
	useClickAway(modalRef, (event) => {
		if (!buttonRef.current?.contains(event.target as Node)) setIsVisible(false)
	})
	if (!isVisible) return null
	return (
		<div className="px-3.5 pb-3" ref={modalRef}>
			<p className="mb-3 mt-0 text-xs text-muted-foreground">
				Current autonomy: {summary}. Approval settings have one editable home.
			</p>
			<Button
				onClick={() => {
					setIsVisible(false)
					navigateToSettings("approvals")
				}}
				variant="secondary">
				Manage approvals…
			</Button>
		</div>
	)
}

export default AutoApproveModal
