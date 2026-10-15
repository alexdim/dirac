# oMLX & Splash Benchmark Report, Decision Guide, and Engine Audit

Captured 2026-10-15 on Apple M5 Max (64 GB, 40 GPU cores, macOS 27.0.1), oMLX `0.7.1.dev1` / `0.7.1.dev2`, Splash `1.3.2`, DFlash2 drafter `incoai/Qwen3.6-35B-A3B-DFlash2`.

## 1. Decision Table (`code_python`, M5 Max 64 GB)

| Option | Canonical PP @ 1k / 4k | Canonical TG @ 1k / 4k | Controlled Chat TG (Thinking Off, 128t) | Controlled Chat TG (Thinking On, 256t) | Batch x2 / x4 TG @ 1k | Memory (Actual / Planned) | Pipeline Behavior on Code Slices |
|---|---:|---:|---:|---:|---:|---:|---|
| **`occamy` + Splash (Recommended for CodeBoarding)** | **6,175 / 6,764 t/s** | 179.1 / 160.0 t/s | **134.2 / 124.4 t/s** | **167.8 / 144.6 t/s** (209.1 t/s code-gen) | **278.2 / 448.7 t/s** (201.8 / 273.0 chat) | 22.1 / 24.04 GB (`--language-only`) | **Follows instructions cleanly** |
| **`Tiel` + MLX (Recommended for Interactive Coding)** | 4,220 / 5,873 t/s | **194.2 / 167.2 t/s** | **195.0 / 160.4 t/s** | **171.1 / 185.0 t/s** | 210.3 / 445.8 t/s | 20.30 / 21.13 GB (`VLMBatchedEngine`) | Refuses truncated snippets unless `terse=false` |
| `occamy` + MLX | 4,427 / 6,002 t/s | 168.9 / 150.6 t/s | 120.7 / 123.9 t/s | 124.8 / 123.3 t/s | 178.0 / 402.7 t/s | 19.81 / 20.42 GB (`BatchedEngine`) | Follows instructions cleanly; slower decode (missing VLM Metal patches) |
| `Tiel` + Splash | **6,230 / 6,623 t/s** | 147.3 / 135.3 t/s (EOS @ 101/44t) | 111.6 / 105.2 t/s | 131.1 / 118.1 t/s (170.4 t/s code-gen) | 255.2 / 401.7 t/s (176.1 / 257.9 chat) | 24.72 GB (vision enabled) | Slower than MLX + loads unused vision tower + `terse` refusals |

---

## 2. Why VLM Beats LLM in oMLX `0.7.1.dev2` (Contradicting the Usual Rule)

**Do not switch Tiel from VLM (`VLMBatchedEngine`) to LLM (`BatchedEngine`) in oMLX `0.7.1.dev2`; doing so drops its MLX decode speed by ~25–35%.**

While keeping `vision_config` normally hurts text-only inference (and does cost ~0.49 GB of unused vision weights in RAM), oMLX `0.7.1.dev2` currently wires four Qwen3.5/3.6 MoE Metal decode/prefill patches in `/Applications/oMLX.app/Contents/Resources/omlx/engine/vlm.py` (lines 2630–2720) that have not been ported to `/Applications/oMLX.app/Contents/Resources/omlx/engine/batched.py` (`qwen35_moe_routed_decode`, `qwen35_gdn_prework`, `qwen35_verify_sdpa_split`, and `qwen35_gdn_chunked`). Furthermore, on the Splash path, `/Applications/oMLX.app/Contents/Resources/omlx/engine/splash.py` (lines 289–291, `splash_has_vision`) inspects raw `config.json["vision_config"]` and ignores `model_type_override: "llm"`.

```
Tiel checkpoint (has vision_config in config.json)
  |
  +-- In-process MLX (default: VLMBatchedEngine / mlx-vlm)
  |     + Penalty: +0.49 GB RAM for vision tower (20.30 GB vs Occamy 19.81 GB)
  |     + Gain: Gets 4 mlx-vlm-only Metal patches (routed_decode, gdn_prework,
  |             verify_sdpa_split, gdn_chunked) -> 11.0-12.2 ms/backbone-cycle (167-195 t/s)
  |     + If forced to LLM (BatchedEngine / mlx-lm):
  |             Loses all 4 patches -> drops to 16.5-19.5 ms/backbone-cycle (~121-168 t/s)
  |
  +-- Splash engine (external_engine: "splash")
        + Penalty: splash_has_vision() sees vision_config, omits --language-only,
                   allocates 24.72 GB (vs 24.04 GB), and ignores model_type_override="llm"
        + Gain: None for text-only coding
```

| Configuration for Tiel | Engine Used | Backbone Cycle Time | Chat Decode TG (Thinking On) | Memory (Actual) | Trade-off |
|---|---|---:|---:|---:|---|
| **Default VLM (`model_type_override: null`, MLX)** | `VLMBatchedEngine` (`mlx-vlm`) | **11.0–12.2 ms** | **171–185 t/s** | 20.30 GB | **Keep** — gets all 4 `mlx-vlm` Metal patches for +0.49 GB RAM |
| Forced LLM (`model_type_override: "llm"`, MLX) | `BatchedEngine` (`mlx-lm`) | 16.5–19.5 ms | ~123–125 t/s | ~19.81 GB | Saves ~0.49 GB RAM, but loses `qwen35_moe_routed_decode` & `gdn_prework` |
| Splash (`external_engine: "splash"`) | `splash serve-native` | — | 118–131 t/s | 24.72 GB | `splash_has_vision()` ignores `model_type_override` and omits `--language-only` |

Once `jundot/omlx` ports those four `mlx-vlm` patches to `BatchedEngine`, switching Tiel to `llm` (and running Occamy on MLX) will gain the expected speed and memory savings.

---

## 3. Unearthed Unoptimised oMLX Issues (`0.7.1.dev2`)

### Issue 1 — `BatchedEngine` (`mlx-lm`) is missing four Qwen3.5/3.6 MoE Metal patches that `VLMBatchedEngine` (`mlx-vlm`) installs

- **Locations**: `/Applications/oMLX.app/Contents/Resources/omlx/engine/vlm.py` (lines 2630–2720) vs `/Applications/oMLX.app/Contents/Resources/omlx/engine/batched.py` (lines 430–700).
- **Mechanism**: Four high-impact Metal kernel patches are wired only into `VLMBatchedEngine` (`mlx_vlm.models.qwen3_5_moe`) and are never called in `BatchedEngine` (`mlx_lm.models.qwen3_5_moe`):
  1. `apply_qwen35_moe_routed_decode_patch()` (`patches/qwen35_moe_routed_decode.py:989`) — fuses one-token and verify-window routed-expert `gate+up/SwiGLU` and `down/weighted-sum` into 2 Metal launches instead of 5. Hardcoded to `from mlx_vlm.models.qwen3_5_moe import language as vlm_moe`.
  2. `apply_qwen35_gdn_prework_patch()` + `qwen35_gdn_verify_fused` (`patches/qwen35_gdn_prework.py:1951`) — fuses Gated DeltaNet conv+SiLU+split+RMS+scale+conv-state prework and verify replay commit.
  3. `apply_qwen35_verify_sdpa_split_patch()` (`patches/qwen35_verify_sdpa_split.py:908`) — replaces the per-row SDPA verify loop with chunked hd-256 causal vector attention kernels (`[verify-split] hd-256 causal vector attention`).
  4. `apply_qwen35_gdn_prefill_patch()` (`patches/qwen35_gdn_chunked.py:35`) — pipelined Metal GDN prefill kernel (`min_t=64`).
- **Measured impact**: Identical 40-layer `qwen3_5_moe` oQ4e weights run at **11.0–12.2 ms/backbone-cycle** on `VLMBatchedEngine` (Tiel: `171–195 t/s` chat decode) vs **16.5–19.5 ms/backbone-cycle** on `BatchedEngine` (Occamy: `121–125 t/s` chat decode, despite higher MTP draft acceptance of `78.3%` vs `71.4%`).

### Issue 2 — `SplashEngine` (`splash_has_vision`) ignores `model_type_override == "llm"`

- **Location**: `/Applications/oMLX.app/Contents/Resources/omlx/engine/splash.py` (lines 289–291, 831, 923–925).
- **Mechanism**: `splash_has_vision(config)` checks `isinstance(config.get("vision_config"), dict)` on raw `config.json` without checking `model_settings.model_type_override == "llm"`.
- **Measured impact**: Setting a VLM checkpoint (like Tiel) to text-only (`model_type_override: "llm"`) in oMLX still launches `splash serve` without `--language-only`, wasting ~0.68 GB of Metal budget on vision weights that are never used.

### Issue 3 — `SplashEngine._stream()` re-tokenizes every streamed SSE chunk in Python

- **Location**: `/Applications/oMLX.app/Contents/Resources/omlx/engine/splash.py` (lines 1122, 1219–1243, 1381–1386).
- **Mechanism**: When proxying `/v1/chat/completions` through oMLX (`127.0.0.1:8000`), oMLX calls `count_chat_tokens()` (`self._tokenizer.apply_chat_template(...)` in Python) before forwarding the request, and calls `self._count_tokens(piece)` (`self._tokenizer.encode(piece)`) on every streamed SSE chunk solely to update dashboard live-tps counters.
- **Measured impact**: Adding the oMLX proxy layer reduced measured 4k prefill throughput from **5,191–6,764 t/s** (direct Splash loopback) to **4,658–5,005 t/s** (via `127.0.0.1:8000`) due to Python Jinja/tokenizer latency in TTFT.

### Issue 4 — Default Splash memory budget (`splash_max_memory_gb = null`) sizes the KV/state pool to a single context window

- **Location**: `/Applications/oMLX.app/Contents/Resources/omlx/engine/splash.py` (lines 403–423) and `engine_pool.py` (lines 1958–1971).
- **Mechanism**: When `integrations.splash_max_memory_gb` is `null`, `splash_memory_estimate()` budgets `weights + draft + 3 GiB + 1 x max_context KV` (`24.04 GiB` on a 64 GB Mac). With `--persistent-cache` enabled (`18 GiB` disk quota inherited from oMLX), Splash restores up to 19 GDN state checkpoints (`63 MiB` each) and `2,367` KV blocks (`~2.08 GiB`) on startup, pressuring the `3.19 GiB` dynamic budget (`dynamic_budget_bytes: 3,193,257,204` in `/status`) during multi-request or batch runs.

### Issue 5 — `warmup_mode="quick"` (32 prompt / 8 decode tokens) misses shape-gated Metal kernels

- **Location**: `/Applications/oMLX.app/Contents/Resources/omlx/admin/benchmark.py` (lines 68–77, 1929–1944).
- **Mechanism**: A 32-token warmup only compiles the 31-token prefill shape and `q_len=4` verify shape. Shape-gated kernels — `qwen35_moe_weighted_sum` (`min_tokens=1024`), `qwen35_q4_mlp` NAX dispatch (`min_tokens=2048`), and `qwen35_verify_sdpa_split` (`q_len in {2,3,7,8}`) — compile lazily during the first 1,024-token and 2,048+-token benchmark trials.
- **Measured impact**: Produced cold-start leaderboard artifacts `k8hnsq2l` (`PP 568 t/s`, `model_cache_ms=1703.8ms`), `e6d4g4ly` (`PP 3,302 t/s`, chunk 0 `1182ms` vs chunk 1 `337ms`), and `aa618ont` (`PP 2,772 / TG 120.2 t/s`).

### Issue 6 — `_ChatBenchmark` (Splash bench) places `BENCH-<uuid>` after template system prompts and omits a continuation instruction

- **Location**: `/Applications/oMLX.app/Contents/Resources/omlx/admin/benchmark.py` (lines 1313–1335).
- **Mechanism**: `_ChatBenchmark` sends `[{"role": "user", "content": "BENCH-<uuid> <raw code_python slice>"}]`. On checkpoints whose `chat_template.jinja` injects a default system prompt (such as Tiel's 175-token `_terse` block), the static system prompt precedes `BENCH-<uuid>`, so Splash deduplicates/caches the first 5 KV blocks (`5 x 32 = 160` tokens) across trials. And without a user instruction, instruct models emit early EOS (`44–101/128` tokens) on the raw code fragment.

### Issue 7 — Leaderboard upload does not filter MTP prefix-copy outliers (`tok/cycle > mtp_depth + 1`)

- **Location**: `/Applications/oMLX.app/Contents/Resources/omlx/admin/benchmark.py` (lines 1588–1661).
- **Mechanism**: When a model echoes repetitive prompt lines (as Tiel did on `code_mixed` at 8k, 32k, and 131k), oMLX's prefix-copy path accepts up to 386 of 512 tokens (`tok/cycle = 4.34–5.95` on depth-3 MTP), uploading 303–312 t/s "decode" numbers that measure prompt-copying rather than model generation.

---

## 4. Complete Performance Tables

### Table 1 — Canonical oMLX Benchmark (`POST /admin/api/bench/start`, `code_python`, `[1024, 4096]`, `batch=[2,4]`, `gen=128`, dev2)

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

Places `BENCH-<uuid>` at token 0 of the `system` turn (eliminating Tiel's 160-token `_terse` prefix cache hit) and appends an explicit architectural analysis instruction (eliminating early EOS and verbatim code-copying).

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

### Table 3 — Historical Non-Canonical Runs (`code_mixed`, `gen=512`, dev1 vs dev2)

 Preserved for reference; all 20 uploaded rows from these exploratory runs are listed in `omlx-leaderboard-message.md` for removal.

| Model & Prompt | dev1 PP t/s | dev2 PP t/s | dev1 TG t/s | dev2 TG t/s | Artifact / Note |
|---|---:|---:|---:|---:|---|
| **Occamy @ 1,024** | 4,290.6 | 568.0 † | 162.7 | 150.8 | †dev2 cold-start 1,023-tok prefill JIT (`k8hnsq2l`) |
| **Occamy @ 8,192** | 5,794.6 | 3,301.9 † | 123.5 * | 103.7 * | *EOS @ 148t (`g4gcsba2`) & 416t (`e6d4g4ly`) + NAX JIT |
| **Occamy @ 32,768** | 4,373.4 | 4,083.2 | 132.9 | 149.3 * | *EOS @ 425t (`7178bmsa`), `copy=115/119` |
| **Occamy @ 131,072** | 1,923.6 | 1,882.4 | 69.6 | 69.8 | `copy=92/156` (dev1), `copy=87/160` (dev2) |
| **Tiel @ 1,024** | 4,286.6 | 2,771.7 † | 208.8 | 120.2 † | †dev2 cold-start `verify_sdpa_split` JIT (`aa618ont`) |
| **Tiel @ 8,192** | 5,896.1 | 5,722.6 | 303.1 ‡ | 312.1 ‡ | ‡Prefix-copy (`copy=359/366` & `386/401`, `tok/c=4.83/5.95`) |
| **Tiel @ 32,768** | 4,373.0 | 4,276.4 | 202.7 ‡ | 192.3 | ‡dev1 `copy=259/319` (`tok/c=4.34`), dev2 `copy=104/126` |
| **Tiel @ 131,072** | 1,958.2 | 1,916.1 | 166.1 ‡ | 168.8 ‡ | ‡Prefix-copy (`copy=352/364` & `358/371`, `tok/c=5.22/5.45`) |

---

## 5. Reproducible Commands

```bash
# Canonical MLX benchmark (after warming >=2048 tokens)
curl -s http://127.0.0.1:8000/admin/api/bench/start \
  -H "Authorization: Bearer 1234" -H "Content-Type: application/json" \
  -d '{"model_id":"occamy-1.0-oQ4e-mtp","prompt_lengths":[1024,4096],"generation_length":128,"batch_sizes":[2,4],"context_profile":"code_python","warmup_mode":"quick"}'

# Recommended engine assignment: Occamy -> Splash, Tiel -> MLX (VLMBatchedEngine)
curl -s -X PUT http://127.0.0.1:8000/admin/api/models/occamy-1.0-oQ4e-mtp/settings \
  -H "Authorization: Bearer 1234" -H "Content-Type: application/json" \
  -d '{"external_engine":"splash"}'

curl -s -X PUT http://127.0.0.1:8000/admin/api/models/Tiel-Coder-35B-A3B-MLX-oQ4e-MTP/settings \
  -H "Authorization: Bearer 1234" -H "Content-Type: application/json" \
  -d '{"external_engine":null}'
```
