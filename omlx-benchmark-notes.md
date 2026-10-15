# oMLX & Splash Benchmark Report and Decision Guide

Captured 2026-10-15 on Apple M5 Max (64 GB, 40 GPU cores, macOS 27.0.1), oMLX `0.7.1.dev2`, Splash `1.3.2`, DFlash2 drafter `incoai/Qwen3.6-35B-A3B-DFlash2`.

## Executive Decision Matrix

| Decision Dimension | `occamy-1.0-oQ4e-mtp` + **Splash** | `occamy-1.0-oQ4e-mtp` + **MLX** | `Tiel-Coder-35B` + **MLX** | `Tiel-Coder-35B` + **Splash** |
|---|---|---|---|---|
| **Recommended role** | **Best overall for CodeBoarding & general agentic prose/analysis** | Fallback if external engine is undesired | **Best for pure interactive coding / raw code completion** | Not recommended (slower than MLX + loads unused vision tower) |
| **Engine backend** | `splash serve-native` (`--language-only`, int8 KV, DFlash2) | `BatchedEngine` (`mlx-lm`, raw KV, Lightning MTP <=3) | `VLMBatchedEngine` (`mlx-vlm`, raw KV, Lightning MTP <=3) | `splash serve-native` (vision enabled, int8 KV, DFlash2) |
| **Memory footprint** | 24.04 GB planned (22.1 GB actual) | 20.42 GB (19.81 GB actual) | 21.13 GB (20.30 GB actual) | 24.72 GB planned |
| **Prefill @ 1k / 4k (canonical)** | **6,175 / 6,764 t/s** | 4,427 / 6,002 t/s | 4,220 / 5,873 t/s | **6,230 / 6,623 t/s** |
| **Decode @ 1k / 4k (canonical raw/bench)** | 179.1 / 160.0 t/s | 168.9 / 150.6 t/s | **194.2 / 167.2 t/s** | 147.3 / 135.3 t/s (truncated at 101 / 44 tok) |
| **Decode @ 1k / 4k (arch analysis, thinking off)** | **134.2 / 124.4 t/s** | 120.7 / 123.9 t/s | **195.0 / 160.4 t/s** (refused truncated input) | 111.6 / 105.2 t/s (refused truncated input) |
| **Decode @ 1k / 4k (arch analysis, thinking on)** | **167.8 / 144.6 t/s** (up to 209.1 t/s on code) | 124.8 / 123.3 t/s | **171.1 / 185.0 t/s** | 131.1 / 118.1 t/s (up to 170.4 t/s on code) |
| **Batch x2 / x4 @ 1k (arch analysis, 100% comp)** | **201.8 / 273.0 t/s** (canonical: 278.2 / 448.7) | 178.0 / 402.7 t/s (canonical) | **210.3 / 445.8 t/s** (canonical) | 176.1 / 257.9 t/s (canonical: 255.2 / 401.7) |
| **Pipeline reliability on arbitrary code slices** | **High** — follows structure prompts without refusal | **High** — follows structure prompts without refusal | **Low unless `terse=false`** — refuses mid-line truncated snippets | **Low unless `terse=false`** — refuses or truncates early |

---

## Root-Cause Findings from `server.log` and `splash.log`

1. **Why Tiel beats Occamy on MLX (`194 vs 169 t/s` canonical; `185 vs 123 t/s` thinking-on chat)**:
   - Tiel retains `vision_config` in `config.json` and loads into `VLMBatchedEngine` (`engine/vlm.py`), whereas text-only Occamy loads into `BatchedEngine` (`engine/batched.py`).
   - In oMLX `0.7.1.dev2`, four Qwen3.5/3.6 Metal kernel patches are wired only in `engine/vlm.py:2630-2720` and not in `engine/batched.py`: `qwen35_moe_routed_decode` (2-launch fused routed-expert decode), `qwen35_gdn_prework` (`qwen35_gdn_verify_fused`), `qwen35_verify_sdpa_split`, and `qwen35_gdn_chunked`.
   - As a result, a 40-layer MoE backbone verify cycle takes **11.0–12.2 ms** on Tiel (`VLMBatchedEngine`) versus **16.5–19.5 ms** on Occamy (`BatchedEngine`), even when Occamy achieves higher MTP draft acceptance (`78.3%` vs `71.4%`).

2. **Why Occamy beats Tiel on Splash (`168–209 vs 118–170 t/s` thinking-on; `134–184 vs 105–148 t/s` non-echoing thinking-off)**:
   - Splash replaces both MLX engines with the same `splash serve-native` Metal engine + `incoai/Qwen3.6-35B-A3B-DFlash2` draft model.
   - Occamy runs with `--language-only` (no vision tower overhead) and aligns closer to the stock `Qwen3.6-35B-A3B-DFlash2` drafter (`2.6–4.7 tok/cycle` vs Tiel's `2.2–4.1 tok/cycle` on novel prose/code).
   - Note from Splash `/status`: `ane_ffn.state = "off"` (`"the target has no dense FFN layers"`). On `Qwen3.6-35B-A3B` MoE models, Splash's prefill speedup comes from its Metal GPU kernels and int8 KV pages (`block_tokens = 32`), not ANE FFN offload (which only applies to dense `Qwen3.8-27B`).

3. **Why oMLX's built-in Splash benchmark (`_ChatBenchmark`) was flawed and needed a controlled rerun**:
   - In MLX mode, `/admin/api/bench/start` calls `engine.stream_generate(token_ids)` (raw token continuation, no chat template, 128/128 tokens completed on all trials).
   - In Splash mode, `_ChatBenchmark` sends `[{"role": "user", "content": "BENCH-<uuid> <raw code_python slice>"}]` with `reasoning_effort="none"` and no instruction.
   - Tiel's `chat_template.jinja` (`qwen3.8-froggeric-v22.5.0`) defaults to `terse=true`, injecting a ~175-token system prompt before the user turn ending with: *"If a user request is genuinely ambiguous, ask a sharp question, don't guess."*
   - That caused two artifacts in Tiel's built-in Splash run:
     1. **Prefix-cache contamination (`deduplicated 160` / `cached 160`)**: The first 5 KV blocks (`5 x 32 = 160` tokens) preceded `BENCH-<uuid>` and were deduplicated/cached across trials.
     2. **Early EOS truncation**: Tiel stopped at **101/128** tokens (@1k), **44/128** tokens (@4k), and **37–72/128** tokens in batch (leaving 3 of 4 batch lanes idle for over half the measurement window). Even on controlled architecture-analysis prompts, Tiel's `_terse` prompt caused it to refuse mid-line truncated snippets when `thinking=off`.

4. **Why Tiel spiked to `233–312 t/s` on bare continuation prompts**:
   - On `code_mixed` @8k/32k/131k in MLX and on bare 1k code-continuation in Splash, Tiel echoed lines from the prompt verbatim.
   - In MLX, that engaged the MTP prefix-copy path (`copy=259..386` of 512 tokens, pushing `tok/cycle` to `4.34–5.95` past the depth-3 ceiling of 4.0).
   - In Splash, echoing the prompt pushed DFlash2 to `5.1–7.1 tok/cycle` (`233.6–290.1 t/s` single, `615.5–770.7 t/s` batch x4). Neither measures novel token generation.

---

## Side-by-Side Benchmark Tables (`code_python`, M5 Max 64 GB)

### Table 1 — Canonical oMLX Benchmark (`POST /admin/api/bench/start`, `code_python`, `gen=128`)

| Metric | Occamy (MLX) | Occamy (Splash*) | Tiel (MLX) | Tiel (Splash*) |
|---|---:|---:|---:|---:|
| **Prefill @ 1,024** | 4,426.5 t/s (0.23s) | **6,175.0 t/s** (0.17s) | 4,219.5 t/s (0.24s) | **6,230.3 t/s** (0.16s, 160t dedup) |
| **Prefill @ 4,096** | 6,001.7 t/s (0.68s) | **6,764.1 t/s** (0.61s) | 5,872.6 t/s (0.70s) | **6,623.3 t/s** (0.62s, 160t dedup) |
| **Decode @ 1,024** | 168.9 t/s (128t) | **179.1 t/s** (101t) | **194.2 t/s** (128t) | 147.3 t/s (101t) |
| **Decode @ 4,096** | 150.6 t/s (128t) | **160.0 t/s** (128t) | **167.2 t/s** (128t) | 135.3 t/s (44t†) |
| **Batch x2 @ 1,024 (agg TG)** | 178.0 t/s (256t) | **278.2 t/s** (228t) | 210.3 t/s (256t) | 255.2 t/s (200t†) |
| **Batch x4 @ 1,024 (agg TG)** | 402.7 t/s (512t) | **448.7 t/s** (477t) | **445.8 t/s** (512t) | 401.7 t/s (273t†) |
| **Leaderboard IDs (1k / 4k)** | `opz8wttu` / `5w1pwc51` | Skipped (`splash`) | `fqih5u80` / `fppmnp3q` | Skipped (`splash`) |

*\*Built-in Splash bench uses `_ChatBenchmark` (un-instructed user turn, `reasoning_effort="none"`). †Tiel hit early EOS at 44 tokens (@4k) and 37–72 tokens (batch).*

### Table 2 — Controlled Chat Benchmark (`code_python` Architecture Analysis, `cached=0`, 100% completion window)

Places `BENCH-<uuid>` at token 0 of the `system` turn (preventing Tiel's 160-token `_terse` prefix cache hit) and appends an explicit architectural analysis instruction (preventing early EOS and verbatim code-copying).

| Workload (`code_python` slice + analysis prompt) | Occamy (Splash) | Occamy (MLX) | Tiel (MLX) | Tiel (Splash) |
|---|---:|---:|---:|---:|
| **Prefill @ 1k (`thinking=off`)** | **4,972.0 t/s** (0.21s) | 2,890.1 t/s (0.36s) | 3,905.0 t/s (0.27s) | 3,866.0 t/s (0.27s) |
| **Prefill @ 4k (`thinking=off`)** | **5,203.3 t/s** (0.76s) | 4,312.2 t/s (0.87s) | **5,700.9 t/s** (0.66s) | 4,586.0 t/s (0.86s) |
| **Decode @ 1k (`thinking=off`, 128/128 tok)** | **134.2 t/s** (2.7 tok/c) | 120.7 t/s (2.2 tok/c) | **195.0 t/s**‡ (2.7 tok/c) | 111.6 t/s‡ (2.4 tok/c) |
| **Decode @ 4k (`thinking=off`, 128/128 tok)** | **124.4 t/s** (2.6 tok/c) | 123.9 t/s (2.3 tok/c) | **160.4 t/s**‡ (2.4 tok/c) | 105.2 t/s‡ (2.2 tok/c) |
| **Decode @ 1k (`thinking=on`, 256/256 tok)** | **167.8 t/s** (3.9 tok/c) | 124.8 t/s (2.7 tok/c) | **171.1 t/s** (2.4 tok/c) | 131.1 t/s (2.8 tok/c) |
| **Decode @ 4k (`thinking=on`, 256/256 tok)** | **144.6 t/s** (3.0 tok/c) | 123.3 t/s (2.8 tok/c) | **185.0 t/s** (2.4 tok/c) | 118.1 t/s (2.6 tok/c) |
| **Code-gen @ 1k / 4k (`thinking=on`, 256/256 tok)** | **209.1 / 175.7 t/s** (4.7/3.6 tok/c) | — | — | **169.7 / 170.4 t/s** (3.9/4.1 tok/c) |
| **Batch x2 / x4 @ 1k (`thinking=off`, 256/512 tok)** | **201.8 / 273.0 t/s** | — | — | 176.1 / 257.9 t/s |

*‡With `thinking=off` and default `terse=true`, Tiel generated 128 tokens of refusal/complaint that the pasted code snippet ended mid-function, whereas Occamy produced the requested `# Architectural Analysis` markdown.*

---

## Reproducible Procedure and Commands

### 1. Canonical oMLX Leaderboard Benchmark (MLX)

```bash
# 1. Warm the model with >=2048 tokens so shape-gated NAX/MoE/verify kernels compile before measurement
curl -s http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer 1234" -H "Content-Type: application/json" \
  -d '{"model":"occamy-1.0-oQ4e-mtp","messages":[{"role":"user","content":"Warmup"}],"max_tokens":16}'

# 2. Run the canonical leaderboard matrix (code_python, [1024, 4096], batch [2, 4], gen 128)
curl -s http://127.0.0.1:8000/admin/api/bench/start \
  -H "Authorization: Bearer 1234" -H "Content-Type: application/json" \
  -d '{"model_id":"occamy-1.0-oQ4e-mtp","prompt_lengths":[1024,4096],"generation_length":128,"batch_sizes":[2,4],"context_profile":"code_python","warmup_mode":"quick"}'
```

### 2. Enabling Splash per Model

```bash
# Set Occamy to Splash (recommended) and Tiel to in-process MLX (recommended)
curl -s -X PUT http://127.0.0.1:8000/admin/api/models/occamy-1.0-oQ4e-mtp/settings \
  -H "Authorization: Bearer 1234" -H "Content-Type: application/json" \
  -d '{"external_engine":"splash"}'

curl -s -X PUT http://127.0.0.1:8000/admin/api/models/Tiel-Coder-35B-A3B-MLX-oQ4e-MTP/settings \
  -H "Authorization: Bearer 1234" -H "Content-Type: application/json" \
  -d '{"external_engine":null}'
```

---

## Complete Leaderboard Upload Inventory (`owner_hash`: `dd59c5a4...`)

See `omlx-leaderboard-message.md` for the ready-to-send maintainer message requesting removal of the 20 non-canonical `code_mixed` rows (`46w1gchc`, `52piky80`, `kieay8lg`, `qw76htl3`, `2q8yz4uw`, `g4gcsba2`, `y8tvyb63`, `xxkdty2g`, `k8hnsq2l`, `e6d4g4ly`, `7178bmsa`, `22pw7uzk`, `fip4d8mb`, `4xw0ihae`, `vxamu9hg`, `28d8kn7u`, `aa618ont`, `cpztrsr1`, `disarmua`, `22zcsl6k` — 24 total minus the 4 canonical `code_python` rows `opz8wttu`, `5w1pwc51`, `fqih5u80`, `fppmnp3q`).
