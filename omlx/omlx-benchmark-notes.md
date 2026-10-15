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

### Issue 8 — `TurboQuant` KV cache allocates raw 16-bit KV during prefill, quantizes post-prefill, and slows 64k verify by 18%

- **Location**: `server.log` lines 3749–3783 (`TurboQuant: converted 15/64 cache layers to 8.0-bit, skipped last KVCache layer`).
- **Mechanism**: With `turboquant_kv_enabled: true (8.0 bits)` on `Qwen3.8-27B-oQ4e-mtp` at 65,537 tokens, the scheduler still reserves full 16-bit KV capacity during prefill (`+3.89 GB`, peak `23.34 GB` vs `23.40 GB` raw) and only converts 15/16 KV layers to 8-bit *after* all 65,536 prefill tokens finish (`421 ms` post-prefill step). During decode, `turboquant_attention` bypasses the native fused `verify_sdpa_split` kernel and dequantizes on the fly, increasing 64k backbone verify latency from **88.2 ms/cycle** (raw KV, `37.8 t/s`) to **103.9 ms/cycle** (TQ8, `35.5 t/s`).

### Issue 9 — Dense `qwen3_5` (`Qwen3.8-27B`) `qwen35_packed_linear` (296 layers) is only wired in `VLMBatchedEngine`

- **Location**: `server.log` lines 2835 vs 2912–2913 & 2932 (`omlx.patches.qwen35_packed_linear` / `engine/vlm.py`).
- **Mechanism**: When a dense `qwen3_5` checkpoint (such as `Dirk-Qwen3.8-27B-MLX-oQ4e`) is forced to `model_type_override: "llm"` (`BatchedEngine`), it loses `Qwen packed 4-bit projections: 296 layers` (`qwen35_packed_linear`), drops from 1,266 to 986 `oQ A8` modules, and loses `qwen35_verify_sdpa_split` + `qwen35_gdn_prework`. Removing `model_type_override: "llm"` boosted Dirk's decode from **33.7–38.1 t/s** to **59.8–62.5 t/s** (+72–85%) and prefill from **618–777 t/s** to **978–1,216 t/s** (+58%).

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

---

## 6. Production Validation — `codeboarding incremental` on `occamy-1.0-oQ4e-mtp` + Splash

Executed `codeboarding incremental --local . --render md` on `dirac` (`v0.5.21`, 63 changed files across `A=12 M=51 D=0`):

```bash
env -u GOOGLE_API_KEY \
  OPENAI_BASE_URL=http://127.0.0.1:8000/v1 \
  OPENAI_API_KEY=1234 \
  AGENT_MODEL=occamy-1.0-oQ4e-mtp \
  CB_CTX_OPENAI_OCCAMY_1_0_OQ4E_MTP=131072,32768 \
  DO_NOT_TRACK=1 CODEBOARDING_TELEMETRY=false \
  codeboarding incremental --local . --render md
```

| Metric | Measured Value (`omlx--occamy-1.0-oQ4e-mtp-54ab0f1a.log`) |
|---|---|
| **Changed files analyzed** | 63 files (`15` root + `178` sub-components, `1,092` relations, `39` docs updated) |
| **LLM calls** | 30 requests (including multi-turn `read_file` tool calls) |
| **Total input tokens** | 366,474 tokens (up to 77,160 tokens in a single scope) |
| **Splash prefix-cache hits** | **206,368 tokens cached (56.3% hit rate)** — 2,400-token system/tool header cached on every scope + 65,920-token hit on tool-call follow-up |
| **Total output tokens** | 127,055 tokens (thinking + tool calls + structured JSON) |
| **Decode throughput range** | **125.3 – 245.2 tok/s** (median **~173 tok/s**, **3.3 – 7.0 tok/cycle** DFlash2 acceptance) |
| **Structured output success** | **19 / 20 scopes** on first pass (1 deterministic naming fallback) |
| **LLM wall-clock duration** | **15 min 07 s** (`13:16:42` → `13:31:49`) |

---

## 7. Dense 27B Benchmarks (`Dirk-Qwen3.8-27B-MLX-oQ4e` & `Qwen3.8-27B-oQ4e-mtp`)

### Checkpoint & Community Update Status (Verified 2026-10-15)

- **`peculiar-ragdoll/Dirk-Qwen3.8-27B-MLX-oQ4e`**: Local checkpoint matches HF `main` (`sha: 17bdf113...`, last modified `2026-09-10`). No newer Dirk 27B oQ4e revision exists upstream.
- **`Jundot/Qwen3.8-27B-oQ4e-mtp`**: Local checkpoint matches HF `main` (`sha: 49c1d603...`, last modified `2026-10-12`). All files identical.
- **`omlx.ai` community optimal settings (`ga7gloxj` / `7jkq3hk3`)**: Community entries on M5 Max 64 GB switched from `turboquant_kv_enabled: true` + `mtp_fixed_depth: 3` to **raw KV (`turboquant_kv_enabled: false`) + `mtp_adaptive_max_depth: 4` + `qwen35_oq_a8_enabled: true`** (`1,376.8 PP / 63.9 TG t/s` on `code_python` @4k; `997.1 PP / 98.5 TG t/s` on `code_mixed`).
- **Splash DFlash2 Drafter**: Downloaded `incoai/Qwen3.8-27B-DFlash2` to `/Users/highlands/.lmstudio/models/incoai/Qwen3.8-27B-DFlash2`. Splash calibrated ANE FFN offload (`ane_ffn: state=split, share=0.32, minimum_rows=1589, 21.0 ms vs 25.8 ms GPU alone`).

### Why `VLMBatchedEngine` (`override=null`) Beats Both `BatchedEngine` (`override="llm"`) and Splash on Dense 27B `oQ4e`

On dense `qwen3_5` (Qwen3.8-27B), `VLMBatchedEngine` (`engine/vlm.py`) compiles **`qwen35_packed_linear` (`Qwen packed 4-bit projections: 296 layers`)** and enables `oQ A8` prefill across **1,266 modules** (versus 0 packed projections and only 986 `oQ A8` modules on `BatchedEngine` when `model_type_override: "llm"` was set on Dirk), alongside `qwen35_gdn_prework` and `qwen35_verify_sdpa_split`. Removing `model_type_override: "llm"` from `Dirk-Qwen3.8-27B-MLX-oQ4e` reduced its 64-layer backbone verify step from **64.4–74.7 ms/cycle** to **41.3–46.7 ms/cycle** (+72%–85% decode, +58% prefill). Conversely, Splash 1.3.2 is slower than `VLMBatchedEngine` on mixed-bit `oQ4e` dense 27B checkpoints and uses ~8.5 GB more RAM.

| Model & Engine Configuration | Prefill @ 1k / 4k | Decode @ 1k / 4k (`thinking=off`, 128t) | Decode @ 1k / 4k (`thinking=on`, 256t) | Batch x2 / x4 TG @ 1k | Memory (Actual / Planned) | Verdict |
|---|---:|---:|---:|---:|---:|---|
| **`Qwen3.8-27B-oQ4e-mtp` + MLX (`VLMBatchedEngine`, `override=null`)** | **960.8 / 1,183.2 t/s** (1,376.8 raw bench) | **65.7 / 63.9 t/s** (15.3–15.8 ms TPOT) | **68.8 / 58.8 t/s** (14.6–17.1 ms TPOT) | — | **16.76 GB** | **Best 27B config (applied)** |
| **`Dirk-Qwen3.8-27B-MLX-oQ4e` + MLX (`VLMBatchedEngine`, `override=null`)** | **977.6 / 1,216.0 t/s** | **59.8 / 60.4 t/s** (16.7–16.8 ms TPOT) | **51.9 / 62.5 t/s** (16.1–19.4 ms TPOT) | — | **16.15 GB** | **Best Dirk config (applied; +72–85% over `llm` override)** |
| `Dirk-Qwen3.8-27B-MLX-oQ4e` + MLX (`BatchedEngine`, `override="llm"` — old setting) | 617.9 / 776.7 t/s | 38.1 / 35.0 t/s (26.5–28.8 ms TPOT) | 34.6 / 33.7 t/s (29.0–29.8 ms TPOT) | — | 15.16 GB | Missing `qwen35_packed_linear` (296 layers) & VLM Metal patches |
| `Dirk-Qwen3.8-27B-MLX-oQ4e` + **Splash 1.3.2** (`DFlash2` + `ane_ffn` 0.32) | 639.8 / 756.5 t/s | 45.1 (40t) / 69.5 t/s | — | 88.5 (76t) / 214.3 t/s (336t) | 24.75 GB | Slower prefill & higher memory than MLX `VLMBatchedEngine` |
| `Qwen3.8-27B-oQ4e-mtp` + **Splash 1.3.2** (`DFlash2` + `ane_ffn` 0.32) | 580.6 / 603.5 t/s | 51.1 / 36.4 t/s (19.7–27.7 ms TPOT) | — | 87.7 (256t) / 174.1 t/s (512t) | 25.08 / 26.93 GB | Slower prefill & decode than MLX `VLMBatchedEngine` |

---

## 8. Long-Context 65,536 (64k) Benchmarks (`code_python`, Local-Only / Upload Skipped)

Run via `POST /admin/api/bench/start` with `prompt_lengths: [65536]`, `context_profile: "code_python"`, `warmup_mode: "ane_2048"`, and `align_prompt_to_ane: true` on MLX (`skipped_reason: "ane_aligned_prompt"`, `pp=65537` → exact `65,536` prefill rows = `32 x 2,048` blocks) or `skipped_reason: "splash"` on Splash. Zero rows were uploaded to `omlx.ai`.

| Model & Engine Configuration | 64k Prefill t/s (TTFT) | 64k Decode TG t/s (TPOT) | Backbone Cycle @ 64k | Reserved KV @ 64k | Peak Memory | Notes |
|---|---:|---:|---:|---:|---:|---|
| **`occamy-1.0-oQ4e-mtp` + Splash** (int8 KV, DFlash2) | **3,171.9 t/s** (20.66s) | **157.9 t/s** real @66k (106.0 t/s bench, 31t EOS) | 4.8 tok/cycle (DFlash2) | ~0.67 GB (int8) | **21.92 GB** | Fastest 64k prefill & real 66k–77k agentic decode (`139–158 t/s`) |
| **`Tiel-Coder-35B-A3B-MLX-oQ4e-MTP` + MLX** (`VLMBatchedEngine`, raw KV) | **3,021.8 t/s** (21.69s) | **123.4 t/s** (8.17 ms) | **18.4 ms/cycle** (50c, 86.4% accept, 0 copy) | +1.22 GB (10 KV layers) | 23.47 GB | Fastest raw-token 64k MLX decode |
| `occamy-1.0-oQ4e-mtp` + MLX (`BatchedEngine`, raw KV) | 2,586.2 t/s (25.34s) | 96.4 t/s (10.45 ms) | 25.6 ms/cycle (48c, 84.8% accept, 0 copy) | +1.22 GB (10 KV layers) | 22.72 GB | Missing `VLMBatchedEngine` Metal patches |
| **`Qwen3.8-27B-oQ4e-mtp` + MLX** (`VLMBatchedEngine`, **raw KV**) | 661.6 t/s (99.06s) | **37.8 t/s** (26.69 ms) | **88.2 ms/cycle** (36c, 89.1% accept, 0 copy) | +3.89 GB (16 KV layers) | 23.40 GB | Native fused `verify_sdpa_split` beats TQ8 on decode |
| `Qwen3.8-27B-oQ4e-mtp` + MLX (`VLMBatchedEngine`, **TQ8 8-bit KV**) | **720.3 t/s** (90.99s) | 35.5 t/s (28.36 ms) | 103.9 ms/cycle (33c, 89.4% accept, 0 copy) | +3.89 GB prefill → 8-bit post-prefill | 23.34 GB | oMLX converts 15/16 KV layers to 8-bit *after* prefill (`server.log:3781`); dequant slows verify by 18% |
| `Dirk-Qwen3.8-27B-MLX-oQ4e` + MLX (`VLMBatchedEngine`, raw KV) | 614.8 t/s (106.59s) | 33.3 t/s (30.27 ms) | 95.4 ms/cycle (38c, 84.5% accept, 1 copy) | +3.89 GB (16 KV layers) | 23.40 GB | Same 16-KV-layer 27B dense scaling |

---

## 9. Projection for 80k Context (`81,920` tokens) @ 128k Window & Final Model Selection

Derived from measured scaling across `1k → 4k → 32k → 64k (65,536) → 77k (77,160 real CodeBoarding run) → 131k (131,072)` and per-chunk marginal prefill logs (`server.log` chunk 32 @ 64k and chunk 40 @ 80k):

| Model & Optimal Engine | Cold 80k Prefill (TTFT) | Agentic Turn TTFT @ 80k (`76k cached + 4k delta`) | Steady-State 80k Decode TG (TPOT) | 80k KV Cache Size | Total Memory @ 80k | Recommendation @ 80k Agentic |
|---|---:|---:|---:|---:|---:|---|
| **`occamy-1.0-oQ4e-mtp` + Splash** (`int8` KV, `DFlash2`) | **~2,850 t/s (~28.7 s)** | **~1.5 – 3.0 s** | **~135 – 145 tok/s** (~7.0 ms; measured **139.3 t/s** @ 77.2k) | **~0.83 GB** (int8) | **~22.1 GB** | **#1 Choice for long-turn agentic & CodeBoarding** |
| **`Tiel-Coder-35B-A3B` + MLX** (`VLMBatchedEngine`, raw KV) | **~2,700 t/s (~30.3 s)** | **~2.5 s** (`1.25 s` per 2k chunk @ 80k) | **~110 – 115 tok/s** (~8.9 ms; `~20.8 ms/cycle`) | +1.53 GB (bf16) | **~23.9 GB** | **#2 Choice (fastest pure MLX @ 80k; pass `terse=false` for pipelines)** |
| `occamy-1.0-oQ4e-mtp` + MLX (`BatchedEngine`, raw KV) | ~2,350 t/s (~34.8 s) | ~2.6 s | ~85 – 90 tok/s (~11.4 ms; `~28.5 ms/cycle`) | +1.53 GB (bf16) | ~23.1 GB | Use Splash instead (`+55%` faster decode @ 80k) |
| **`Qwen3.8-27B-oQ4e-mtp` + MLX** (`VLMBatchedEngine`, raw KV) | ~610 t/s (~134 s / 2m14s) | ~8.8 s (`4.4 s` per 2k chunk @ 80k) | **~31 – 33 tok/s** (~31 ms; `~102 ms/cycle`) | **+4.86 GB** (bf16) | **~24.6 GB** | Too slow above 32k; use only for short/medium (<16k) turns |
| `Dirk-Qwen3.8-27B-MLX-oQ4e` + MLX (`VLMBatchedEngine`, raw KV) | ~570 t/s (~143 s / 2m23s) | ~9.0 s | ~28 – 30 tok/s (~34 ms; `~110 ms/cycle`) | **+4.86 GB** (bf16) | **~24.6 GB** | Too slow above 32k; use only for short/medium (<16k) turns |

---

## 10. Continuous Batching (2–4 Concurrent Requests: GEMV → GEMM) & Agent Configuration

### Why 2+ Requests Increase Throughput

Single-request decode reads all active weights from unified memory to process one row (`[1, D] x [D, H]`), leaving the M5 Max's 40 GPU cores memory-bandwidth-bound. With `B` concurrent requests (and `K` speculative draft tokens per sequence), the engine batches them into a `[B x K, D] x [D, H]` matrix-matrix multiply (`routed_verify_window` in MLX, `decode_b2..b4` in Splash), reading each weight tensor once from RAM for all `B` requests:

```
1 Request  (GEMV, bandwidth-bound):  [1 x K, D] x [D, H] -> 169 - 194 tok/s
2 Requests (GEMM, shared weights):   [2 x K, D] x [D, H] -> 210 - 278 tok/s (1.55x on Splash)
4 Requests (GEMM, sweet spot):       [4 x K, D] x [D, H] -> 403 - 449 tok/s (2.30x - 2.51x)
```

### Server Configuration (Per-Model Profile vs Global `settings.json`)

| Layer & File | Setting | Previous Value | Updated Value | Effect on Batching |
|---|---|---:|---:|---|
| **Global MLX Scheduler** (`~/.omlx/settings.json`) | `scheduler.max_concurrent_requests` | `2` (capped MLX at x2) | **`4`** (applied & server restarted) | Unlocks **4-way batched GEMM + Lightning MTP** (`445.8 tok/s` on Tiel, `402.7 tok/s` on Occamy MLX, `214.3 tok/s` on Dirk 27B) |
| **Splash Engine** (`occamy-oq4e-optimal-20261015`) | `maximum_batch_width` (`decode_b1..b4`) | `4` (built-in) | **`4`** (`external_engine: "splash"`) | Native 4-lane DFlash2 batching (**`278.2 tok/s` at x2**, **`448.7 tok/s` at x4**) |
| **Per-Model Profiles** (`~/.omlx/model_profiles.json`) | `mtp_enabled: true`, `mtp_adaptive_max_depth: 3..4` | Enabled | **Enabled** | Activates `Lightning MTP batch` (`routed_verify_window`) on `Tiel`, `Qwen3.8-27B`, and `Dirk` |

### How Any Agent or Pipeline Knows to Send 2–4 Concurrent Requests

A standard agent loop is sequential (`1 LLM call -> tool -> 1 LLM call`), so oMLX only sees 2–4 concurrent requests when the client harness, subagent prompt rule, or pipeline worker pool explicitly fans out 2–4 calls in parallel:

```
Sequential Agent (Default -> Batch x1, ~175 tok/s):
  Agent ──► [LLM Call 1] ──► [Tool] ──► [LLM Call 2] ──► [Tool]

Parallel Fan-Out (Subagents or Worker Pool -> Batch x4, ~445 tok/s):
            ┌──► [Subagent / Scope 1] ──┐
  Orchestr. ├──► [Subagent / Scope 2] ──┼──► oMLX (:8000, batches 4 in 1 GEMM pass)
            ├──► [Subagent / Scope 3] ──┤
            └──► [Subagent / Scope 4] ──┘
```

| Workload Type | Why It Defaults to `1` | How to Make It Request `2–4` Concurrently |
|---|---|---|
| **Interactive Coding Agents** (Devin, Dirac, Pi, OpenCode, Goose) | One main conversation turn waits on the previous tool result before calling the LLM again | Add a standing rule to global `AGENTS.md`: *"When decomposing independent module searches, reviews, or test generation on local oMLX, spawn 2–4 parallel subagents at a time (cap at 4)."* |
| **Repo / Doc / Eval Pipelines** (CodeBoarding, custom Python/Go pipelines) | Often default to sequential loops or a conservative concurrency limit to avoid cloud API rate limits | Set the pipeline's worker pool / semaphore to `4` (e.g. `asyncio.Semaphore(4)` or `ThreadPoolExecutor(max_workers=4)`), matching `scheduler.max_concurrent_requests = 4` |
| **Multi-Window / Multi-Repo Dev** | A single terminal only has one active prompt | Run 2–4 agent sessions simultaneously across worktrees/repos pointed at `127.0.0.1:8000` — oMLX automatically merges their decode steps into one batched GEMM pass |

### Context-Length Rule of Thumb for Batching on 64 GB RAM

| Context per Request | Safe Concurrent Requests (`Occamy` + Splash int8 KV) | Safe Concurrent Requests (`Tiel` + MLX raw KV) |
|---|---:|---:|
| **<= 16k tokens** | **4** (`448.7 tok/s` agg) | **4** (`445.8 tok/s` agg) |
| **32k – 64k tokens** | **2 – 4** (`~0.67 GB` KV per stream) | **2** (`~1.22 GB` KV per stream) |
| **80k+ tokens** | **1 – 2** (`~0.83 GB` KV + `63 MiB` GDN state per stream) | **1 – 2** (`~1.53 GB` KV per stream) |





