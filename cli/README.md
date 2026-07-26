# Dirac CLI

<p align="center">
  <img src="https://github.com/dirac-run/dirac/blob/master/assets/media/diraccli1.png?raw=true" width="70%" />
</p>

<p align="center">
  <a href="https://github.com/dirac-run/dirac"><strong>GitHub</strong></a> |
  <a href="https://www.npmjs.com/package/dirac-cli"><strong>NPM</strong></a> |
  <a href="https://discord.gg/wcYTx9BGea"><strong>Discord</strong></a>
</p>

It is a well studied phenomenon that any given model's reasoning ability degrades with the context length. If we can keep context tightly curated, we improve both accuracy and cost while making larger changes tractable in a single task.

Dirac is an open-source coding agent built with this in mind. It reduces API costs by **64.8%** on average while producing better and faster work through hash-anchored parallel edits, AST manipulation, and a suite of advanced optimizations. Oh, and no MCP.

Our goal: Optimize for bang-for-the-buck on tooling with bare minimum prompting instead of going blindly minimalistic.

## Requirements

- Node.js 22.13 through 24.x
- npm

Node.js 25 is not supported because of known memory issues.

## Installation

```bash
npm install -g dirac-cli
dirac auth
```

From a source checkout, install dependencies and build the executable from the repository root:

```bash
npm run install:all
npm run cli:build
node cli/dist/cli.mjs --help
```

## Running Dirac

Dirac has two terminal paths.

### Interactive mode

With an interactive stdin and stdout, Dirac renders the Ink interface. Run it without a prompt to open the composer, or provide a prompt to submit the first turn immediately:

```bash
dirac
dirac "Analyze this codebase"
dirac --plan "Design an implementation"
```

Interactive mode supports task approvals, follow-up messages, history, settings, model selection, skills, file mentions, image paste, and task resumption. `--auto-approve-all` keeps this interface while automatically approving actions.

### Standalone mode

Dirac uses plain output when `--yolo` or `--json` is present, stdin is piped, or either terminal stream is redirected. `--yolo` auto-approves actionable cards and is intended for unattended execution:

```bash
dirac --yolo "Run the tests and fix failures"
git diff | dirac "Review these changes"
dirac --json "List the relevant files" > events.ndjson
```

In plain text mode, the final result is written to stdout. Progress, tool activity, summaries, warnings, and errors are written to stderr, so stdout can be safely piped into another command. Without `--yolo`, a standalone task exits with an error if it needs an approval or user feedback.

Piped bytes are preserved and placed before an optional prompt. Image-only tasks are valid.

## Common commands

```bash
dirac auth                         # Configure a provider and model
dirac history                      # Browse and resume prior tasks
dirac config                       # Show active configuration
dirac update                       # Check for a newer CLI release
dirac --continue                   # Resume this workspace's latest task
dirac --taskId <id> "Follow up"    # Resume a specific task
dirac kanban                       # Run the Kanban integration
```

`dirac task` (alias `dirac t`) accepts the same task options as the default prompt command, except for root-only ACP, Kanban, and `--continue` options. Run `dirac --help` or `dirac task --help` for the complete current option list.

Frequently used task options include:

| Option | Effect |
| --- | --- |
| `--act`, `--plan` | Select the task mode. These options conflict. |
| `--yolo` | Use standalone output and auto-approve actions. |
| `--auto-approve-all` | Auto-approve actions while retaining the interactive interface. |
| `--model <id>` | Override the configured model. |
| `--provider <id-or-url>` | Override the provider; requires `--model`. |
| `--images <paths...>` | Attach PNG, JPEG, GIF, or WebP images. |
| `--thinking [tokens]` | Enable extended thinking; the default budget is 1024. |
| `--reasoning-effort <level>` | Set `none`, `low`, `medium`, `high`, or `xhigh`. |
| `--timeout <seconds>` | Stop a standalone task after a positive number of seconds. |
| `--verbose` | Expand reasoning and task diagnostics. |
| `--json` | Emit newline-delimited JSON events. |

Images can also be mentioned inline. `@/images/screenshot.png` is relative to the selected workspace; ordinary absolute and `./relative` paths are also accepted when the file exists.

## Authentication

Start the interactive setup with:

```bash
dirac auth
```

Quick setup is available when all required values are supplied:

```bash
dirac auth --provider anthropic --apikey "$ANTHROPIC_API_KEY" --modelid claude-sonnet-4-6
dirac auth --provider openai --apikey "$OPENAI_API_KEY" --modelid gpt-4o --baseurl https://api.example.com/v1
```

Provider API keys can also be supplied through their standard environment variables, including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, and `HF_TOKEN`.

## Terminal colors

Dark-terminal colors remain the default. When `COLORFGBG` identifies a light background, Dirac selects its high-contrast light palette automatically. Override detection with:

```bash
DIRAC_COLOR_MODE=light dirac
DIRAC_COLOR_MODE=dark dirac
```

You can also select **Light terminal theme** under **Settings → Features**; that persisted choice applies on the next CLI launch. `DIRAC_COLOR_MODE` takes precedence over the saved setting, and `DIRAC_COLOR_MODE=auto` restores detection with a dark fallback. Dirac also honors `NO_COLOR` and `FORCE_COLOR`; redirected output is uncolored unless color is forced.

## Configuration and environment

Dirac stores configuration under `~/.dirac/data/` and per-workspace state under `~/.dirac/data/workspaces/`. Use `--config <path>` or `DIRAC_DIR` to select another Dirac home directory.

Other useful environment variables are:

- `DIRAC_NO_AUTO_UPDATE=1` disables the background update check.
- `DIRAC_NO_EMOJI=1` selects Unicode/ASCII fallbacks for icons.
- `CUSTOM_HEADERS` supplies OpenAI-compatible custom headers in JSON or `key=value` form.
- `DIRAC_COMMAND_PERMISSIONS` restricts shell commands with allow and deny patterns.

See the installed `dirac(1)` manual for the complete command and environment reference.

## License

Dirac is licensed under the Apache License 2.0.
