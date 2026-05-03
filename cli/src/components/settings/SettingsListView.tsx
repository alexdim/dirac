import React from "react"
import { Box, Text } from "ink"
import { COLORS } from "../../constants/colors"
import { Checkbox } from "../Checkbox"
import type { ListItem } from "./types"

interface SettingsListViewProps {
	items: ListItem[]
	selectedIndex: number
}

export const SettingsListView: React.FC<SettingsListViewProps> = ({ items, selectedIndex }) => {
	return (
		<Box flexDirection="column">
			{items.map((item, idx) => {
				const isSelected = idx === selectedIndex

				if (item.type === "header") {
					return (
						<Box key={item.key} marginTop={idx > 0 ? 0 : 0}>
							<Text bold color="white">
								{item.label}
							</Text>
						</Box>
					)
				}

				if (item.type === "spacer") {
					return <Box key={item.key} marginTop={1} />
				}

				if (item.type === "separator") {
					return (
						<Box
							borderBottom={false}
							borderColor="gray"
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

				if (item.type === "checkbox") {
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
				if (item.type === "action") {
					return (
						<Text key={item.key}>
							<Text bold color={isSelected ? COLORS.primaryBlue : undefined}>
								{isSelected ? "❯" : " "}{" "}
							</Text>
							<Text color={isSelected ? COLORS.primaryBlue : "white"}>{item.label}</Text>
							{isSelected && <Text color="gray"> (Enter)</Text>}
						</Text>
					)
				}

				if (item.type === "cycle") {
					return (
						<Text key={item.key}>
							<Text bold color={isSelected ? COLORS.primaryBlue : undefined}>
								{isSelected ? "❯" : " "}{" "}
							</Text>
							<Text color={isSelected ? COLORS.primaryBlue : "white"}>{item.label}: </Text>
							<Text color={COLORS.primaryBlue}>
								{typeof item.value === "string" ? item.value : String(item.value)}
							</Text>
							{isSelected && <Text color="gray"> (Tab to cycle)</Text>}
						</Text>
					)
				}

				// Readonly or editable field
				return (
					<Text key={item.key}>
						<Text bold color={isSelected ? COLORS.primaryBlue : undefined}>
							{isSelected ? "❯" : " "}{" "}
						</Text>
						{item.label && <Text color={isSelected ? COLORS.primaryBlue : "white"}>{item.label}: </Text>}
						<Text color={item.type === "readonly" ? "gray" : COLORS.primaryBlue}>
							{typeof item.value === "string" ? item.value : item.type === "object" ? "{...}" : String(item.value)}
						</Text>
						{item.type === "editable" && isSelected && <Text color="gray"> (Tab to edit)</Text>}
					</Text>
				)
			})}
		</Box>
	)
}
