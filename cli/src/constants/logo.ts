/**
 * Shared Dirac ASCII logo and gradient colors.
 * Used by AsciiMotionCli.
 */

/** 16-line ASCII art Dirac logo. */
export const DIRAC_LOGO = [
	"        █████████████        ",
	"      ███          ▀▀██      ",
	"    ██▀                      ",
	"    ██▄                      ",
	"      ▀██▄                   ",
	"         ▀██▄                ",
	"           ▀██▄              ",
	"         ▄██▀ ▀██▄           ",
	"      ▄██▀      ▀██▄         ",
	"    ▄██▀          ▀██▄       ",
	"  ▄██▀              ▀██▄     ",
	"▄██▀                  ▀██▄   ",
	"▀██▄                  ▄██▀   ",
	"  ▀██▄              ▄██▀     ",
	"    ▀██▄          ▄██▀       ",
	"       ▀▀▀▀▀▀▀▀▀▀▀▀          ",
] as const

/**
 * Per-line gradient from a muted indigo to a warm bronze.
 * Index 0 = top line, index 15 = bottom line.
 */
export const LOGO_GRADIENT: readonly string[] = (() => {
	const top = [0x6f, 0x7d, 0xb8] as const // #6F7DB8
	const bot = [0xb4, 0x7a, 0x2e] as const // #B47A2E
	const n = DIRAC_LOGO.length
	return Array.from({ length: n }, (_, i) => {
		const t = i / (n - 1)
		const r = Math.round(top[0] + (bot[0] - top[0]) * t)
		const g = Math.round(top[1] + (bot[1] - top[1]) * t)
		const b = Math.round(top[2] + (bot[2] - top[2]) * t)
		return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
	})
})()
