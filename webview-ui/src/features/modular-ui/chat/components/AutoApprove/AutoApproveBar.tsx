import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { useRef, useState } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/shared/lib/vscStyles"
import AutoApproveModal from "./AutoApproveModal"
import { ACTION_METADATA } from "./constants"

interface AutoApproveBarProps {
	style?: React.CSSProperties
}

const AutoApproveBar = ({ style }: AutoApproveBarProps) => {
	const { autoApprovalSettings, yoloModeToggled, autoApproveAllToggled } = useSettingsStore()

	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLButtonElement>(null)

	const getEnabledActionsText = () => {
		const baseClasses = isModalVisible
			? "text-foreground truncate"
			: "text-muted-foreground group-hover:text-foreground truncate"
		if (yoloModeToggled) {
			return <span className={baseClasses}>YOLO</span>
		}
		if (autoApproveAllToggled) {
			return <span className={baseClasses}>All</span>
		}
		const enabledActionsNames = Object.keys(autoApprovalSettings.actions).filter(
			(key) => autoApprovalSettings.actions[key as keyof typeof autoApprovalSettings.actions],
		)
		const enabledActions = enabledActionsNames.map((action) => {
			return ACTION_METADATA.flatMap((a) => [a, a.subAction]).find((a) => a?.id === action)
		})

		// Filter out parent actions if their subaction is also enabled (show only subaction)
		const actionsToShow = enabledActions.filter((action) => {
			if (!action?.shortName) {
				return false
			}

			// If this is a parent action and its subaction is enabled, skip it
			if (action.subAction?.id && enabledActionsNames.includes(action.subAction.id)) {
				return false
			}

			return true
		})

		if (actionsToShow.length === 0) {
			return <span className={baseClasses}>None</span>
		}

		return (
			<span className={baseClasses}>
				{actionsToShow.map((action, index) => (
					<span key={action?.id}>
						{action?.shortName}
						{index < actionsToShow.length - 1 && ", "}
					</span>
				))}
			</span>
		)
	}

	const borderColor = `color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`
	const borderGradient = `linear-gradient(to bottom, ${borderColor} 0%, transparent 50%)`
	const bgGradient = `linear-gradient(to bottom, color-mix(in srgb, var(--vscode-sideBar-background) 96%, white) 0%, transparent 80%)`

	return (
		<div
			className="mx-4 select-none break-words relative"
			style={{
				borderTop: `0.5px solid ${borderColor}`,
				borderRadius: "4px 4px 0 0",
				background: bgGradient,
				...style,
			}}>
			{/* Left border gradient */}
			<div
				className="absolute left-0 pointer-events-none"
				style={{
					width: 0.5,
					top: 3,
					height: "100%",
					background: borderGradient,
				}}
			/>
			{/* Right border gradient */}
			<div
				className="absolute right-0 top-0 pointer-events-none"
				style={{
					width: 0.5,
					top: 3,
					height: "100%",
					background: borderGradient,
				}}
			/>

			<button
				aria-expanded={isModalVisible}
				aria-label={isModalVisible ? "Close auto-approve settings" : "Open auto-approve settings"}
				className="group w-full cursor-pointer border-0 bg-transparent pt-3 pb-3.5 pr-2 px-3.5 text-left text-inherit flex items-center justify-between gap-0"
				onClick={() => {
					setIsModalVisible((prev) => !prev)
				}}
				ref={buttonRef}
				type="button">
				<div className="flex flex-nowrap items-center gap-1 min-w-0 flex-1">
					<span className="whitespace-nowrap">Auto-approve:</span>
					{getEnabledActionsText()}
				</div>
				{isModalVisible ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
			</button>

			<AutoApproveModal
				ACTION_METADATA={ACTION_METADATA}
				buttonRef={buttonRef}
				isVisible={isModalVisible}
				setIsVisible={setIsModalVisible}
			/>
		</div>
	)
}

export default AutoApproveBar
