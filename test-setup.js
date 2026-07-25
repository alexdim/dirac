const path = require("path")
const { register } = require("tsconfig-paths")
const { compilerOptions } = require("./tsconfig.json")

const compiledPathAliases = Object.fromEntries(
	Object.entries(compilerOptions.paths).filter(([alias]) => alias !== "vscode"),
)

register({
	baseUrl: path.resolve(__dirname, "out"),
	paths: compiledPathAliases,
})
