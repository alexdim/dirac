# System Prompt Integration Tests

These tests protect the two outputs assembled by the system-prompt pipeline:

1. The provider-neutral system prompt string.
2. Provider-native tool definitions.

## Snapshot Coverage

The `__snapshots__/` directory intentionally contains only four files:

- `base.snap` — the complete provider-neutral system prompt.
- `anthropic.tools.snap` — the complete built-in tool set serialized as Anthropic tools.
- `openai.tools.snap` — the complete built-in tool set serialized as OpenAI-compatible function tools.
- `gemini.tools.snap` — the complete built-in tool set serialized as Gemini function declarations.

Provider/model combinations do not get separate prompt snapshots because the prompt is not customized by provider or model. A direct invariance test enforces that contract across Anthropic, OpenAI, Gemini, and Vertex contexts.

Vertex Gemini does not get a duplicate tool snapshot because it uses the Gemini converter. A focused routing test covers that selection.

Focused tests in `spec.test.ts` cover converter behavior such as strict OpenAI schemas, nested constraints, empty parameters, dynamic descriptions, and provider-specific response-tool contracts.

## Running Tests

```bash
npm run test:unit
```

To update snapshots after an intentional prompt or tool-schema change:

```bash
npm run test:unit -- --update-snapshots
# or
UPDATE_SNAPSHOTS=true npm run test:unit
```

Always review snapshot diffs before committing them.
