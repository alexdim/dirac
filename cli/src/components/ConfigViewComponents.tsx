import { theme } from "../constants/theme"
/**
 * Sub-components and types for ConfigView
 */

import { Box, Text, useInput } from "ink"
import React, { useEffect, useState } from "react"
import { useStdinContext } from "../context/StdinContext"
import { useTerminalSize } from "../hooks/useTerminalSize"

// ============================================================================
// Types & Constants
// ============================================================================

export type ValueType = "string" | "number" | "boolean" | "object" | "undefined"
export type TabView = "settings" | "rules" | "workflows" | "hooks" | "skills"

export interface ConfigEntry {
	key: string
	value: unknown
	type: ValueType
	isEditable: boolean
	source: "global" | "workspace"
}

export interface ToggleEntry {
	path: string
	enabled: boolean
	source: "global" | "workspace" | "remote"
	ruleType?: string
}

export interface HookInfo {
	name: string
	enabled: boolean
	absolutePath: string
}

export interface WorkspaceHooks {
	workspaceName: string
	hooks: HookInfo[]
}

export interface SkillInfo {
	name: string
	description: string
	path: string
	enabled: boolean
}

export interface ObjectEditorState {
	source: "global" | "workspace"
	key: string
	path: string[]
	value: Record<string, unknown>
	selectedIndex: number
	isEditingValue: boolean
	editValue: string
	isAddingKey: boolean
}

export const EXCLUDED_KEYS = new Set(["taskHistory", "primaryRootIndex", "welcomeViewCompleted", "isNewUser"])

export const EDITABLE_TYPES: Set<ValueType> = new Set(["string", "number", "boolean", "object"])
export const MAX_VISIBLE = 12

export const TABS: { key: TabView; label: string; requiresFlag?: "hooks" | "skills" }[] = [
	{ key: "settings", label: "Settings" },
	{ key: "rules", label: "Rules" },
	{ key: "workflows", label: "Workflows" },
	{ key: "hooks", label: "Hooks", requiresFlag: "hooks" },
	{ key: "skills", label: "Skills", requiresFlag: "skills" },
]

// ============================================================================
// Helper Functions
// ============================================================================

export function getValueType(value: unknown): ValueType {
	if (value === undefined || value === null) {
		return "undefined"
	}
	if (typeof value === "boolean") {
		return "boolean"
	}
	if (typeof value === "number") {
		return "number"
	}
	if (typeof value === "object") {
		return "object"
	}
	return "string"
}

export function isExcluded(key: string, value: unknown): boolean {
	if (EXCLUDED_KEYS.has(key)) {
		return true
	}
	if (key.endsWith("Toggles") || key.endsWith("ModelInfo")) {
		return true
	}
	if (key.startsWith("apiConfig_") || key.startsWith("last")) {
		return true
	}
	if (value === undefined || value === null) {
		return true
	}
	if (typeof value === "object" && Object.keys(value as object).length === 0) {
		return true
	}
	if (Array.isArray(value) && value.length === 0) {
		return true
	}
	if (typeof value === "string" && value.trim() === "") {
		return true
	}
	return false
}

export function formatValue(value: unknown, maxLen = 50): string {
	if (value === undefined || value === null) {
		return "<not set>"
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false"
	}
	if (typeof value === "number") {
		return String(value)
	}
	if (typeof value === "object") {
		const json = JSON.stringify(value)
		return json.length > maxLen ? json.slice(0, maxLen - 3) + "..." : json
	}
	const str = String(value)
	return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str
}

export function parseValue(input: string, type: ValueType): unknown {
	if (type === "boolean") {
		const normalized = input.trim().toLowerCase()
		if (normalized === "true" || normalized === "1") return true
		if (normalized === "false" || normalized === "0") return false
		throw new Error("Boolean values must be true, false, 1, or 0")
	}
	if (type === "number") {
		if (!input.trim()) throw new Error("Number values cannot be empty")
		const number = Number(input)
		if (!Number.isFinite(number)) throw new Error(`Invalid number: ${input}`)
		return number
	}
	if (type === "object") {
		return JSON.parse(input)
	}
	return input
}

// Import isSettingsKey at module level for proper test mocking
import { isSettingsKey } from "@shared/storage/state-keys"

export function buildConfigEntries(state: Record<string, unknown>, source: "global" | "workspace"): ConfigEntry[] {
	return Object.entries(state)
		.filter(([key, value]) => !isExcluded(key, value))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => {
			const type = getValueType(value)
			const isEditable = EDITABLE_TYPES.has(type) && (source === "workspace" || isSettingsKey(key))
			return { key, value, type, isEditable, source }
		})
}

export function buildToggleEntries(
	toggles: Record<string, boolean> | undefined,
	source: "global" | "workspace" | "remote",
	ruleType?: string,
): ToggleEntry[] {
	if (!toggles) {
		return []
	}
	return Object.entries(toggles)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, enabled]) => ({ path, enabled, source, ruleType }))
}

export function getFileName(path: string): string {
	return path.replaceAll("\\", "/").split("/").pop() || path
}

export const ConfigSeparator: React.FC = () => {
	const { columns } = useTerminalSize()
	return <Text color={theme.muted}>{"─".repeat(Math.max(1, columns))}</Text>
}

// ============================================================================
// Sub-components
// ============================================================================

interface TextInputProps {
	label: string
	onChange: (value: string) => void
	onCancel: () => void
	onSubmit: (value: string) => void
	type: ValueType
	value: string
}

export const TextInput: React.FC<TextInputProps> = ({ label, onChange, onCancel, onSubmit, type, value }) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			if (key.escape) {
				onCancel()
			} else if (key.return) {
				onSubmit(value)
			} else if (key.backspace || key.delete) {
				onChange(value.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta) {
				onChange(value + input)
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text bold color={theme.info}>
				Edit: {label}
			</Text>
			<Box>
				<Text color={theme.text}>{value}</Text>
				<Text color={theme.info}>|</Text>
			</Box>
			<Text color={theme.muted}>Type: {type} • Enter to save • Esc to cancel</Text>
		</Box>
	)
}

interface BooleanSelectProps {
	label: string
	onCancel: () => void
	onSelect: (value: boolean) => void
	value: boolean
}

export const BooleanSelect: React.FC<BooleanSelectProps> = ({ label, onCancel, onSelect, value }) => {
	const { isRawModeSupported } = useStdinContext()
	const [selected, setSelected] = useState(value)

	useInput(
		(_input, key) => {
			if (key.escape) {
				onCancel()
			} else if (key.return) {
				onSelect(selected)
			} else if (key.upArrow || key.downArrow) {
				setSelected((prev) => !prev)
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text bold color={theme.info}>
				Edit: {label}
			</Text>
			<Box flexDirection="column">
				<Text color={selected ? theme.success : undefined}>{selected ? "❯ " : "  "}true</Text>
				<Text color={!selected ? theme.success : undefined}>{!selected ? "❯ " : "  "}false</Text>
			</Box>
			<Text color={theme.muted}>↑/↓ to toggle • Enter to save • Esc to cancel</Text>
		</Box>
	)
}

export const ConfigRow: React.FC<{ entry: ConfigEntry; isSelected: boolean }> = ({ entry, isSelected }) => {
	const valueColor = entry.type === "boolean" ? (entry.value ? theme.success : theme.error) : theme.text

	return (
		<Box>
			<Text color={isSelected ? theme.info : undefined}>
				{isSelected ? "❯ " : "  "}
				<Text color={theme.info}>{entry.key}</Text>
				<Text color={theme.muted}>: </Text>
				<Text color={valueColor}>{formatValue(entry.value)}</Text>
				{!entry.isEditable && <Text color={theme.muted}> (read-only)</Text>}
			</Text>
		</Box>
	)
}

export const ToggleRow: React.FC<{
	entry: ToggleEntry
	isSelected: boolean
	showType?: boolean
}> = ({ entry, isSelected, showType }) => {
	const fileName = getFileName(entry.path)
	const typeLabel = entry.ruleType ? ` [${entry.ruleType}]` : ""

	return (
		<Box>
			<Text color={isSelected ? theme.info : undefined}>
				{isSelected ? "❯ " : "  "}
				<Text color={entry.enabled ? theme.success : theme.error}>{entry.enabled ? "●" : "○"}</Text>
				<Text> </Text>
				<Text color={theme.text}>{fileName}</Text>
				{showType && <Text color={theme.muted}>{typeLabel}</Text>}
			</Text>
		</Box>
	)
}

export const HookRow: React.FC<{
	hook: HookInfo
	isSelected: boolean
}> = ({ hook, isSelected }) => {
	return (
		<Box>
			<Text color={isSelected ? theme.info : undefined}>
				{isSelected ? "❯ " : "  "}
				<Text color={hook.enabled ? theme.success : theme.error}>{hook.enabled ? "●" : "○"}</Text>
				<Text> </Text>
				<Text color={theme.text}>{hook.name}</Text>
			</Text>
		</Box>
	)
}

export const SkillRow: React.FC<{
	skill: SkillInfo
	isSelected: boolean
}> = ({ skill, isSelected }) => {
	return (
		<Box flexDirection="column">
			<Box>
				<Text color={isSelected ? theme.info : undefined}>
					{isSelected ? "❯ " : "  "}
					<Text color={skill.enabled ? theme.success : theme.error}>{skill.enabled ? "●" : "○"}</Text>
					<Text> </Text>
					<Text bold color={theme.text}>
						{skill.name}
					</Text>
				</Text>
			</Box>
			{skill.description && (
				<Box marginLeft={4}>
					<Text color={theme.muted}>
						{skill.description.length > 60 ? skill.description.slice(0, 57) + "..." : skill.description}
					</Text>
				</Box>
			)}
		</Box>
	)
}

export const TabBar: React.FC<{
	currentTab: TabView
	tabs: typeof TABS
	hooksEnabled?: boolean
	skillsEnabled?: boolean
}> = ({ currentTab, tabs, hooksEnabled, skillsEnabled }) => {
	const visibleTabs = tabs.filter((tab) => {
		if (tab.requiresFlag === "hooks") {
			return hooksEnabled
		}
		if (tab.requiresFlag === "skills") {
			return skillsEnabled
		}
		return true
	})

	return (
		<Box marginBottom={1}>
			{visibleTabs.map((tab, idx) => (
				<React.Fragment key={tab.key}>
					{idx > 0 && <Text color={theme.muted}> │ </Text>}
					<Text bold={currentTab === tab.key} color={currentTab === tab.key ? theme.info : theme.muted}>
						{currentTab === tab.key ? `[${tab.label}]` : tab.label}
					</Text>
				</React.Fragment>
			))}
		</Box>
	)
}

export const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
	<Box marginTop={1}>
		<Text bold color={theme.warning}>
			{title}
		</Text>
	</Box>
)

interface ObjectEditorPanelProps {
	state: ObjectEditorState
	setState: React.Dispatch<React.SetStateAction<ObjectEditorState | null>>
	onClose: () => void
	onPersist: (nextObject: Record<string, unknown>) => void
	getObjectAtPath: (root: Record<string, unknown>, path: string[]) => Record<string, unknown>
	setObjectValueAtPath: (root: Record<string, unknown>, path: string[], key: string, value: unknown) => Record<string, unknown>
}

export const ObjectEditorPanel: React.FC<ObjectEditorPanelProps> = ({
	state,
	setState,
	onClose,
	onPersist,
	getObjectAtPath,
	setObjectValueAtPath,
}) => {
	const { isRawModeSupported } = useStdinContext()
	const [validationError, setValidationError] = useState<string | null>(null)
	const currentNode = getObjectAtPath(state.value, state.path)
	const objectEntries = Object.entries(currentNode).sort(([a], [b]) => a.localeCompare(b))
	const selectedEntry = objectEntries[state.selectedIndex]
	const breadcrumb = [state.key, ...state.path].join(" › ")

	useEffect(() => {
		setState((previous) =>
			previous
				? { ...previous, selectedIndex: Math.max(0, Math.min(previous.selectedIndex, objectEntries.length - 1)) }
				: previous,
		)
	}, [objectEntries.length, setState])

	useInput(
		(input, key) => {
			if (state.isAddingKey) {
				if (key.escape) {
					setValidationError(null)
					setState((prev) => (prev ? { ...prev, isAddingKey: false, editValue: "" } : prev))
					return
				}
				if (key.return) {
					if (!state.editValue.trim()) {
						setState((prev) => (prev ? { ...prev, isAddingKey: false, editValue: "" } : prev))
						return
					}
					const newKey = state.editValue.trim()
					if (Object.hasOwn(currentNode, newKey)) {
						setValidationError(`Key already exists: ${newKey}`)
						return
					}
					const nextObject = setObjectValueAtPath(state.value, state.path, newKey, "")
					onPersist(nextObject)
					setState((prev) =>
						prev
							? {
									...prev,
									value: nextObject,
									isAddingKey: false,
									isEditingValue: true,
									editValue: "",
									selectedIndex: Object.keys(getObjectAtPath(nextObject, state.path)).sort().indexOf(newKey),
								}
							: prev,
					)
					return
				}
				if (key.backspace || key.delete) {
					setValidationError(null)
					setState((prev) => (prev ? { ...prev, editValue: prev.editValue.slice(0, -1) } : prev))
					return
				}
				if (input && !key.ctrl && !key.meta) {
					setValidationError(null)
					setState((prev) => (prev ? { ...prev, editValue: prev.editValue + input } : prev))
				}
				return
			}

			if (state.isEditingValue) {
				if (key.escape) {
					setValidationError(null)
					setState((prev) => (prev ? { ...prev, isEditingValue: false, editValue: "" } : prev))
					return
				}
				if (key.return) {
					if (!selectedEntry) {
						setState((prev) => (prev ? { ...prev, isEditingValue: false, editValue: "" } : prev))
						return
					}
					const [entryKey, entryValue] = selectedEntry
					let parsed: unknown
					try {
						parsed = parseValue(state.editValue, getValueType(entryValue))
					} catch (error) {
						setValidationError(error instanceof Error ? error.message : String(error))
						return
					}
					setValidationError(null)
					const nextObject = setObjectValueAtPath(state.value, state.path, entryKey, parsed)
					onPersist(nextObject)
					setState((prev) => (prev ? { ...prev, value: nextObject, isEditingValue: false, editValue: "" } : prev))
					return
				}
				if (key.backspace || key.delete) {
					setValidationError(null)
					setState((prev) => (prev ? { ...prev, editValue: prev.editValue.slice(0, -1) } : prev))
					return
				}
				if (input && !key.ctrl && !key.meta) {
					setValidationError(null)
					setState((prev) => (prev ? { ...prev, editValue: prev.editValue + input } : prev))
				}
				return
			}

			if (key.escape) {
				if (state.path.length > 0) {
					setState((prev) => (prev ? { ...prev, path: prev.path.slice(0, -1), selectedIndex: 0 } : prev))
				} else {
					onClose()
				}
				return
			}

			if (input === "a") {
				setState((prev) => (prev ? { ...prev, isAddingKey: true, editValue: "" } : prev))
				return
			}

			if (input === "d" || key.delete) {
				if (selectedEntry) {
					const [entryKey] = selectedEntry
					const currentNode = getObjectAtPath(state.value, state.path)
					const { [entryKey]: _, ...rest } = currentNode
					let updatedRoot: Record<string, unknown>
					if (state.path.length === 0) {
						updatedRoot = rest
					} else {
						updatedRoot = setObjectValueAtPath(
							state.value,
							state.path.slice(0, -1),
							state.path[state.path.length - 1],
							rest,
						)
					}

					onPersist(updatedRoot)
					setState((prev) =>
						prev
							? {
									...prev,
									value: updatedRoot,
									selectedIndex: Math.max(0, prev.selectedIndex - 1),
								}
							: prev,
					)
				}
				return
			}

			if (key.upArrow || input === "k") {
				setState((prev) =>
					prev
						? {
								...prev,
								selectedIndex:
									objectEntries.length > 0
										? prev.selectedIndex > 0
											? prev.selectedIndex - 1
											: objectEntries.length - 1
										: 0,
							}
						: prev,
				)
				return
			}
			if (key.downArrow || input === "j") {
				setState((prev) =>
					prev
						? {
								...prev,
								selectedIndex:
									objectEntries.length > 0
										? prev.selectedIndex < objectEntries.length - 1
											? prev.selectedIndex + 1
											: 0
										: 0,
							}
						: prev,
				)
				return
			}

			if (key.return || key.tab) {
				if (!selectedEntry) {
					return
				}
				const [entryKey, entryValue] = selectedEntry
				if (typeof entryValue === "boolean") {
					const nextObject = setObjectValueAtPath(state.value, state.path, entryKey, !entryValue)
					onPersist(nextObject)
					setState((prev) => (prev ? { ...prev, value: nextObject } : prev))
					return
				}
				if (entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)) {
					setState((prev) => (prev ? { ...prev, path: [...prev.path, entryKey], selectedIndex: 0 } : prev))
					return
				}
				setState((prev) =>
					prev
						? { ...prev, isEditingValue: true, editValue: entryValue !== undefined ? String(entryValue) : "" }
						: prev,
				)
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column">
			<Text bold color={theme.text}>
				⚙️ Edit Nested Object
			</Text>
			<ConfigSeparator />
			<Text color={theme.info}>{breadcrumb}</Text>
			{state.isAddingKey ? (
				<Box flexDirection="column" marginTop={1}>
					<Text color={theme.warning}>Add new key:</Text>
					<Box>
						<Text color={theme.text}>{state.editValue}</Text>
						<Text color={theme.info}>|</Text>
					</Box>
					<Text color={theme.muted}>Enter to add • Esc to cancel</Text>
					{validationError && <Text color={theme.error}>{validationError}</Text>}
				</Box>
			) : state.isEditingValue ? (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color={theme.text}>{state.editValue}</Text>
						<Text color={theme.info}>|</Text>
					</Box>
					<Text color={theme.muted}>Enter to save • Esc to cancel</Text>
					{validationError && <Text color={theme.error}>{validationError}</Text>}
				</Box>
			) : (
				<Box flexDirection="column" marginTop={1}>
					{objectEntries.length === 0 ? (
						<Text color={theme.muted}>No nested keys at this level.</Text>
					) : (
						objectEntries.map(([key, value], idx) => {
							const isSelected = idx === state.selectedIndex
							const valueText =
								value && typeof value === "object" && !Array.isArray(value) ? "{...}" : String(value)
							return (
								<Text color={isSelected ? theme.info : undefined} key={key}>
									{isSelected ? "❯ " : "  "}
									<Text color={theme.info}>{key}</Text>
									<Text color={theme.muted}>: </Text>
									<Text color={theme.text}>{valueText}</Text>
								</Text>
							)
						})
					)}
					<Box>
						<Text color={theme.muted}>↑/↓ </Text>
						<Text color={theme.info}>Navigate</Text>
						<Text color={theme.muted}> • </Text>
						<Text color={theme.muted}>Enter/Tab </Text>
						<Text color={theme.info}>Edit</Text>
						<Text color={theme.muted}> • </Text>
						<Text color={theme.info}>a</Text>
						<Text color={theme.muted}> Add</Text>
						<Text color={theme.muted}> • </Text>
						<Text color={theme.info}>d</Text>
						<Text color={theme.muted}> Delete</Text>
						<Text color={theme.muted}> • </Text>
						<Text color={theme.info}>Esc</Text>
						<Text color={theme.muted}> Back</Text>
					</Box>
				</Box>
			)}
		</Box>
	)
}
