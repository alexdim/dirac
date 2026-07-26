import {
	SettingsItemType,
	SettingsNavigationDirection,
	type ListItem,
} from "./types"

const NON_SELECTABLE_ITEM_TYPES = new Set<SettingsItemType>([
	SettingsItemType.SEPARATOR,
	SettingsItemType.HEADER,
	SettingsItemType.SPACER,
])

export function isSelectableSettingsItem(item: ListItem | undefined): item is ListItem {
	return item !== undefined && !NON_SELECTABLE_ITEM_TYPES.has(item.type)
}

export function getFirstSelectableSettingsIndex(items: ListItem[]): number {
	const index = items.findIndex(isSelectableSettingsItem)
	return Math.max(0, index)
}

export function getNextSelectableSettingsIndex(
	items: ListItem[],
	currentIndex: number,
	direction: SettingsNavigationDirection,
): number {
	if (items.length === 0) return 0

	const delta = direction === SettingsNavigationDirection.UP ? -1 : 1
	for (let offset = 1; offset <= items.length; offset += 1) {
		const candidate = (currentIndex + delta * offset + items.length * offset) % items.length
		if (isSelectableSettingsItem(items[candidate])) return candidate
	}

	return Math.max(0, Math.min(currentIndex, items.length - 1))
}
