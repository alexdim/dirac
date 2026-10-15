# oMLX community benchmark procedure

Working notes captured 2026-10-15 (oMLX 0.7.1.dev1 → dev2, Splash 1.3.2, M5 Max 64 GB).

## Canonical benchmark methodology

The app ships a fixed default matrix — this is what the omlx.ai leaderboard and
"optimal settings" lookups compare (`OPTIMAL_CONTEXT_LENGTH = 4096`):

```json
{
  "model_id": "<model>",
  "prompt_lengths": [1024, 4096],
  "generation_length": 128,
  "batch_sizes": [2, 4],
  "context_profile": "code_python",
  "warmup_mode": "quick"
}
```

Procedure:

1. Configure the model's live settings first — the run uploads a filtered
   snapshot of `model_settings.json` as the result's "optimal" settings.
2. Warm the model with a throwaway `/v1/chat/completions` request so JIT
   compile doesn't contaminate the first test.
3. `POST /admin/api/bench/start` with the body above (auth: `Bearer 1234`).
4. Poll `GET /admin/api/bench/{bench_id}/results` until `status: completed`.
5. Upload to omlx.ai is automatic (`upload_state.phase: done`). Duplicate
   content → HTTP 409, harmless. Splash-engine runs are auto-skipped
   (`skipped_reason: "splash"` — different engine, kept off the leaderboard).

Methodology traps discovered:

- `code_mixed` corpus has a repetitive stretch near the 8k offset — MTP
  prefix-copy (`copy=358/371`, tok/cycle 5.45 > depth-3 max of 4) inflates gen
  t/s to ~300. Real measurement, degenerate input. Use `code_python`.
- Long contexts (8k/32k/131k) are off-matrix and mostly corpus-noise for gen
  t/s; they only measure prefill honestly.
- `generation_length` below ~512 makes gen t/s acceptance-luck-dependent.
- Early EOS truncates the window (occamy 8k/32k produced 416/425 tokens).
- `prompt_lengths` must be from {1024…200000}, `batch_sizes` from {2,4,8}.
- Never bench right after `omlx restart` without warming — first request eats
  JIT compile (568 t/s prefill artifact).

## Splash engine (incoai/splash, separate Metal engine)

- Install: `brew install incoai/tap/splash` (official, M3+; `splash-m1` port for
  M1/M2). Min version 1.3.0 for local MLX checkpoints + local DFlash2 draft;
  1.3.1+ for mixed-bit (oQ4e) quants. Installed: 1.3.2.
- Enable per model: `model_settings.json` → `models.<id>.external_engine =
  "splash"`, then `omlx restart`. Serves via `splash serve` subprocess on a
  loopback port; oMLX proxies requests and reports it like other engines.
- Requires the DFlash2 draft in a model dir (Splash does NOT use the MTP head):
  `hf download incoai/Qwen3.6-35B-A3B-DFlash2 --local-dir ~/.lmstudio/models/incoai/Qwen3.6-35B-A3B-DFlash2`
  (~1 GB). First model load hashes weights (~4 min); later loads ~16 s via
  persistent cache.
- Settings: `integrations.splash_kv_format` ("int8" default, "bf16" option),
  `splash_ane_prefill` (true), `splash_ssd_cache_gb`, `splash_max_memory_gb`.
- Supported archs: Qwen3.8-27B dense + Qwen3.6-35B-A3B MoE signatures.
- Bench results never reach the leaderboard by design.

## Results — canonical matrix (dev2, code_python, gen ≤128)

MLX in-process:

| Prompt | Occamy PP t/s | Tiel PP t/s | Occamy gen t/s | Tiel gen t/s |
|---|---|---|---|---|
| 1,024 | 4,427 | 4,220 | 168.9 | 194.2 |
| 4,096 | 6,002 | 5,873 | 150.6 | 167.2 |
| batch×2 @1k | — | — | 178.0 | 210.3 |
| batch×4 @1k | — | — | 402.7 | 445.8 |

Splash engine (int8 KV, ANE prefill, DFlash2):

| Prompt | Occamy PP t/s | Tiel PP t/s | Occamy gen t/s | Tiel gen t/s |
|---|---|---|---|---|
| 1,024 | 6,175 | 6,230 | 179.1 | 147.3 * |
| 4,096 | 6,764 | 6,623 | 160.0 | 135.3 * |
| batch×2 @1k | — | — | 278.2 | 255.2 |
| batch×4 @1k | — | — | 448.7 | 401.7 |

* Tiel/Splash gen numbers suspect — early EOS truncated the window (101 and 44
  tokens vs the 128 target), so they reflect ramp + a short sample, not steady
  state. Occamy/Splash is the honest read: +12–40% prefill, +6–9% decode,
  +55% batched gen vs MLX path. A spot request measured 393 t/s decode.

## Non-canonical runs (code_mixed, dev1/dev2) — kept for the record

Occamy dev2 @1k prefill 568 t/s was cold-start JIT; Tiel @8k gen 303/312 t/s
was the code_mixed copy-path artifact. Both are real numbers, wrong
interpretation — don't reuse.

## Leaderboard hygiene

Client has no retract/delete; uploads are write-only POSTs to
`omlx.ai/api/benchmarks`. To fix entries, contact the maintainer
(github.com/jundot/omlx issues) with the IDs below.

Uploaded rows (owner_hash dd59c5a4…, M5 Max 64GB):

| Model | Run | Context | ID | Note |
|---|---|---|---|---|
| occamy | dev1 code_mixed | 1024 | 46w1gchc | ok-ish (gen=512 noncanonical) |
| occamy | dev1 code_mixed | 8192 | 52piky80 | gen window ok |
| occamy | dev1 code_mixed | 131072 | qw76htl3 | ok |
| occamy | dev2 code_mixed | 1024 | k8hnsq2l | cold-start PP artifact |
| occamy | dev2 code_mixed | 8192 | e6d4g4ly | truncated gen (416) |
| occamy | dev2 code_mixed | 32768 | 7178bmsa | truncated gen (425) |
| occamy | dev2 code_mixed | 131072 | 22pw7uzk | ok |
| occamy | dev1 code_mixed solo | 32768 | y8tvyb63 | ok |
| occamy | dev1 code_mixed rerun | 1024 | 2q8yz4uw | ok |
| occamy | dev1 code_mixed rerun | 8192 | g4gcsba2 | ok |
| occamy | dev1 code_mixed rerun | 131072 | xxkdty2g | ok |
| occamy | canonical code_python | 1024 | opz8wttu | canonical |
| occamy | canonical code_python | 4096 | 5w1pwc51 | canonical |
| Tiel | dev1 code_mixed | 1024 | fip4d8mb | ok-ish |
| Tiel | dev1 code_mixed | 8192 | 4xw0ihae | 303 t/s copy artifact — flag |
| Tiel | dev1 code_mixed | 32768 | vxamu9hg | ok |
| Tiel | dev1 code_mixed | 131072 | 28d8kn7u | ok |
| Tiel | dev2 code_mixed | 1024 | aa618ont | ok |
| Tiel | dev2 code_mixed | 8192 | cpztrsr1 | 312 t/s copy artifact — flag |
| Tiel | dev2 code_mixed | 32768 | disarmua | ok |
| Tiel | dev2 code_mixed | 131072 | 22zcsl6k | ok |
| Tiel | canonical code_python | 1024 | fqih5u80 | canonical |
| Tiel | canonical code_python | 4096 | fppmnp3q | canonical |
