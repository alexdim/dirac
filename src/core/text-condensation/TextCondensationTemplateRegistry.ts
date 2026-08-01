import type { TextCondensationTemplateDefinition, TextCondensationTemplateId } from "./TextCondenser"

/** Owns the trusted templates that callers may select by ID. */
export class TextCondensationTemplateRegistry {
	private readonly definitions = new Map<TextCondensationTemplateId, TextCondensationTemplateDefinition>()

	constructor(definitions: Iterable<TextCondensationTemplateDefinition> = []) {
		for (const definition of definitions) this.register(definition)
	}

	register(definition: TextCondensationTemplateDefinition): void {
		if (this.definitions.has(definition.id)) {
			throw new Error(`Text condensation template is already registered: ${definition.id}`)
		}
		this.definitions.set(definition.id, definition)
	}

	unregister(id: TextCondensationTemplateId): boolean {
		return this.definitions.delete(id)
	}

	has(id: TextCondensationTemplateId): boolean {
		return this.definitions.has(id)
	}

	get(id: TextCondensationTemplateId): TextCondensationTemplateDefinition {
		const definition = this.definitions.get(id)
		if (!definition) throw new Error(`Unknown text condensation template: ${id}`)
		return definition
	}
}
