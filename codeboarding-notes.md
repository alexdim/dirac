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

## Coverage gaps (remaining un-analyzed files)

Snapshot of `file_coverage.json` after the incremental run of 2026-10-15 ~17:41: 2,538 total files, **1,567 analyzed**, 972 skipped. All TypeScript source (backend `src/` + `cli/` + `webview-ui/`) is covered. Remaining gaps are file types with no extractor:

- **`cli/dirac.rb`** — the only un-analyzed code file (Ruby).
- **Protobuf contracts — 19 files**: `proto/dirac/` (extension↔core gRPC: `task`, `browser`, `checkpoints`, `commands`, `common`, `file`, `goal`, `hooks`, `models`, `slash`, `state`, `ui`, `web`, `worktree`) and `proto/host/` (host-IDE bridge: `diff`, `env`, `testing`, `window`, `workspace`). The "Dirac Protocol Message Definitions" component exists but its sources were never extracted.
- **Build/release scripts — 16 files** in `scripts/`: `add-endpoints-to-{jetbrains,npm,vsix}.sh`, `build-cli-artifact.sh`, `check-architecture.sh`, `package-cli.sh`, `publish.sh`, `publish-extension.sh` (deprecated shim), `proto-lint.sh`, `install.sh`, `test-install.sh`, `test-bundled-endpoints.sh`, `run-extension-host.sh`, `rundiraccore.sh`, `get-vscode-usages.sh`, `review-by-category.sh`.

Everything else skipped is intentional: ~800 test files, ~120 docs/locales/assets, ~60 configs (`*.json`, `*.html`, `*.css`, `*.svg`).

### Upstream-reportable bugs found while fixing coverage

- **Solution-style tsconfig silently drops packages**: `typescript_config_scanner` only discovers `tsconfig.json`/`jsconfig.json`; a monorepo package whose `tsconfig.json` is `files: []` + `references:` yields zero owned files from `tsc --showConfig` and the entire package is skipped (cost us all 310 `webview-ui` files). It should resolve `references:` leaf projects. Workaround committed: `webview-ui/tsconfig.json` now uses `include: ["src/**/*"]`.
- **`.codeboardingignore` stock patterns over-match real source**: `env/` (meant for Python venvs) swallowed `src/hosts/vscode/hostbridge/env/`, `temp/` swallowed `src/services/temp/`, `**/testing/**` swallowed `hostbridge/testing/`, `*.config.*` swallowed `platform.config.ts`. Fixed with trailing negations (commit `e171bd4b`); patterns should be root-anchored or file-type-scoped upstream.
- **Incremental fingerprint trick**: deleting entries from `.codeboarding/fingerprint.json` forces the next `incremental` run to treat those files as added (A=N) — useful for re-analyzing previously-capped scopes without touching source.
