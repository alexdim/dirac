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
