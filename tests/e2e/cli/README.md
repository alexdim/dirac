# CLI terminal harness

A persistent, shell-free PTY running the **real built CLI**, with an xterm terminal
emulator for inspecting what a user would see. An agent can start it in one tool
call and send input or inspect it in later calls. It does not use Ink mocks or
modify production CLI code.

## Requirements and verification

Linux or macOS, Node 22.13–24.x, and repository dependencies. `node-pty` is a native
dev dependency; normal `npm install` installs its prebuild or compiles it. If you
installed with `--ignore-scripts`, its native binding must already be available.
The session-control socket currently does not support Windows.

From the repository root:

```bash
npm run cli:build
npm run test:e2e:cli:tui
```

The build is **not automatic**. Rebuild after changing CLI or core code, otherwise
you will test an old binary. `start` returns the bundle path and modification time.
The tests cover the PTY/emulator, persistent control, invalid requests, process
exit/stop/idle cleanup, paste negotiation, resizing, and #259 against the built CLI.
No live model credentials or calls are needed for this suite.

## Interactive control across tool calls

```bash
npm run --silent cli:tui -- start
```

Copy the returned `session` directory (for example `/tmp/dirac-tui-AbCd12`) into
subsequent commands. The detached owner keeps the terminal alive after `start`
returns. Commands return JSON; `--silent` suppresses npm's non-JSON banners.

```bash
SESSION=/tmp/dirac-tui-AbCd12
npm run --silent cli:tui -- wait --session "$SESSION" --text '@ files'
npm run --silent cli:tui -- write --session "$SESSION" --text 'Give me a long response.'
npm run --silent cli:tui -- key --session "$SESSION" --key Enter
npm run --silent cli:tui -- wait --session "$SESSION" --text 'Response line 80' --timeout 30000
npm run --silent cli:tui -- paste --session "$SESSION" --file /absolute/path/to/draft.txt
npm run --silent cli:tui -- key --session "$SESSION" --key Up --count 3
npm run --silent cli:tui -- screen --session "$SESSION" --scrollback
npm run --silent cli:tui -- resize --session "$SESSION" --cols 80 --rows 24
npm run --silent cli:tui -- stop --session "$SESSION"
```

`write` sends raw text/escape bytes without submitting. `paste` sends a single
multiline write, adding bracketed-paste delimiters **only if the application has
enabled that terminal mode**. Use `key Enter` to submit separately. `paste` and
`write` accept either `--text` or `--file`, never both.

Keys include `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `Enter`, `Escape`, `Tab`,
`Backspace`, `Delete`, `PageUp`, `PageDown`, `Ctrl+a`, `Ctrl+e`, `Ctrl+c`, `Alt+Left`,
`Shift+Down`, and `Shift+Enter` (sent as CSI-u `ESC [ 13 ; 2 u`). Repeated keys are
spaced apart so Ink doesn't receive several escape sequences coalesced into one
input event. Unsupported chords fail visibly. The #260 regressions verify both
CSI-u and xterm modifyOtherKeys Shift+Enter, insertion at the cursor, follow-up
drafts, narrow widths, Shift+Down, and ordinary Enter submission. The harness sends
distinct bytes; it does not simulate physical Shift+Enter in a terminal that
sends the same carriage return as Enter.

`wait` searches the visible screen, with a default 10-second deadline. A failure
includes the current screen. Actions wait briefly for terminal output to settle;
continuously streaming apps are sampled after at most three seconds. For delayed
updates, use `wait` rather than assuming one action captures the final frame.

## Default deterministic fixture versus live sessions

By default, `start` creates a private temporary home and empty workspace. It
starts a loopback OpenAI-compatible provider, seeds an isolated Dirac configuration
with a dummy key, and returns an 80-line `respond:complete` for every model request.
The real CLI handles API streaming, tool dispatch, completion cards and input.
The fixture never tells the agent to run commands or edit files. Host provider
credentials and proxy variables are not inherited. Auto-update, indexing and
telemetry are disabled. This is **not** an OS sandbox or a network firewall.

For real providers, explicitly opt in:

```bash
npm run --silent cli:tui -- start --live --cwd /absolute/path/to/repository
```

**Live mode inherits your environment and Dirac configuration/credentials.** It
can make billable model calls and perform normal agent actions in the selected
workspace. Logs may contain prompts and other sensitive data. Do not use live
mode unless the task authorizes those actions. Auto-update remains disabled.

To inspect a different executable (or a particular installed CLI):

```bash
npm run --silent cli:tui -- start -- node /absolute/path/to/program.mjs
```

Custom commands use the isolated environment and no canned provider, unless
`--live` is also specified. Arguments after `--` go directly to the executable;
there is no shell interpolation. Use absolute program/script paths when needed,
since the default working directory is a temporary empty workspace.

## Screen and cursor interpretation

Snapshots contain `screen`, `lines`, `cols`, `rows`, the terminal's hardware
`cursor` coordinates, `exit`, and compact `styledRuns` for cells with backgrounds
or inverse video. Coordinates are zero-based. `--scrollback` additionally returns
the active buffer, bounded to 2,000 scrollback rows plus the visible screen.

**Ink paints the input cursor rather than moving the hardware cursor to it.**
Inspect `styledRuns` to locate that painted block. The #259 regression identifies
it using the deterministic dark palette's `theme.cursorBg` (`#C6CBDD`); the hardware
cursor alone cannot prove that the prompt cursor moved. Highlighted mentions,
buttons and code blocks may also have background colors.

The #259 test pastes 15 lines, presses Up **without Ctrl+A**, and asserts that the
painted prompt cursor moves while the response stays still. It then verifies both
arrow directions, prompt viewport movement, response-scroll fallback at input
boundaries, and resize retention. It also checks one-row navigation through a
soft-wrapped paragraph, cursor visibility after resizing, and pasted CRLF text
with empty rows, wide characters, emoji and combining characters.

## JavaScript API

For assertions or concise output from an agent tool's Node script:

```js
import { startSession, requestSession } from './tests/e2e/cli/client.mjs'

const { session } = await startSession({ cols: 100, rows: 30 })
try {
  await requestSession(session, { operation: 'wait', text: '@ files' })
  const snapshot = await requestSession(session, { operation: 'paste', text: 'first\nsecond' })
  console.log(snapshot.screen)
  console.log(snapshot.styledRuns)
} finally {
  await requestSession(session, { operation: 'stop' })
}
```

Operations: `screen`, `write`, `paste`, `key`, `resize`, `wait`, `stop`. Their
properties mirror the CLI flags; deadlines use `timeoutMs`, dimensions use `cols`
and `rows`, and repeated keypresses use `count`. `startSession` also accepts
`command`, `args`, `cwd`, `live`, and `idleMs`.

## Lifecycle and artifacts

Always call `stop` when finished. It terminates the PTY process (escalating to
SIGKILL if necessary) and closes the fixture and control socket. An idle session
expires after 15 minutes; override with `start --idle MILLISECONDS`. Naturally
exited programs retain their last screen until stopped or expired. Input after
exit fails instead of silently disappearing. The harness is a development helper,
not a supervisor for independently detached processes spawned by live tools.

Each owner-only temporary directory contains `session.json`, `harness.log`, raw
`terminal.ansi`, and the isolated home/workspace. `stop` retains these for debugging;
remove the directory afterward if not needed. Do not commit credentials, captured
output, or session files. No sessions are added to CI automatically.
