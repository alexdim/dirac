# CodeBoarding notes

Working notes on how CodeBoarding operates and what replicating it would take. Captured 2026-10-15 while evaluating a rerun on the dirac repo.

## How the pipeline splits work between static analysis and the LLM

```
static_analyzer        diagram_analysis          LLM (per-component)    output_generators
─────────────────      ──────────────────       ─────────────────      ──────────────────
LSP-driven analysis    clusters files into      names components,      renders .md files
of the whole repo  →   components, assembles →  writes abstracts/   →  (tables, mermaid,
call graph, defs,      scope per component      edge descriptions      file inventories)
refs, LOC stats
```

The 2026-10-14 full run on this repo resolved 73,303 call sites → 41,042 definitions → 19,151 edges with zero tokens, then made only 73 LLM calls totaling ~677k input / ~115k output tokens (~$2.50 on gemini-4-argon intro pricing). The LLM writes only the prose — component names, "what this does" paragraphs, relation labels. The tables, file lists, and diagram skeletons are generated deterministically from `analysis.json`.

Implication: a weaker/local model degrades the descriptions, not the structural accuracy. Component boundaries and call graphs are identical regardless of model.

## Static-analysis toolchain

`codeboarding-setup` installs real language servers into `~/.codeboarding/servers/` and drives them over LSP (go-to-definition, find-references, call hierarchy):

| Tool | Language |
|---|---|
| typescript-language-server + TS 5.7 | TypeScript (workhorse for dirac) |
| pyright | Python |
| gopls | Go |
| rust-analyzer | Rust |
| jdtls | Java |
| csharp-ls | C# |
| intelephense | PHP |
| tokei | LOC/language stats → `file_coverage.json` |

Plus a bundled Node 20 runtime for the JS-based servers. Config: `~/.codeboarding/servers/installed.json`.

## Replicating it in a new program

Difficulty by component:

| Component | Difficulty |
|---|---|
| LLM provider layer | Easy — env-var dispatch to chat APIs |
| Markdown/Mermaid rendering | Easy — templates over analysis data |
| Component clustering & naming | Medium — graph heuristics + LLM labels |
| Incremental updates, fingerprinting, caching | Medium — invalidation edge cases |
| Multi-language LSP orchestration | Hard — the real moat |

The hard part is what produces `static_analysis.pkl`: driving many heterogeneous language servers (each with its own init handshake, workspace semantics, and quirks), merging results into one cross-language call graph, with resolution retries, caching, and progress tracking. Months of edge-case work.

Feasible variants:

- Single-language clone (TS-only via the TypeScript compiler API or `ts-morph`): a few weeks. For a TS codebase like dirac this covers ~90% of the value.
- LLM-agent substitute: skip LSP, have an agent walk the repo with grep/tree-sitter and write docs. Simpler, but call-graph accuracy and component boundaries are approximations, not ground truth.
- Full multi-language replication: not worth it — that is their core asset.

The entire implementation is readable locally at `~/Library/Application Support/pipx/venvs/codeboarding/lib/python3.12/site-packages/` (`static_analyzer/`, `diagram_analysis/`, `agents/`, `output_generators/`).

## Coverage gaps (real source files not analyzed)

Snapshot of `file_coverage.json` after the incremental run of 2026-10-15 (commit `bf3f4b09`): 2,538 total files, 1,270 analyzed, 1,269 skipped. The backend (`src/`, `cli/`, `hosts/`, `integrations/`, `services/`) is fully covered; the real gaps below total ~345 files.

### 1. `webview-ui/` React frontend — 310 files (extraction cap)

Scope 16 ("Webview UI Components") exists but sampled only 2 of ~600 files; incremental runs never re-expand unchanged scopes. Missing by area:

```
features/settings    98 files
features/modular-ui  93 files
app/ + shared/ + assets ~95 files
dirac-rules/worktrees/chat/history/banners ~14 files
other webview src    ~10 files
```

This is a CodeBoarding per-scope extraction budget cap — reportable upstream. A `codeboarding full` rerun may expand it.

### 2. Protobuf contracts — 19 files (unsupported file type)

`proto/dirac/` — the extension↔core gRPC surface: `task.proto` (TaskService: cancel/clear/size), `browser.proto` (BrowserService: Chrome discovery/relaunch), `checkpoints.proto`, `commands.proto`, `common.proto`, `file.proto`, `goal.proto`, `hooks.proto`, `models.proto`, `slash.proto`, `state.proto`, `ui.proto`, `web.proto`, `worktree.proto`.
`proto/host/` — the host-IDE bridge surface: `diff.proto`, `env.proto`, `testing.proto`, `window.proto`, `workspace.proto`.

The "Dirac Protocol Message Definitions" component exists in the docs but its sources were never extracted.

### 3. Build/release scripts — 16 files (unsupported file type)

`scripts/`: `add-endpoints-to-{jetbrains,npm,vsix}.sh` (enterprise endpoint injection), `build-cli-artifact.sh` (CLI release via GitHub Actions), `check-architecture.sh` (TECH-DEBT-PLAN architecture guard), `package-cli.sh`, `publish.sh` (unified resumable publisher), `publish-extension.sh` (deprecated shim → publish.sh), `proto-lint.sh`, `install.sh`, `test-install.sh`, `test-bundled-endpoints.sh`, `run-extension-host.sh`, `rundiraccore.sh`, `get-vscode-usages.sh`, `review-by-category.sh` (PR #125 helper).

### 4. Previously over-ignored — FIXED in commit e171bd4b

`src/hosts/vscode/hostbridge/env/*` (9 files, caught by `env/` venv pattern), `src/services/temp/*` (2 files, caught by `temp/`), `hostbridge/testing/getWebviewHtml.ts` (`**/testing/**`), `vite.config.ts`/`vitest.config.ts`/`platform.config.ts` (`*.config.*`). All now analyzed; spawned the new "VS Code Hostbridge Environment Services" component.

Everything else skipped is intentional: ~800 test files (`__tests__`, `*.test.*`, e2e) and ~120 docs/locales/assets.
