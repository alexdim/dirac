# Snippet to Append to Global `AGENTS.md`

Paste the block below under `## Model preferences` in `~/.config/devin/AGENTS.md` (and any other agent global rules files such as `~/.pi/agent/AGENTS.md` or `~/.config/opencode/AGENTS.md`):

```markdown
## Local oMLX model routing and continuous batching

- Primary local models on `http://127.0.0.1:8000/v1` (M5 Max 64 GB, `scheduler.max_concurrent_requests = 4`):
  - Long-context agentic, architecture, and structured-extraction workloads (up to 128k): use `occamy-1.0-oQ4e-mtp` (served via Splash 1.3.2 with DFlash2 + int8 KV, profile `occamy-oq4e-optimal-20261015`).
  - Interactive coding and sub-64k code generation on pure MLX: use `Tiel-Coder-35B-A3B-MLX-oQ4e-MTP` (`VLMBatchedEngine`, profile `tiel-oq4e-optimal-20261013`); pass `chat_template_kwargs: {"terse": false}` in automated extraction pipelines to prevent clarifying-question refusals on truncated snippets.
  - Dense 27B tasks under 16k–32k context: use `Qwen3.8-27B-oQ4e-mtp` or `Dirk-Qwen3.8-27B-MLX-oQ4e` (`VLMBatchedEngine` with `model_type_override: null`, profile `*-optimal-20261015`); do not use 27B dense models above 32k context.
- Never set `model_type_override: "llm"` on Qwen3.5/3.6/3.8 VLM-packaged checkpoints in oMLX `0.7.1.dev2`; keeping them on `VLMBatchedEngine` is required to activate `qwen35_moe_routed_decode`, `qwen35_packed_linear`, `qwen35_gdn_prework`, and `qwen35_verify_sdpa_split`.
- To exploit GEMM continuous batching (`2.3x–2.5x` aggregate throughput over single-request GEMV), fan out independent exploration, file-analysis, review, or test-generation tasks into parallel subagents or worker pools capped by prompt context length:
  - `<= 16k` tokens per request: fan out **4** concurrent requests/subagents (`~445–449 tok/s` aggregate).
  - `32k – 64k` tokens per request: fan out **2–4** concurrent requests on `Occamy` + Splash (int8 KV) or **2** on `Tiel` + MLX (raw KV).
  - `80k+` tokens per request: cap at **1–2** concurrent requests to preserve KV and GDN recurrent-state memory headroom.
```
