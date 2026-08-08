/**
 * Augments the installed `@types/vscode` with the newer Language Model API
 * members used across the codebase. Type-only; merges into the vscode module.
 * (Tests wire vscode at runtime to src/test/vscode-mock.ts via a require hook;
 * this augmentation is what makes the TS type-checking of `import("vscode")`
 * forms see the missing LM members.)
 */
declare module "vscode" {
	export interface LanguageModelChatSelector {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}

	export class LanguageModelTextPart {
		constructor(text: string)
		readonly value: string
		readonly text: string
	}

	export enum LanguageModelChatMessageRole {
		User = 1,
		Assistant = 2,
	}

	export class LanguageModelToolCallPart {
		constructor(callId: string, name: string, input: unknown)
		readonly callId: string
		readonly name: string
		readonly input: unknown
	}

	export class LanguageModelToolResultPart {
		constructor(callId: string, content: LanguageModelTextPart[])
		readonly callId: string
		readonly content: LanguageModelTextPart[]
	}

	export class LanguageModelChatMessage {
		role: LanguageModelChatMessageRole
		content: Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>
		name?: string
	}

	export interface LanguageModelChatRequestOptions {
		justification?: string
		tools?: unknown[]
	}

	export class LanguageModelChatResponse {
		readonly stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelToolResultPart>
	}

	export class LanguageModelChat {
		readonly name: string
		readonly vendor: string
		sendRequest(
			messages: LanguageModelChatMessage[],
			options: LanguageModelChatRequestOptions,
			token?: unknown,
		): Thenable<LanguageModelChatResponse>
	}

	export namespace lm {
		function selectChatModels(selector: LanguageModelChatSelector): Thenable<LanguageModelChat[]>
	}
}
