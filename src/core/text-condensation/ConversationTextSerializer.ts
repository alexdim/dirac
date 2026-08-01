import type {
	DiracAssistantToolUseBlock,
	DiracContent,
	DiracStorageMessage,
	DiracUserToolResultContentBlock,
} from "@shared/messages/content"

/** Converts effective API history into deterministic, provider-neutral source text. */
export class ConversationTextSerializer {
	serialize(messages: readonly DiracStorageMessage[]): string {
		return messages.map((message, index) => this.serializeMessage(message, index + 1)).join("\n\n")
	}

	private serializeMessage(message: DiracStorageMessage, index: number): string {
		const role = message.role.toUpperCase()
		return `=== MESSAGE ${index}: ${role} ===\n${this.serializeContent(message.content)}`
	}

	private serializeContent(content: DiracStorageMessage["content"]): string {
		if (typeof content === "string") return this.serializeText(content)

		const blocks = content.map((block) => this.serializeBlock(block)).filter((block): block is string => block !== undefined)
		return blocks.length > 0 ? blocks.join("\n") : "[no serializable content]"
	}

	private serializeBlock(block: DiracContent): string | undefined {
		switch (block.type) {
			case "text":
				return this.serializeText(block.text)
			case "tool_use":
				return this.serializeToolUse(block as DiracAssistantToolUseBlock)
			case "tool_result":
				return this.serializeToolResult(block as DiracUserToolResultContentBlock)
			case "image":
				return `[image omitted: media_type=${this.getMediaType(block)}]`
			case "document":
				return `[document body omitted: media_type=${this.getMediaType(block)}]`
			case "thinking":
			case "redacted_thinking":
				return undefined
			default:
				throw new Error(`Unsupported conversation content block: ${block.type}`)
		}
	}

	private serializeText(text: string): string {
		return `[text length=${text.length}]\n${text}\n[/text]`
	}

	private serializeToolUse(block: DiracAssistantToolUseBlock): string {
		const metadata = this.stableJson({ id: block.id ?? null, input: block.input, name: block.name ?? null })
		return `[tool_use]\n${metadata}\n[/tool_use]`
	}

	private serializeToolResult(block: DiracUserToolResultContentBlock): string {
		const metadata = this.stableJson({ is_error: block.is_error === true, tool_use_id: block.tool_use_id })
		const content = this.serializeToolResultContent(block.content)
		return `[tool_result]\n${metadata}\n${content}\n[/tool_result]`
	}

	private serializeToolResultContent(content: DiracUserToolResultContentBlock["content"]): string {
		if (content === undefined) return "[no tool result content]"
		if (typeof content === "string") return this.serializeText(content)
		return content.map((block) => this.serializeBlock(block as DiracContent)).filter((block): block is string => block !== undefined).join("\n")
	}

	private getMediaType(block: DiracContent): string {
		const source = (block as { source?: { media_type?: string } }).source
		return source?.media_type ?? "unknown"
	}

	private stableJson(value: unknown): string {
		return JSON.stringify(this.sortJson(value))
	}

	private sortJson(value: unknown): unknown {
		if (value === undefined) return null
		if (Array.isArray(value)) return value.map((item) => this.sortJson(item))
		if (value !== null && typeof value === "object") {
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, item]) => [key, this.sortJson(item)]),
			)
		}
		return value
	}
}
