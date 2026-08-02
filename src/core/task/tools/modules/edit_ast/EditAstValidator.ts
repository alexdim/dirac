import type { AstReplacementTarget } from "@services/source-ast/types"

export type EditAstOperation = "rename" | "replace"

export interface EditAstArgs {
	operation: EditAstOperation
	targets: AstReplacementTarget[]
}

export type EditAstValidationResult =
	| { valid: true; args: EditAstArgs }
	| { valid: false; error: string }

/** Normalizes and validates the compact, operation-aware edit_ast call shape. */
export class EditAstValidator {
	public validate(rawArgs: unknown): EditAstValidationResult {
		if (!rawArgs || typeof rawArgs !== "object") {
			return { valid: false, error: "The edit_ast arguments must be an object." }
		}

		const candidate = rawArgs as Partial<EditAstArgs> & { targets?: unknown }
		if (candidate.operation !== "rename" && candidate.operation !== "replace") {
			return { valid: false, error: "The 'operation' parameter must be either 'rename' or 'replace'." }
		}
		if (!Array.isArray(candidate.targets) || candidate.targets.length === 0) {
			return { valid: false, error: "The 'targets' parameter must be a non-empty array." }
		}

		const targets: AstReplacementTarget[] = []
		for (let index = 0; index < candidate.targets.length; index++) {
			const rawTarget = candidate.targets[index]
			if (!rawTarget || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
				return { valid: false, error: `targets[${index}] must be an object.` }
			}
			const target = rawTarget as Partial<AstReplacementTarget>
			const path = typeof target.path === "string" ? target.path.trim() : ""
			const symbol = typeof target.symbol === "string" ? target.symbol.trim() : ""
			if (!path) return { valid: false, error: `targets[${index}].path must be a non-empty string.` }
			if (!symbol) return { valid: false, error: `targets[${index}].symbol must be a non-empty string.` }
			if (typeof target.replacement !== "string") {
				return { valid: false, error: `targets[${index}].replacement must be a string.` }
			}
			targets.push({ path, symbol, replacement: target.replacement })
		}

		if (candidate.operation === "rename") {
			const symbol = targets[0].symbol
			const replacement = targets[0].replacement.trim()
			if (!replacement) return { valid: false, error: "A rename replacement must be a non-empty identifier." }
			if (!this.isIdentifier(replacement)) {
				return { valid: false, error: `The rename replacement '${replacement}' is not a valid identifier.` }
			}
			if (targets.some((target) => target.symbol !== symbol)) {
				return { valid: false, error: "Every rename target must specify the same symbol." }
			}
			if (targets.some((target) => target.replacement.trim() !== replacement)) {
				return { valid: false, error: "Every rename target must specify the same replacement identifier." }
			}

			const uniquePaths = new Map<string, AstReplacementTarget>()
			for (const target of targets) {
				if (!uniquePaths.has(target.path)) {
					uniquePaths.set(target.path, { ...target, replacement })
				}
			}
			return { valid: true, args: { operation: "rename", targets: [...uniquePaths.values()] } }
		}

		const seenTargets = new Set<string>()
		for (const target of targets) {
			const key = `${target.path}\u0000${target.symbol}`
			if (seenTargets.has(key)) {
				return { valid: false, error: `Duplicate replacement target '${target.symbol}' in '${target.path}'.` }
			}
			seenTargets.add(key)
		}
		return { valid: true, args: { operation: "replace", targets } }
	}

	private isIdentifier(value: string): boolean {
		return /^[$_\p{ID_Start}](?:[$_\p{ID_Continue}]|\u200C|\u200D)*$/u.test(value)
	}
}
