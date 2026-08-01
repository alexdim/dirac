export type TextStream = AsyncIterable<string>

export type TextCondensationTemplateId = string

export interface TextCondensationOptions {
	template: TextCondensationTemplateId
	signal?: AbortSignal
}

export interface TextCondenser {
	condense(input: TextStream, options: TextCondensationOptions): TextStream
}

export interface TextCondensationTemplateDefinition {
	id: TextCondensationTemplateId
	systemPrompt: string
	buildSourceMessage(source: string): string
	validateOutput(output: string, source: string): void
}

export class TextCondensationOutputError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "TextCondensationOutputError"
	}
}

export function buildTextCondensationSourceMessage(source: string): string {
	return JSON.stringify({ sourceText: source })
}

export function validateTextCondensationOutput(output: string, source: string): void {
	if (source.length > 0 && output.trim().length === 0) {
		throw new TextCondensationOutputError("Text condensation returned empty output for non-empty source")
	}
}
