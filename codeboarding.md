Copy and paste this ultra-explicit prompt directly into your AI coding agent (Cursor, Claude Code, or Windsurf):

***

> **Prompt:**
>
> You are setting up **CodeBoarding** (`https://www.codeboarding.org/`) permanently on my macOS (Zsh) machine for strict client privacy, and running an initial architecture analysis on this Bitbucket repository. 
>
> Do NOT use temporary session-only `export` commands for configuration. Follow these exact steps sequentially and verify each step before moving to the next:
>
> ### Step 1: Install Latest Prerequisites via Homebrew (`node`, `python@3.12`, `pipx`)
> CodeBoarding requires Python 3.12 (`>=3.12,<3.13`) and Node.js (with bundled `npm`) so `codeboarding-setup` doesn't have to download a heavy fallback Node runtime.
> 1. Check if Homebrew has the latest `node`, `python@3.12`, and `pipx` installed.
> 2. Run:
>    ```bash
>    brew update && brew install node python@3.12 pipx
>    brew upgrade node python@3.12 pipx || true
>    pipx ensurepath
>    ```
> 3. Locate the Homebrew prefix with `brew --prefix python@3.12`, then verify `node -v`, `npm -v`, and `<BREW_PYTHON312_PREFIX>/bin/python3.12 --version` are working (avoid `$(...)` subshells).
>
> ### Step 2: Permanently Disable All Telemetry in `~/.zshrc`
> CodeBoarding sends operational telemetry to PostHog by default. Disable this permanently across all Zsh sessions:
> 1. Inspect `~/.zshrc`. If `DO_NOT_TRACK=1` and `CODEBOARDING_TELEMETRY=false` are not already present, append them:
>    ```bash
>    grep -qxF 'export DO_NOT_TRACK=1' ~/.zshrc || echo 'export DO_NOT_TRACK=1' >> ~/.zshrc
>    grep -qxF 'export CODEBOARDING_TELEMETRY=false' ~/.zshrc || echo 'export CODEBOARDING_TELEMETRY=false' >> ~/.zshrc
>    ```
> 2. Ensure `~/.local/bin` (used by `pipx`) is in `~/.zshrc` `PATH`.
>
> ### Step 3: Install the Latest CodeBoarding CLI Globally via `pipx` & Run Setup
> Install CodeBoarding from PyPI into an isolated global `pipx` environment using Python 3.12 so I never need to create a `.venv` inside client repositories:
> 1. Run (replacing `<BREW_PYTHON312_BIN>` with the path from Step 1, e.g. `/opt/homebrew/opt/python@3.12/bin/python3.12`):
>    ```bash
>    pipx install codeboarding --python /opt/homebrew/opt/python@3.12/bin/python3.12 --force
>    ```
> 2. Run the language server installer (with telemetry disabled inline):
>    ```bash
>    DO_NOT_TRACK=1 CODEBOARDING_TELEMETRY=false ~/.local/bin/codeboarding-setup
>    ```
>    *(This downloads the static analysis LSP binaries into `~/.codeboarding/servers/` and initializes `~/.codeboarding/config.toml`).*
>
> ### Step 4: Configure Provider via macOS Keychain + `~/.codeboarding/config.toml`
> Do NOT ask me to paste my API key into chat, do NOT read my `.env` file, and do NOT write the key to `config.toml`. The Google API key already lives in macOS Keychain as service `timologia`, account `api_key_gemini` — first verify it exists and is a real `AIza…` key (`security find-generic-password -s timologia -a api_key_gemini -w | awk '{print length($0), substr($0,1,4)}'` should print `39 AIza`). If it is missing, ask me to run `security add-generic-password -a "$USER" -s timologia -a api_key_gemini -T /usr/bin/security` myself (hidden prompt, no history leak).
> 1. Append a guarded export to `~/.zshrc` so every interactive shell injects it from Keychain:
>    ```bash
>    grep -qxF 'export GOOGLE_API_KEY="$(security find-generic-password -s timologia -a api_key_gemini -w 2>/dev/null)"' ~/.zshrc || echo 'export GOOGLE_API_KEY="$(security find-generic-password -s timologia -a api_key_gemini -w 2>/dev/null)"' >> ~/.zshrc
>    ```
> 2. Ask me only for non-secret settings (**provider type**, **base URL** if custom, **model ID**), then write `~/.codeboarding/config.toml` with NO provider secrets — env vars take precedence over the file anyway:
>    ```toml
>    [provider]
>    # GOOGLE_API_KEY is supplied by macOS Keychain via ~/.zshrc — never store it here.
>    # non-secret endpoint overrides may live here, e.g.:
>    # openai_base_url = "http://localhost:8000/v1"
>
>    [llm]
>    agent_model = "<MY_MODEL_ID>"
>    ```
> 3. Lock permissions: `chmod 600 ~/.codeboarding/config.toml`
>
> ### Step 5: Hide CodeBoarding Output from Bitbucket Git Tracking
> Ensure the generated `.codeboarding/` directory and `codeboarding.md` are ignored locally without modifying the client's tracked `.gitignore` file:
> ```bash
> mkdir -p .git/info
> grep -qxF '.codeboarding/' .git/info/exclude || echo '.codeboarding/' >> .git/info/exclude
> grep -qxF 'codeboarding.md' .git/info/exclude || echo 'codeboarding.md' >> .git/info/exclude
> ```
>
> ### Step 6: Run Full Local Analysis + Local Markdown/Mermaid Rendering
> Execute the analysis on the current repository using `--local .` and `--render md` while unsetting any ambient shell LLM provider variables EXCEPT the chosen provider's (which otherwise take precedence and trigger `LLMConfigError: Multiple LLM providers selected`). `GOOGLE_API_KEY` must reach the process — in an interactive Zsh it comes from Keychain via `~/.zshrc`; in non-interactive shells export it first with `export GOOGLE_API_KEY="$(security find-generic-password -s timologia -a api_key_gemini -w)"`:
> ```bash
> env -u OPENAI_API_KEY -u OPENAI_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u VERCEL_API_KEY -u AWS_BEARER_TOKEN_BEDROCK -u CEREBRAS_API_KEY -u DEEPSEEK_API_KEY -u GLM_API_KEY -u KIMI_API_KEY -u OLLAMA_BASE_URL -u OLLAMA_HOST -u OLLAMA_API_KEY -u OPENROUTER_API_KEY -u ORCAROUTER_API_KEY -u REQUESTY_API_KEY -u LITELLM_API_KEY -u LITELLM_BASE_URL -u AGENT_MODEL DO_NOT_TRACK=1 CODEBOARDING_TELEMETRY=false ~/.local/bin/codeboarding full --local . --render md
> ```
>
> ### Step 7: Disable IDE Extension Telemetry & Verify Output
> 1. If VS Code or Cursor user `settings.json` exists on my machine, add `"codeboarding.telemetry.enabled": false` to it so the IDE extension also respects strict client privacy.
> 2. Verify that `.codeboarding/analysis.json` and the rendered `.md` files exist in `.codeboarding/`, and give me a quick summary of the generated files.
