# dsh-llm-volcengine

[![npm version](https://img.shields.io/npm/v/dsh-llm-volcengine.svg?style=flat-square)](https://www.npmjs.com/package/dsh-llm-volcengine)
[![MIT License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

Volcengine Ark **Agent Plan** and **Coding Plan** providers for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness), with verified thinking-effort compatibility.

A [DSH profile bundle](https://www.npmjs.com/package/@deepseek-ai/dsh) that registers two LLM provider routes through a self-contained pi-ai-backed `LlmAdapter`, so model catalogs and compatibility switches reach pi-ai **without depending on the `dsh-llm-pi-ai` settings compat schema**. Thinking levels `low` / `medium` / `high` / `xhigh` / `max` are exposed where the endpoint honors them.

## Why

A hand-declared Volcengine Ark route in `settings.yaml` runs into several gotchas that this bundle resolves once and for all:

| Gotcha | What breaks | This bundle |
|---|---|---|
| Agent Plan must be reached over `openai-responses` at `/api/plan/v3` | The Anthropic-style `/api/plan` path does not expose a thinking-effort control | Uses the community-verified Responses path; `reasoning.effort` maps natively |
| Coding Plan gateway rejects the OpenAI `developer` role (HTTP 400) | Every request with a system prompt fails once reasoning is enabled | `compat.supportsDeveloperRole: false` on every Coding Plan model |
| Coding Plan gateway rejects `store` and needs `max_tokens` (not `max_completion_tokens`) | Mis-shaped requests are 400'd | `compat.supportsStore: false`, `maxTokensField: "max_tokens"` |
| Per-model `maxTokens` differs (DeepSeek 384000, GLM 128000, Kimi 32000, …) | A single cap breaks some models or underuses others | Each model carries its verified cap |
| The gateway's `OutofContextError` wording is not in pi-ai's overflow detection | Long conversations crash instead of auto-compacting | (downstream — see release notes) |

## Install

From the root of a DSH profile (e.g. `~/.dsh/profiles/web`):

```bash
dsh plugin --profile web add dsh-llm-volcengine
```

Then restart DSH (or reload the profile) so the new bundle layer is composed. The two providers appear in the model selectors as:

- `volcengine-plan/<model>`
- `volcengine-coding/<model>`

## Credentials

The bundle resolves an API key by trying each candidate credential reference (left to right) through the DSH credential service, then Ambient environment:

| Route | Tried order (default) |
|---|---|
| `volcengine-plan` | `ARK_AGENT_PLAN_API_KEY`, `VOLCENGINE_ARK_PLAN_API_KEY`, `ARK_CODE_API_KEY` |
| `volcengine-coding` | `ARK_CODING_PLAN_API_KEY`, `VOLCENGINE_CODING_API_KEY`, `HUOSHAN_API_KEY` |

Store a key through the web Models page (it writes the DSH credential store) or `export` the env var. If you already have `ARK_CODE_API_KEY` / `HUOSHAN_API_KEY` configured, the bundles pick them up as fallbacks.

Override the first tried reference per route through the bundle config in `cordis.patch.yml`:

```yaml
- id: llm-volcengine
  name: dsh-llm-volcengine
  config:
    agentPlanApiKeyEnv: ARK_AGENT_PLAN_API_KEY
    codingPlanApiKeyEnv: ARK_CODING_PLAN_API_KEY
    defaultReasoning: high
```

`defaultReasoning` is one of `off | minimal | low | medium | high | xhigh | max` (default: `high`).

## Provider routes

### `volcengine-plan` — Volcengine Ark Agent Plan

- Endpoint: `https://ark.cn-beijing.volces.com/api/plan/v3`
- Protocol: `openai-responses` for most models; `openai-completions` for Kimi K2.6 / K2.7 Code (mixed-api provider)
- `reasoning.effort` maps to the selected thinking level

| Model ID | Context | Max tokens | Input | Thinking tiers |
|---|---|---|---|---|
| `deepseek-v4-pro` | 1.0M | 384000 | text | low·medium·high·xhigh·max |
| `deepseek-v4-flash` | 1.0M | 384000 | text | low·medium·high·xhigh·max |
| `glm-5.2` | 1.0M | 128000 | text | low·medium·high·xhigh·max |
| `glm-5.3` | 1.0M | 128000 | text | low·medium·high·xhigh·max |
| `kimi-k3` | 1.0M | 128000 | text, image | low·high·max |
| `minimax-m2.7` | 200k | 128000 | text | low·medium·high·xhigh·max |
| `minimax-m3` | 512k | 128000 | text, image | low·medium·high·xhigh·max |
| `doubao-seed-2.0-mini` | 256k | 128000 | text, image | low·medium·high·xhigh·max |
| `doubao-seed-2.0-lite` | 256k | 128000 | text, image | low·medium·high·xhigh·max |
| `doubao-seed-2.0-code` | 256k | 128000 | text, image | low·medium·high·xhigh·max |
| `doubao-seed-2.0-pro` | 256k | 128000 | text, image | low·medium·high·xhigh·max |
| `kimi-k2.6` | 256k | 32000 | text, image | off·high |
| `kimi-k2.7-code` | 256k | 32000 | text, image | high |

### `volcengine-coding` — Volcengine Ark Coding Plan

- Endpoint: `https://ark.cn-beijing.volces.com/api/coding/v3`
- Protocol: `openai-completions` with `supportsDeveloperRole: false`, `supportsStore: false`, `supportsStrictMode: false`, `maxTokensField: "max_tokens"`
- DeepSeek/GLM accept `reasoning_effort`; Kimi uses the `qwen` `enable_thinking` toggle; MiniMax/Doubao-seed-code expose no thinking control (reasoning is auto-captured)

| Model ID | Context | Max tokens | Input | Thinking tiers |
|---|---|---|---|---|
| `deepseek-v4-pro` | 1.0M | 384000 | text | low·medium·high·xhigh·max |
| `deepseek-v4-flash` | 1.0M | 384000 | text | low·medium·high·xhigh·max |
| `glm-5.2` | 1.0M | 128000 | text | low·medium·high·xhigh·max |
| `glm-5.3` | 1.0M | 128000 | text | low·medium·high·xhigh·max |
| `kimi-k2.6` | 256k | 32000 | text, image | off·high |
| `kimi-k2.7-code` | 256k | 32000 | text, image | high |
| `minimax-m2.7` | 200k | 128000 | text | — |
| `minimax-m3` | 512k | 128000 | text, image | — |
| `doubao-seed-code` | 256k | 32000 | text, image | — |
| `doubao-seed-2.0-code` | 256k | 65536 | text, image | low·medium·high·xhigh·max |
| `doubao-seed-2.0-pro` | 256k | 128000 | text, image | low·medium·high·xhigh·max |
| `doubao-seed-2.0-lite` | 256k | 128000 | text, image | low·medium·high·xhigh·max |

## How it works

The bundle inserts a single plugin row (`id: llm-volcengine`). On apply it:

1. Builds two pi-ai `Provider` objects directly with `createProvider`, passing the full `compat` block on each `Model`. Because the models are constructed in code (not through `dsh-llm-pi-ai` settings resolution), the compat fields the Coding Plan gateway requires reach pi-ai regardless of the installed `dsh-llm-pi-ai` compat schema.
2. Wraps them in the exported `PiAiAdapter` from `@deepseek-ai/dsh-llm-pi-ai`, which already implements the harness `LlmAdapter` contract (stream/resolveModel/listModels) and thinking-level clamping against each model's `thinkingLevelMap`.
3. Registers the adapter for both routes with `ctx.llm.registerAdapter`, so the providers join the model selectors and request routing like any built-in route.

Agent Plan models share a mixed-api provider (one `createProvider` with an `api` map) so Kimi K2.6/K2.7 Code dispatch to `openai-completions` while the rest use `openai-responses`.

## Acknowledgements

Model catalogs, max output tokens, and compatibility switches are sourced from the community-verified Volcengine Ark provider extensions for [pi](https://pi.dev):

- [`pi-provider-volcengine-agent-plan`](https://pi.dev/packages/pi-provider-volcengine-agent-plan) — the Agent Plan Responses path, tier gating, and Kimi routing decisions.
- [`pi-provider-volcengine-codingplan`](https://www.npmjs.com/package/pi-provider-volcengine-codingplan) — the Coding Plan compat switches and model caps.
- [`pi-provider-volcengine-ark`](https://www.npmjs.com/package/pi-provider-volcengine-ark) — per-model thinking formats for the coding endpoint.

This bundle adapts those compat findings to the DeepSeek Harness LLM seam.

## License

MIT