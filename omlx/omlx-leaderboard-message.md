Subject: Request to remove 20 non-canonical code_mixed benchmark rows + 8 findings from server.log

Hi jundot,

While benchmarking `occamy-1.0-oQ4e-mtp` and `Tiel-Coder-35B-A3B-MLX-oQ4e-MTP`
on oMLX 0.7.1.dev1/dev2 (Apple M5 Max, 64 GB, 40 GPU cores), I ran five
exploratory `code_mixed` matrices (`[1024, 8192, 32768, 131072]`, `gen=128` and
`gen=512`) before running the canonical `code_python` `[1024, 4096]` `gen=128`
matrix. All 24 MLX rows auto-uploaded; the Splash and `align_prompt_to_ane`
runs were properly skipped.

Could you remove the 20 non-canonical `code_mixed` rows below and keep only the
4 canonical `code_python` rows?

Owner hash: `dd59c5a4ad19a6d5e0c5fc4762b675cf85f40c8666fe1a79ddf09f1728a39d7b`

### Keep (4 canonical `code_python` rows, `gen=128`, pre-warmed, dev2)

| Model | Context | ID | PP t/s | TG t/s | Batch x2 / x4 TG t/s |
|---|---:|---|---:|---:|---:|
| `occamy-1.0-oQ4e-mtp` | 1,024 | `opz8wttu` | 4,426.5 | 168.9 | 178.0 / 402.7 |
| `occamy-1.0-oQ4e-mtp` | 4,096 | `5w1pwc51` | 6,001.7 | 150.6 | — |
| `Tiel-Coder-35B-A3B-MLX-oQ4e-MTP` | 1,024 | `fqih5u80` | 4,219.5 | 194.2 | 210.3 / 445.8 |
| `Tiel-Coder-35B-A3B-MLX-oQ4e-MTP` | 4,096 | `fppmnp3q` | 5,872.6 | 167.2 | — |

### Remove (20 non-canonical `code_mixed` rows)

| ID | Model | Version | Context | Reported PP / TG t/s | Root cause in `server.log` |
|---|---|---|---:|---|---|
| `4xw0ihae` | Tiel | dev1 | 8,192 | 5,896 / **303.1** | MTP prefix-copy artifact (`copy=359/366`, `tok/cycle=4.83` > depth-3 max of 4.0) |
| `cpztrsr1` | Tiel | dev2 | 8,192 | 5,723 / **312.1** | MTP prefix-copy artifact (`copy=386/401`, `tok/cycle=5.95` > depth-3 max of 4.0) |
| `vxamu9hg` | Tiel | dev1 | 32,768 | 4,373 / **202.7** | MTP prefix-copy artifact (`copy=259/319`, `tok/cycle=4.34` > depth-3 max of 4.0) |
| `28d8kn7u` | Tiel | dev1 | 131,072 | 1,958 / **166.1** | MTP prefix-copy artifact (`copy=352/364`, `tok/cycle=5.22` > depth-3 max of 4.0) |
| `22zcsl6k` | Tiel | dev2 | 131,072 | 1,916 / **168.8** | MTP prefix-copy artifact (`copy=358/371`, `tok/cycle=5.45` > depth-3 max of 4.0) |
| `k8hnsq2l` | Occamy | dev2 | 1,024 | **568.0** / 150.8 | Cold-start JIT compile on 1,023-token prefill (`model_cache_ms=1703.8ms`, TTFT 1.80s) |
| `e6d4g4ly` | Occamy | dev2 | 8,192 | **3,301.9** / **103.7** | Cold-start NAX QMM compile on first 2,048 chunk (`1182ms` vs `337ms`) + early EOS (`416/512` tokens) |
| `aa618ont` | Tiel | dev2 | 1,024 | **2,771.7** / **120.2** | Cold-start `verify_sdpa_split` compile for `q_len in {2,3,7,8}` mid-decode |
| `46w1gchc` | Occamy | dev1 | 1,024 | **3,586.0** / 171.2 | Cold-start first 1,023-token prefill after server start (`gen=128` on `code_mixed`) |
| `g4gcsba2` | Occamy | dev1 | 8,192 | 5,795 / **123.5** | Early EOS truncation (`finish=stop tokens=148/512`) |
| `7178bmsa` | Occamy | dev2 | 32,768 | 4,083 / **149.3** | Early EOS truncation (`finish=stop tokens=425/512`) + `copy=115/119` |
| `52piky80` | Occamy | dev1 | 8,192 | 5,454 / 106.2 | Off-matrix `code_mixed` (`gen=128`, 53.1% draft acceptance sample noise) |
| `kieay8lg` | Occamy | dev1 | 32,768 | 4,109 / 117.2 | Off-matrix `code_mixed` (`gen=128`) |
| `qw76htl3` | Occamy | dev1 | 131,072 | 1,918 / 67.9 | Off-matrix `code_mixed` (`gen=128`) |
| `2q8yz4uw` | Occamy | dev1 | 1,024 | 4,291 / 162.7 | Off-matrix `code_mixed` (`gen=512`) |
| `y8tvyb63` | Occamy | dev1 | 32,768 | 4,373 / 132.9 | Off-matrix `code_mixed` (`gen=512`, `copy=55/63`) |
| `xxkdty2g` | Occamy | dev1 | 131,072 | 1,924 / 69.6 | Off-matrix `code_mixed` (`gen=512`, `copy=92/156`) |
| `22pw7uzk` | Occamy | dev2 | 131,072 | 1,882 / 69.8 | Off-matrix `code_mixed` (`gen=512`, `copy=87/160`) |
| `fip4d8mb` | Tiel | dev1 | 1,024 | 4,287 / 208.8 | Off-matrix `code_mixed` (`gen=512`, `copy=65/91`) |
| `disarmua` | Tiel | dev2 | 32,768 | 4,276 / 192.3 | Off-matrix `code_mixed` (`gen=512`, `copy=104/126`) |

*(Note: 20 rows in the table above + 4 canonical rows = 24 total uploads under this `owner_hash`.)*

### Eight technical findings from `server.log` and `splash.log` (`0.7.1.dev2`)

1. **`BatchedEngine` (`mlx-lm`) vs `VLMBatchedEngine` (`mlx-vlm`) kernel parity on `qwen3_5_moe` and dense `qwen3_5`**:
   - **On 35B MoE (`qwen3_5_moe`)**: `occamy-1.0-oQ4e-mtp` (text-only `qwen3_5_moe_text`, no `vision_config`) loads into `BatchedEngine`, whereas `Tiel-Coder-35B-A3B-MLX-oQ4e-MTP` (which keeps `vision_config`) loads into `VLMBatchedEngine`. In `0.7.1.dev2`, four patches are wired in `engine/vlm.py:2630-2720` but not in `engine/batched.py`: `qwen35_moe_routed_decode`, `qwen35_gdn_prework` (`qwen35_gdn_verify_fused`), `qwen35_verify_sdpa_split`, and `qwen35_gdn_chunked`. Identical 40-layer `qwen3_5_moe` oQ4e weights run at **11.0–12.2 ms/backbone-cycle** (@4k) and **18.4 ms/cycle** (@64k) on `VLMBatchedEngine` vs **16.5–19.5 ms/cycle** (@4k) and **25.6 ms/cycle** (@64k) on `BatchedEngine`.
   - **On 27B Dense (`qwen3_5`)**: Setting `model_type_override: "llm"` (`BatchedEngine`) on `Dirk-Qwen3.8-27B-MLX-oQ4e` also loses `qwen35_packed_linear` (`Qwen packed 4-bit projections: 296 layers`), drops `qwen35_oq_a8` coverage from 1,266 modules to 986 modules, and loses `qwen35_verify_sdpa_split` + `qwen35_gdn_prework`. Clearing `model_type_override` to `null` (`VLMBatchedEngine`) boosted Dirk from **33.7–38.1 t/s** to **59.8–62.5 t/s** decode (+72–85%) and from **618–777 t/s** to **978–1,216 t/s** prefill (+58%).
2. **`TurboQuant` 8-bit KV at 64k (`pp=65537`) allocates raw 16-bit KV during prefill and slows verify by 18%**:
   On `Qwen3.8-27B-oQ4e-mtp` at 65,537 tokens with `turboquant_kv_enabled: true (8.0 bits)`, the scheduler still reserves full 16-bit KV capacity during prefill (`Reserved prefill capacity for 65537 tokens across 16 caches (+3.89GB)`, peak `23.34 GB` vs `23.40 GB` raw) and only converts 15/16 KV layers to 8-bit *after* prefill completes (`TurboQuant: converted 15/64 cache layers to 8.0-bit`). During 64k decode, `turboquant_attention` bypasses the native fused `verify_sdpa_split` kernel and dequantizes on the fly, increasing backbone verify time from **88.2 ms/cycle** (`37.8 t/s` on raw KV) to **103.9 ms/cycle** (`35.5 t/s` on TQ8).
3. **`SplashEngine` (`splash_has_vision`) ignores `model_type_override == "llm"`**:
   `splash_has_vision(config)` in `engine/splash.py:289` checks `isinstance(config.get("vision_config"), dict)` on raw `config.json` without checking `model_settings.model_type_override == "llm"`. As a result, VLM checkpoints used strictly as text models (e.g. Tiel, Dirk, `Qwen3.8-27B-oQ4e-mtp`) never receive `--language-only` when served through Splash.
4. **`SplashEngine._stream()` re-tokenizes every streamed SSE chunk in Python**:
   In `engine/splash.py:1122` and `1219`, requests proxied through `127.0.0.1:8000/v1/chat/completions` run Python `apply_chat_template` in `count_chat_tokens()` before forwarding and call `self._tokenizer.encode(piece)` on every streamed SSE chunk, reducing measured 4k prefill throughput from `5,191–6,764 t/s` (direct Splash loopback) to `4,658–5,005 t/s` (proxied).
5. **Default Splash memory budget (`splash_max_memory_gb = null`) with persistent SSD cache**:
   `splash_memory_estimate()` in `engine/splash.py:403` budgets `weights + draft + 3 GiB + 1 x max_context KV` (`24.04 GiB` on a 64 GB Mac). With `--persistent-cache` enabled, Splash restores up to 19 GDN state checkpoints (`63 MiB` each) and `2,367` KV blocks (`~2.08 GiB`) at startup into a `3.19 GiB` dynamic budget (`dynamic_budget_bytes`), pressuring multi-request and batch runs unless a larger `splash_max_memory_gb` is set.
6. **`warmup_mode="quick"` (32 prompt / 8 decode tokens) misses shape-gated kernels**:
   On a cold process, a 32-token warmup leaves `qwen35_moe_weighted_sum` (`min_tokens=1024`), `qwen35_q4_mlp` NAX dispatch (`min_tokens=2048`), and `qwen35_verify_sdpa_split` (`q_len in {2,3,7,8}`) uncompiled until the first 1k and 2k+ benchmark trials execute.
7. **MTP prefix-copy filtering on leaderboard uploads**:
   At 8k/32k/131k in `code_mixed`, Tiel echoed prompt lines and accepted 259–386 of 512 tokens via the prefix-copy path (`tok/cycle` 4.34–5.95 on depth-3 MTP). Flagging or rejecting uploads where `tok/cycle > mtp_depth + 1` (or where `copy / tokens` exceeds a threshold) would keep copy-path outliers off the decode leaderboard.
8. **`_ChatBenchmark` (Splash) prompt layout with system-prompt templates**:
   `_ChatBenchmark` sends `[{"role": "user", "content": "BENCH-<uuid> ..."}]` with no instruction. Checkpoints whose `chat_template.jinja` prepends a default system prompt (e.g., Tiel's ~175-token `_terse` block) place static tokens before `BENCH-<uuid>`, causing Splash to deduplicate/cache the first 160 tokens (5 x 32-token KV blocks) across trials, and the un-instructed code dump causes early EOS (`31–101/128` tokens). Putting `BENCH-<uuid>` in a leading `system` turn and appending a one-line continuation/analysis prompt eliminated both the 160-token cache hit and early EOS.

Happy to share the full logs if helpful. Thanks for oMLX!

— Alex
