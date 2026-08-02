export const INSPECT_AST_OPERATIONS = [
	"outline",
	"implementation",
	"definitions",
	"references",
	"occurrences",
] as const

export type InspectAstOperation = (typeof INSPECT_AST_OPERATIONS)[number]

export interface InspectAstArgs {
	operation?: InspectAstOperation | string
	paths?: string[] | string | null
	symbols?: string[] | string | null
	include_anchors?: boolean | null
}

export interface NormalizedInspectAstArgs {
	operation: InspectAstOperation
	paths: string[]
	symbols: string[]
	includeAnchors: boolean
}

export type InspectAstValidationResult =
	| { valid: true; args: NormalizedInspectAstArgs }
	| { valid: false; message: string }

const SYMBOL_OPERATIONS = new Set<InspectAstOperation>([
	"implementation",
	"definitions",
	"references",
	"occurrences",
])

function normalizeStrings(value: string[] | string | null | undefined): string[] {
	const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
	return Array.from(new Set(values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
}

export class InspectAstValidator {
	static normalize(args: InspectAstArgs | undefined): InspectAstValidationResult {
		const operation = args?.operation
		if (typeof operation !== "string" || !INSPECT_AST_OPERATIONS.includes(operation as InspectAstOperation)) {
			return {
				valid: false,
				message: `Invalid or missing 'operation'. Expected one of: ${INSPECT_AST_OPERATIONS.join(", ")}.`,
			}
		}

		const paths = normalizeStrings(args?.paths)
		if (paths.length === 0) {
			return { valid: false, message: "Missing value for required parameter 'paths'. Provide at least one source path." }
		}

		if (args?.include_anchors !== undefined && args.include_anchors !== null && typeof args.include_anchors !== "boolean") {
			return { valid: false, message: "Parameter 'include_anchors' must be a boolean when provided." }
		}

		const normalizedOperation = operation as InspectAstOperation
		const symbols = normalizeStrings(args?.symbols)
		if (normalizedOperation === "outline" && symbols.length > 0) {
			return { valid: false, message: "Parameter 'symbols' must be absent or empty for operation 'outline'." }
		}
		if (SYMBOL_OPERATIONS.has(normalizedOperation) && symbols.length === 0) {
			return {
				valid: false,
				message: `Missing value for required parameter 'symbols' for operation '${normalizedOperation}'.`,
			}
		}

		return {
			valid: true,
			args: {
				operation: normalizedOperation,
				paths,
				symbols,
				includeAnchors: args?.include_anchors === true,
			},
		}
	}
}
