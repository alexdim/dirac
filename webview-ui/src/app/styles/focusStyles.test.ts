import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sourceDirectory = resolve(process.cwd(), "src")
const stylesheet = readFileSync(resolve(sourceDirectory, "app/styles/main.css"), "utf8")
const composerSource = readFileSync(resolve(sourceDirectory, "features/modular-ui/chat/ModularChatTextArea.tsx"), "utf8")
const inputPrimitiveSource = readFileSync(
	resolve(sourceDirectory, "features/modular-ui/chat/components/InputPrimitive.tsx"),
	"utf8",
)
const inputSource = readFileSync(resolve(sourceDirectory, "shared/ui/input.tsx"), "utf8")
const selectSource = readFileSync(resolve(sourceDirectory, "shared/ui/select.tsx"), "utf8")
const itemSource = readFileSync(resolve(sourceDirectory, "shared/ui/item.tsx"), "utf8")

function cssBlock(styles: string, startToken: string): string {
	const start = styles.indexOf(startToken)
	if (start === -1) throw new Error(`Could not find CSS block starting with ${startToken}`)

	const openingBrace = styles.indexOf("{", start)
	let depth = 0

	for (let index = openingBrace; index < styles.length; index++) {
		if (styles[index] === "{") depth++
		if (styles[index] !== "}") continue

		depth--
		if (depth === 0) return styles.slice(start, index + 1)
	}

	throw new Error(`Could not close CSS block starting with ${startToken}`)
}

describe("focus-style ownership", () => {
	it("keeps the generic keyboard-focus fallback in the base layer without overriding local primitives", () => {
		const baseLayer = cssBlock(stylesheet, "@layer base")
		const fallback = cssBlock(baseLayer, "button:focus-visible")
		const fallbackStart = stylesheet.indexOf("button:focus-visible")

		expect(fallbackStart).toBeGreaterThanOrEqual(stylesheet.indexOf("@layer base"))
		expect(fallbackStart).toBeLessThan(stylesheet.indexOf("@layer base") + baseLayer.length)
		expect(stylesheet.indexOf("button:focus-visible", fallbackStart + 1)).toBe(-1)
		expect(fallback).not.toContain("!important")
		expect(stylesheet).not.toMatch(/textarea:focus\s*\{/)
	})

	it("gives the chat composer the only focus indicator around its textarea", () => {
		const composerFocus = cssBlock(stylesheet, ".modular-composer:focus-within")

		expect(composerFocus).toContain("border-color: var(--vscode-focusBorder)")
		expect(composerFocus).not.toContain("box-shadow")
		expect(composerSource).not.toContain("--color-glow-act")
		expect(composerSource).not.toMatch(/context\.isFocused\s*\?/)
		expect(inputPrimitiveSource).toContain("focus-visible:outline-none")
	})

	it("uses one focus treatment for shared controls and VS Code toolkit fields", () => {
		const toolkitFocus = cssBlock(stylesheet, "vscode-text-field::part(control):focus-within")

		expect(toolkitFocus).toContain("border-color: var(--dirac-focus)")
		expect(toolkitFocus).not.toContain("box-shadow")
		expect(inputSource).toContain("focus-visible:border-ring")
		expect(inputSource).not.toContain("focus-visible:ring")
		expect(selectSource).toContain("focus-visible:border-ring")
		expect(selectSource).not.toContain("focus-visible:ring")
		expect(itemSource).toContain("focus-visible:border-ring")
		expect(itemSource).not.toContain("focus-visible:ring")
	})
})
