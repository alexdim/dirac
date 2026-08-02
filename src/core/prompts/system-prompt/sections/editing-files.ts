import { getDelimiter } from "../../../../utils/line-hashing"

export const getEditingFilesInstructions = () => {
	const delimiter = getDelimiter()
	return `## EDITING FILES INSTRUCTIONS

- \`write_to_file\`: create new files or deliberately overwrite complete files.
- \`edit_file\`: make partial edits inside files using required line anchors.
- \`edit_ast\`: rename exact indexed symbols or replace complete named definitions.
- \`execute_command\`: perform mechanical bulk transformations that are not symbol-aware.

### \`edit_file\` REQUIRES LINE ANCHORS
\`edit_file\` can only edit source lines identified by current line anchors. It has no line-number, search-text, or unanchored editing mode. Plain source lines are not valid \`anchor\` or \`end_anchor\` values.

Before calling \`edit_file\`, obtain standalone anchored output containing every editable line you will use as \`anchor\` or \`end_anchor\` from \`read_file\`, \`search_files\`, or \`inspect_ast\` with \`include_anchors: true\`. \`edit_file\` cannot infer or create these coordinates. Each editable source line has the form \`ANCHOR${delimiter}CONTENT\`; surrounding headers, separators, diagnostics, and other metadata are not coordinates.

For example, \`Apple${delimiter}const value = calculate()\` is one anchored source line:

- \`Apple\` is an opaque line ID maintained for that file in the current conversation. It has no semantic meaning.
- Everything after \`${delimiter}\` is the exact current source line.
- An unchanged line keeps its ID when surrounding lines move. A new or changed line gets a new ID, and a deleted line's ID stops resolving.
- IDs are file-scoped. The same word in another file is unrelated.

The complete \`ANCHOR${delimiter}CONTENT\` line is the edit coordinate. \`edit_file\` rereads the file, locates the line by ID, and verifies that the supplied content exactly matches the current line. Treat the ID and content as an indivisible pair: copy the complete anchored line verbatim and never combine an ID from one line with content from another. Given \`Apple${delimiter}first\` and \`Banana${delimiter}second\`, \`Apple${delimiter}second\` is invalid.

### REQUIRED \`edit_file\` WORKFLOW
1. Obtain current anchors for every required edit coordinate: \`anchor\` and, for \`replace\`, \`end_anchor\`.
2. Copy each complete \`ANCHOR${delimiter}CONTENT\` line verbatim into \`anchor\` or \`end_anchor\`.
3. Use the smallest range that fully contains the intended edit.
4. Put ordinary source code without anchors in \`text\`.
5. If an anchor is rejected, reread the smallest relevant range and copy its current anchored lines before retrying. Do not widen the edit to work around an anchor failure.

- \`replace\` requires an inclusive range from \`anchor\` through \`end_anchor\`. To replace one line, use the same complete anchored line for both endpoints. To delete the range, use \`text: ""\`.
- For a multi-line replacement, use the exact complete first and last lines of the intended range. Include the construct's closing syntax, but no unrelated surrounding lines.
- \`insert_before\` and \`insert_after\` require one complete anchored line in \`anchor\`; omit \`end_anchor\` because it is semantically unused. Strict API transports may represent omitted optional fields as \`null\`, which the runtime normalizes away.
- Never include anchors in replacement text. Preserve indentation and balanced syntax.
- Edits in one call must not overlap; batch independent edits whenever possible.

`
}
