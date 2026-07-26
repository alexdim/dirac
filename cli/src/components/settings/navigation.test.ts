import { describe, expect, it } from "vitest"
import { getFirstSelectableSettingsIndex, getNextSelectableSettingsIndex } from "./navigation"
import { SettingsItemType, SettingsNavigationDirection, type ListItem } from "./types"

function item(key: string, type: SettingsItemType): ListItem {
	return { key, label: key, type, value: "" }
}

describe("settings navigation", () => {
	it("returns zero for an empty list", () => {
		expect(getNextSelectableSettingsIndex([], 0, SettingsNavigationDirection.DOWN)).toBe(0)
	})

	it("finds the first interactive item", () => {
		const items = [item("heading", SettingsItemType.HEADER), item("setting", SettingsItemType.CHECKBOX)]
		expect(getFirstSelectableSettingsIndex(items)).toBe(1)
	})

	it("wraps while skipping structural rows", () => {
		const items = [
			item("first", SettingsItemType.EDITABLE),
			item("separator", SettingsItemType.SEPARATOR),
			item("heading", SettingsItemType.HEADER),
			item("last", SettingsItemType.ACTION),
		]

		expect(getNextSelectableSettingsIndex(items, 0, SettingsNavigationDirection.DOWN)).toBe(3)
		expect(getNextSelectableSettingsIndex(items, 0, SettingsNavigationDirection.UP)).toBe(3)
	})
})
