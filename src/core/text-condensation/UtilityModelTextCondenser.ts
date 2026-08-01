import type { ApiStream } from "@core/api/transform/stream"
import { UtilityModelCancelledError, type UtilityModelRequest } from "@core/utility-model/UtilityModelRunner"
import {
	TextCondensationOutputError,
	type TextCondenser,
	type TextCondensationOptions,
	type TextStream,
} from "./TextCondenser"
import { TextCondensationTemplateRegistry } from "./TextCondensationTemplateRegistry"

export interface UtilityModelRequestRunner {
	run(request: UtilityModelRequest): ApiStream
}

/**
 * Adapts the generic Utility model stream to the restricted text-only
 * condensation protocol. Output is retained until the provider stream finishes
 * successfully so callers cannot accept a partial condensation.
 */
export class UtilityModelTextCondenser implements TextCondenser {
	constructor(
		private readonly runner: UtilityModelRequestRunner,
		private readonly templates: TextCondensationTemplateRegistry,
	) { }

	condense(input: TextStream, options: TextCondensationOptions): TextStream {
		return this.stream(input, options)
	}

	private async *stream(input: TextStream, options: TextCondensationOptions): AsyncGenerator<string> {
		const template = this.templates.get(options.template)
		const source = await this.collectInput(input, options.signal)
		if (source.length === 0) return
		const request: UtilityModelRequest = {
			systemPrompt: template.systemPrompt,
			messages: [{ role: "user", content: template.buildSourceMessage(source) }],
			signal: options.signal,
		}
		const output = await this.collectOutput(this.runner.run(request), options.signal)

		template.validateOutput(output, source)
		yield output
	}

	private async collectInput(input: TextStream, signal?: AbortSignal): Promise<string> {
		this.throwIfCancelled(signal)
		let source = ""
		for await (const chunk of input) {
			this.throwIfCancelled(signal)
			source += chunk
		}
		this.throwIfCancelled(signal)
		return source
	}

	private async collectOutput(stream: ApiStream, signal?: AbortSignal): Promise<string> {
		let output = ""
		for await (const chunk of stream) {
			this.throwIfCancelled(signal)
			if (chunk.type === "text") {
				output += chunk.text
				continue
			}
			if (chunk.type === "tool_calls") {
				throw new TextCondensationOutputError("Text condensation returned a tool call")
			}
		}
		this.throwIfCancelled(signal)
		return output
	}

	private throwIfCancelled(signal?: AbortSignal): void {
		if (signal?.aborted) throw new UtilityModelCancelledError()
	}
}
