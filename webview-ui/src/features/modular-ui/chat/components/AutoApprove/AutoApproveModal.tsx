import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { StateServiceClient } from "@/shared/api/grpc-client"
import { useAutoApproveActions } from "@/shared/hooks/useAutoApproveActions"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/shared/lib/vscStyles"
import AutoApproveMenuItem from "./AutoApproveMenuItem"
import { updateAutoApproveSettings } from "./AutoApproveSettingsAPI"
import { ActionMetadata } from "./types"

const breakpoint = 500

function getCheckboxChecked(event: { target: EventTarget | null }): boolean {
	return (event.target as HTMLInputElement).checked
}

interface AutoApproveModalProps {
	isVisible: boolean
	setIsVisible: (visible: boolean) => void
	buttonRef: React.RefObject<HTMLButtonElement>
	ACTION_METADATA: ActionMetadata[]
}

const AutoApproveModal: React.FC<AutoApproveModalProps> = ({ isVisible, setIsVisible, buttonRef, ACTION_METADATA }) => {
	const { autoApprovalSettings, autoApproveAllToggled, remoteConfigSettings, yoloModeToggled } = useSettingsStore()
	const { isChecked, updateAction } = useAutoApproveActions()
	const modalRef = useRef<HTMLDivElement>(null)
	const itemsContainerRef = useRef<HTMLDivElement>(null)
	const [containerWidth, setContainerWidth] = useState(0)
	const isYoloRemoteLocked = remoteConfigSettings?.yoloModeToggled !== undefined

	useClickAway(modalRef, (e) => {
		// Skip if click was on the button that toggles the modal
		if (buttonRef.current?.contains(e.target as Node)) {
			return
		}
		setIsVisible(false)
	})

	// Track container width for responsive layout
	useEffect(() => {
		if (!isVisible) {
			return
		}

		const updateWidth = () => {
			if (itemsContainerRef.current) {
				setContainerWidth(itemsContainerRef.current.offsetWidth)
			}
		}

		// Initial measurement
		updateWidth()

		// Set up resize observer
		const resizeObserver = new ResizeObserver(updateWidth)
		if (itemsContainerRef.current) {
			resizeObserver.observe(itemsContainerRef.current)
		}

		// Clean up
		return () => {
			resizeObserver.disconnect()
		}
	}, [isVisible])

	if (!isVisible) {
		return null
	}

	return (
		<div ref={modalRef}>
			{/* Expanded menu content - renders directly below the bar */}
			<div
				className="overflow-y-auto pb-3 px-3.5 overscroll-contain"
				style={{
					maxHeight: "60vh",
				}}>
				<div className="mb-2.5 text-muted-foreground text-xs">
					Let Dirac take these actions without asking for approval.
				</div>

				<div
					className="relative mb-2 w-full"
					ref={itemsContainerRef}
					style={{
						columnCount: containerWidth > breakpoint ? 2 : 1,
						columnGap: "4px",
					}}>
					{/* Vertical separator line - only visible in two-column mode */}
					{containerWidth > breakpoint && (
						<div
							className="absolute left-1/2 top-0 bottom-0 opacity-20"
							style={{
								background: getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND),
								transform: "translateX(-50%)", // Center the line
							}}
						/>
					)}

					{/* All items in a single list - CSS Grid will handle the column distribution */}
					{ACTION_METADATA.map((action) => (
						<AutoApproveMenuItem
							action={action}
							disabled={autoApproveAllToggled || yoloModeToggled}
							isChecked={isChecked}
							key={action.id}
							onToggle={updateAction}
						/>
					))}
				</div>

				{/* Separator line */}
				<div
					style={{
						height: "0.5px",
						background: getAsVar(VSC_DESCRIPTION_FOREGROUND),
						opacity: 0.1,
						margin: "8px 0",
					}}
				/>

				<div className="flex items-center gap-2 mb-1">
					<VSCodeCheckbox
						checked={yoloModeToggled}
						disabled={isYoloRemoteLocked}
						onChange={async (e) => {
							const checked = getCheckboxChecked(e)
							await StateServiceClient.updateSettings({ metadata: {}, yoloModeToggled: checked })
						}}
						title={
							isYoloRemoteLocked
								? "YOLO mode is managed by your organization"
								: "Run autonomously without confirmation prompts"
						}>
						<span className="text-sm">YOLO mode</span>
					</VSCodeCheckbox>
				</div>

				<div className="flex items-center gap-2 mb-1">
					<VSCodeCheckbox
						checked={autoApproveAllToggled}
						disabled={yoloModeToggled}
						onChange={async (e) => {
							const checked = getCheckboxChecked(e)
							await StateServiceClient.updateSettings({ metadata: {}, autoApproveAllToggled: checked })
						}}
						title="Auto-approve all, including unsafe commands">
						<span className="text-sm">Approve All</span>
					</VSCodeCheckbox>
				</div>

				<div className="flex items-center gap-2">
					<VSCodeCheckbox
						checked={autoApprovalSettings.enableNotifications}
						disabled={autoApproveAllToggled || yoloModeToggled}
						onChange={async (e) => {
							const checked = getCheckboxChecked(e)
							await updateAutoApproveSettings({
								...autoApprovalSettings,
								version: (autoApprovalSettings.version ?? 1) + 1,
								enableNotifications: checked,
							})
						}}>
						<span className="text-sm">Enable notifications</span>
					</VSCodeCheckbox>
				</div>
			</div>
		</div>
	)
}

export default AutoApproveModal
