# Dirac ACP Registry Entry

This directory contains Dirac's metadata and icon for the [Agent Client Protocol (ACP) Registry](https://github.com/agentclientprotocol/registry). Registry clients include JetBrains IDEs, Zed, and other ACP-compatible editors.

## Install Dirac from the registry

### JetBrains IDEs

JetBrains IDE 2025.3 or later is required for ACP Registry support. Open **Settings → Tools → AI Assistant → Agents**, or select **Install From ACP Registry…** in the agent picker. Find Dirac and select **Install**.

### Zed

Open **Agent Settings → External Agents**, select **Add Agent → Install from Registry**, and install Dirac.

After installation, start a Dirac thread and choose an authentication method. **Configure a Dirac provider** accepts a provider, model, and API key, including DeepSeek credentials. **Sign in with ChatGPT** is an optional alternative, not a requirement.

Dirac owns its provider configuration independently of the ACP client. Provider credentials configured for the editor's native AI features do not automatically configure Dirac.

## Manual installation

Install the CLI:

```bash
npm install -g dirac-cli
```

Then add an equivalent server entry to the editor's custom ACP configuration:

```json
{
  "command": "dirac",
  "args": ["--acp"]
}
```

The surrounding configuration shape varies by client. Use the executable's absolute path if the editor cannot resolve `dirac` from `PATH`.

You can also configure a provider before starting the editor with `dirac auth`, or supply `DIRAC_PROVIDER`, `DIRAC_MODEL`, `DIRAC_API_KEY`, and optional `DIRAC_BASE_URL` to the ACP process.

## Registry files

- `dirac/agent.json`: Agent metadata and launch command.
- `dirac/icon.svg`: Dirac icon.

When releasing ACP changes, keep the published `dirac-cli` version, this metadata, and the upstream registry entry synchronized. Follow the upstream registry's current `CONTRIBUTING.md` when submitting an update.
