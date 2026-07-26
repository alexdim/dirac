import { theme } from "../../constants/theme"
import React from "react"
import { Box, Text } from "ink"
import { Checkbox } from "../Checkbox"
import { SettingsItemType, type ListItem } from "./types"

interface SettingsListViewProps {
	items: ListItem[]
	selectedIndex: number
}

export const SettingsListView: React.FC<SettingsListViewProps> = ({ items, selectedIndex }) => {
	return (
		<Box flexDirection="column">
			{items.map((item, idx) => {
				const isSelected = idx === selectedIndex

				if (item.type === SettingsItemType.HEADER) {
					return (
						<Box key={item.key} marginTop={idx > 0 ? 0 : 0}>
							<Text bold color={theme.text}>
								{item.label}
							</Text>
						</Box>
					)
				}

				if (item.type === SettingsItemType.SPACER) {
					return <Box key={item.key} marginTop={1} />
				}

				if (item.type === SettingsItemType.SEPARATOR) {
					return (
						<Box
							borderBottom={false}
							borderColor={theme.border}
							borderDimColor
							borderLeft={false}
							borderRight={false}
							borderStyle="single"
							borderTop
							key={item.key}
							width="100%"
						/>
					)
				}

				if (item.type === SettingsItemType.CHECKBOX) {
					return (
						<Box key={item.key} marginLeft={item.isSubItem ? 2 : 0}>
							<Checkbox
								checked={Boolean(item.value)}
								description={item.description}
								isSelected={isSelected}
								label={item.label}
							/>
						</Box>
					)
				}

				// Action item (button-like, no value display)
				if (item.type === SettingsItemType.ACTION) {
					return (
						<Text key={item.key}>
							<Text bold color={isSelected ? theme.primary : theme.subtle}>
								{isSelected ? "❯" : " "}{" "}
							</Text>
							<Text bold={isSelected} color={isSelected ? theme.strongText : theme.text}>{item.label}</Text>
							{isSelected && <Text color={theme.muted}> (Enter)</Text>}
						</Text>
					)
				}

				if (item.type === SettingsItemType.CYCLE) {
					return (
						<Text key={item.key}>
							<Text bold color={isSelected ? theme.primary : theme.subtle}>
								{isSelected ? "❯" : " "}{" "}
							</Text>
							<Text bold={isSelected} color={isSelected ? theme.strongText : theme.text}>{item.label}: </Text>
							<Text color={theme.primary}>
								{typeof item.value === "string" ? item.value : String(item.value)}
							</Text>
							{isSelected && <Text color={theme.muted}> (Tab to cycle)</Text>}
						</Text>
					)
				}

				// Readonly or editable field
				return (
					<Text key={item.key}>
						<Text bold color={isSelected ? theme.primary : theme.subtle}>
							{isSelected ? "❯" : " "}{" "}
						</Text>
						{item.label && <Text bold={isSelected} color={isSelected ? theme.strongText : theme.text}>{item.label}: </Text>}
						<Text color={item.type === SettingsItemType.READONLY ? theme.muted : theme.primary}>
							{typeof item.value === "string"
								? item.value
								: item.type === SettingsItemType.OBJECT
									? "{...}"
									: String(item.value)}
						</Text>
						{item.type === SettingsItemType.EDITABLE && isSelected && <Text color={theme.muted}> (Tab to edit)</Text>}
					</Text>
				)
			})}
		</Box>
	)
}
