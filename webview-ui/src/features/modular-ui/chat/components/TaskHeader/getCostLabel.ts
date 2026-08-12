import { hasPricing, isFreeModel, type ModelInfo } from "@shared/api"

// n/a | FREE | $X.XXXX (paid with no usage yet is $0.0000)
export function getCostLabel(totalCost: number, modelInfo?: ModelInfo): string {
	if (!modelInfo || !hasPricing(modelInfo)) return "n/a"
	if (isFreeModel(modelInfo)) return "FREE"
	return `$${totalCost.toFixed(4)}`
}
