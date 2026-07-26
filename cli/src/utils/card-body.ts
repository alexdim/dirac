import type { RenderType } from "@shared/ExtensionMessage"
import { stripHashes, stripHashesFromDiff } from "@shared/utils/line-hashing"

/** Removes model-facing line anchors from a card body before displaying it. */
export function cardBodyForDisplay(body: string | undefined, renderType: RenderType): string {
	if (!body) return ""
	return renderType === "diff" ? stripHashesFromDiff(body) : stripHashes(body)
}
