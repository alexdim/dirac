import { buildApiHandlerForSelection, type ApiHandler } from "@core/api"
import type { ApiStream, ApiStreamUsageChunk } from "@core/api/transform/stream"
import type { ApiConfiguration, ModelProviderSelection } from "@shared/api"
import type { DiracStorageMessage } from "@shared/messages/content"
import type { DiracTool } from "@shared/tools"

export interface UtilityModelRequest {
	systemPrompt: string
	messages: DiracStorageMessage[]
	tools?: DiracTool[]
	signal?: AbortSignal
}

export interface UtilityModelUsageEvent {
	selection: ModelProviderSelection
	usage: ApiStreamUsageChunk
}

export interface UtilityModelRunnerOptions {
	onUsage?: (event: UtilityModelUsageEvent) => void
}

export interface BuildUtilityModelRunnerOptions extends UtilityModelRunnerOptions {
	ulid?: string
}

export type UtilityModelHandlerFactory = () => ApiHandler

/** A recognizable failure for callers that must discard provisional output. */
export class UtilityModelCancelledError extends Error {
	constructor() {
		super("Utility model request cancelled")
		this.name = "UtilityModelCancelledError"
	}
}

/**
 * Runs one independent model request without task-loop, tool-execution, or
 * active-handler integration. A fresh handler is created for every invocation.
 */
export class UtilityModelRunner {
	constructor(
		private readonly selection: ModelProviderSelection,
		private readonly createHandler: UtilityModelHandlerFactory,
		private readonly options: UtilityModelRunnerOptions = {},
	) {}

	run(request: UtilityModelRequest): ApiStream {
		return this.stream(request)
	}

	private async *stream(request: UtilityModelRequest): ApiStream {
		this.throwIfCancelled(request.signal)

		const handler = this.createHandler()
		let completed = false
		let aborted = false
		const abortHandler = () => {
			if (aborted) return
			aborted = true
			handler.abort?.()
		}

		request.signal?.addEventListener("abort", abortHandler, { once: true })

		try {
			const stream = handler.createMessage(request.systemPrompt, request.messages, request.tools)
			for await (const chunk of stream) {
				this.throwIfCancelled(request.signal)
				if (chunk.type === "usage") {
					this.options.onUsage?.({ selection: this.selection, usage: chunk })
				}
				yield chunk
			}
			this.throwIfCancelled(request.signal)
			completed = true
		} finally {
			request.signal?.removeEventListener("abort", abortHandler)
			if (!completed) abortHandler()
		}
	}

	private throwIfCancelled(signal?: AbortSignal): void {
		if (signal?.aborted) throw new UtilityModelCancelledError()
	}
}

/**
 * Creates a runner whose handler is constructed lazily for each request from a
 * secret-free selection and the caller's existing credential configuration.
 */
export function createUtilityModelRunner(
	baseConfiguration: ApiConfiguration,
	selection: ModelProviderSelection,
	options: BuildUtilityModelRunnerOptions = {},
): UtilityModelRunner {
	return new UtilityModelRunner(
		selection,
		() => buildApiHandlerForSelection(baseConfiguration, selection, { ulid: options.ulid }),
		options,
	)
}
