import type { Controller } from "@/core/controller"

export enum SettingsTab {
	API = "api",
	AUTO_APPROVE = "auto-approve",
	FEATURES = "features",
	TOOLS = "tools",
	OTHER = "other",
}

export enum SettingsItemType {
	CHECKBOX = "checkbox",
	READONLY = "readonly",
	EDITABLE = "editable",
	SEPARATOR = "separator",
	HEADER = "header",
	SPACER = "spacer",
	ACTION = "action",
	CYCLE = "cycle",
	OBJECT = "object",
}

export enum SettingsNavigationDirection {
	UP = "up",
	DOWN = "down",
}

export interface ListItem {
	key: string
	label: string
	type: SettingsItemType
	value: any
	description?: string
	isSubItem?: boolean
	parentKey?: string
}

export interface SettingsPanelContentProps {
	onClose: () => void
	controller?: Controller
	initialMode?: "model-picker" | "featured-models" | "provider-picker"
	initialModelKey?: "actModelId" | "planModelId"
}
