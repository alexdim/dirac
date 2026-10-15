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

Snapshot of `file_coverage.json` after the incremental run of 2026-10-15 ~17:41 (webview expansion run): 2,538 total files, **1,567 analyzed** (was 1,270), 972 skipped. Only **one code file** remains un-analyzed: `cli/dirac.rb` (Ruby, no extractor). Backend and frontend source are now fully covered; the remaining gaps are non-TS file types.

### 1. `webview-ui/` React frontend — 310 files — FIXED (root cause: solution-style tsconfig)

Scope 16 ("Webview UI Components") sampled only 2/~600 files because `webview-ui/tsconfig.json` is a solution file (`files: []` + `references:` → `tsc --showConfig` returns zero owned files, so `typescript_config_scanner` skipped the whole project; the scanner only discovers `tsconfig.json`/`jsconfig.json` filenames, never `tsconfig.app.json`). Fix applied: replaced `files: []` with `include: ["src/**/*"]` in `webview-ui/tsconfig.json` (safe — nothing in the build reads this file; typecheck targets `tsconfig.app.json`/`tsconfig.node.json` directly). Then removed the 320 `webview-ui/*` entries from `fingerprint.json` so the incremental diff treats them as added (A=320). Result: 301 webview files analyzed, component 16 now has real semantics and 3 relations in `overview.md`. Worth reporting upstream: solution-style tsconfigs should fall back to resolving `references:` leaf projects.

### 2. Protobuf contracts — 19 files (unsupported file type)

`proto/dirac/` — the extension↔core gRPC surface: `task.proto` (TaskService: cancel/clear/size), `browser.proto` (BrowserService: Chrome discovery/relaunch), `checkpoints.proto`, `commands.proto`, `common.proto`, `file.proto`, `goal.proto`, `hooks.proto`, `models.proto`, `slash.proto`, `state.proto`, `ui.proto`, `web.proto`, `worktree.proto`.
`proto/host/` — the host-IDE bridge surface: `diff.proto`, `env.proto`, `testing.proto`, `window.proto`, `workspace.proto`.

The "Dirac Protocol Message Definitions" component exists in the docs but its sources were never extracted.

### 3. Build/release scripts — 16 files (unsupported file type)

`scripts/`: `add-endpoints-to-{jetbrains,npm,vsix}.sh` (enterprise endpoint injection), `build-cli-artifact.sh` (CLI release via GitHub Actions), `check-architecture.sh` (TECH-DEBT-PLAN architecture guard), `package-cli.sh`, `publish.sh` (unified resumable publisher), `publish-extension.sh` (deprecated shim → publish.sh), `proto-lint.sh`, `install.sh`, `test-install.sh`, `test-bundled-endpoints.sh`, `run-extension-host.sh`, `rundiraccore.sh`, `get-vscode-usages.sh`, `review-by-category.sh` (PR #125 helper).

### 4. Previously over-ignored — FIXED in commit e171bd4b

`src/hosts/vscode/hostbridge/env/*` (9 files, caught by `env/` venv pattern), `src/services/temp/*` (2 files, caught by `temp/`), `hostbridge/testing/getWebviewHtml.ts` (`**/testing/**`), `vite.config.ts`/`vitest.config.ts`/`platform.config.ts` (`*.config.*`). All now analyzed; spawned the new "VS Code Hostbridge Environment Services" component.

Everything else skipped is intentional or non-source: ~800 test files (`__tests__`, `*.test.*`, e2e), ~120 docs/locales/assets, and ~60 config/metadata files (`*.json`, `*.html`, `*.css`, `*.svg`).
