import type { SubagentRunResult, SubagentRunStats } from "./SubagentRunner"
import { SubagentExecutionStatus } from "@shared/ExtensionMessage"

// Constructs the authoritative result for a subagent stopped by timeout or cancellation.
export class SubagentAbortHandler {
	constructor(
		private getAbortReason: () => string | undefined,
		private getBestEffortResult: (conversation: any[]) => string,
	) {}

	buildAbortResult(conversation: any[], stats: SubagentRunStats): SubagentRunResult {
		const reason = this.getAbortReason() || "Subagent run cancelled."
		const finalStats = { ...stats }
		if (/timed out/.test(reason)) {
			const partialResult = this.getBestEffortResult(conversation)
			const result = `${reason} This is what I have currently:\n\n${partialResult}`
			return { status: SubagentExecutionStatus.COMPLETED, result, stats: finalStats }
		}
		return { status: SubagentExecutionStatus.CANCELLED, error: reason, stats: finalStats }
	}
}
