Subject: Request to remove 20 non-canonical code_mixed benchmark rows + 4 findings from server.log

Hi jundot,

While benchmarking `occamy-1.0-oQ4e-mtp` and `Tiel-Coder-35B-A3B-MLX-oQ4e-MTP`
on oMLX 0.7.1.dev1/dev2 (Apple M5 Max, 64 GB, 40 GPU cores), I ran five
exploratory `code_mixed` matrices (`[1024, 8192, 32768, 131072]`, `gen=128` and
`gen=512`) before running the canonical `code_python` `[1024, 4096]` `gen=128`
matrix. All 24 MLX rows auto-uploaded; the Splash runs were properly skipped by
`skipped_reason="splash"`.

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

### Four technical findings from `server.log` and `splash.log`

1. **`BatchedEngine` (`mlx-lm`) vs `VLMBatchedEngine` (`mlx-vlm`) kernel parity on `qwen3_5_moe`**:
   `occamy-1.0-oQ4e-mtp` (text-only `qwen3_5_moe_text`, no `vision_config`) loads
   into `BatchedEngine`, whereas `Tiel-Coder-35B-A3B-MLX-oQ4e-MTP` (which keeps
   `vision_config`) loads into `VLMBatchedEngine`. In `0.7.1.dev2`, four patches
   are wired in `engine/vlm.py:2630-2720` but not in `engine/batched.py`:
   `qwen35_moe_routed_decode`, `qwen35_gdn_prework` (`qwen35_gdn_verify_fused`),
   `qwen35_verify_sdpa_split`, and `qwen35_gdn_chunked`. Consequently, identical
   40-layer `qwen3_5_moe` oQ4e weights run at **11.0–12.2 ms/backbone-cycle** on
   `VLMBatchedEngine` vs **16.5–19.5 ms/backbone-cycle** on `BatchedEngine`.
2. **`warmup_mode="quick"` (32 prompt / 8 decode tokens) misses shape-gated kernels**:
   On a cold process, a 32-token warmup leaves `qwen35_moe_weighted_sum`
   (`min_tokens=1024`), `qwen35_q4_mlp` NAX dispatch (`min_tokens=2048`), and
   `qwen35_verify_sdpa_split` (`q_len in {2,3,7,8}`) uncompiled until the first
   1k and 2k+ benchmark trials execute.
3. **MTP prefix-copy filtering on leaderboard uploads**:
   At 8k/32k/131k in `code_mixed`, Tiel echoed prompt lines and accepted 259–386
   of 512 tokens via the prefix-copy path (`tok/cycle` 4.34–5.95 on depth-3 MTP).
   Flagging or rejecting uploads where `tok/cycle > mtp_depth + 1` (or where
   `copy / tokens` exceeds a threshold) would keep copy-path outliers off the
   decode leaderboard.
4. **`_ChatBenchmark` (Splash) prompt layout with system-prompt templates**:
   `_ChatBenchmark` sends `[{"role": "user", "content": "BENCH-<uuid> ..."}]`
   with no instruction. Checkpoints whose `chat_template.jinja` prepends a
   default system prompt (e.g., Tiel's ~175-token `_terse` block) place static
   tokens before `BENCH-<uuid>`, causing Splash to deduplicate/cache the first
   160 tokens (5 x 32-token KV blocks) across trials, and the un-instructed
   code dump causes early EOS (`44–101/128` tokens). Putting `BENCH-<uuid>` in a
   leading `system` turn and appending a one-line continuation/analysis prompt
   eliminated both the 160-token cache hit and early EOS in our follow-up runs.

Happy to share the full logs if helpful. Thanks for oMLX!

— Alex
