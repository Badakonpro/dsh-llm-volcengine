# dsh-llm-volcengine

[![npm version](https://img.shields.io/npm/v/dsh-llm-volcengine.svg?style=flat-square)](https://www.npmjs.com/package/dsh-llm-volcengine)
[![MIT License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的火山方舟 **Agent Plan** 与 **Coding Plan** 提供商，思考强度兼容性已实测验证。

一个 [DSH profile bundle](https://www.npmjs.com/package/@deepseek-ai/dsh)，通过自带的 pi-ai `LlmAdapter` 注册两条 LLM 路由，让模型目录与兼容性开关直接进入 pi-ai，**不依赖 `dsh-llm-pi-ai` settings 的 compat schema**。端点支持的档位会暴露 `low` / `medium` / `high` / `xhigh` / `max` 思考强度。

## 为什么需要

在 `settings.yaml` 里手配火山方舟路由会踩几个坑，本 bundle 一次性解决：

| 坑 | 后果 | 本 bundle 的做法 |
|---|---|---|
| Agent Plan 必须用 `openai-responses` 走 `/api/plan/v3` | Anthropic 风格的 `/api/plan` 路径没有思考强度控制 | 走社区验证的 Responses 路径，`reasoning.effort` 原生映射 |
| Coding Plan 网关拒绝 OpenAI 的 `developer` 角色（HTTP 400） | 一旦开启 reasoning，带系统提示词的请求全部失败 | 每个 Coding Plan 模型设 `compat.supportsDeveloperRole: false` |
| Coding Plan 网关拒绝 `store`，且字段名是 `max_tokens` 而非 `max_completion_tokens` | 请求形态不对就被 400 | `compat.supportsStore: false`、`maxTokensField: "max_tokens"` |
| 各模型 `maxTokens` 不同（DeepSeek 384000、GLM 128000、Kimi 32000……） | 一个统一上限会撑爆部分模型或浪费另一些 | 每个模型带各自实测上限 |
| 网关的 `OutofContextError` 文案不在 pi-ai 的溢出检测里 | 长对话溢出时崩溃而非自动压缩重试 | （下游已修正，见发布说明） |

## 安装

在某个 DSH profile 根目录（如 `~/.dsh/profiles/web`）执行：

```bash
dsh plugin --profile web add dsh-llm-volcengine
```

重启 DSH（或重载 profile）让新 bundle 层被组合进来。两个提供商出现在模型选择器中：

- `volcengine-plan/<模型>`
- `volcengine-coding/<模型>`

## 凭据

bundle 依次尝试候选凭据引用（从左到右）通过 DSH 凭据服务解析，再回退到环境变量：

| 路由 | 默认尝试顺序 |
|---|---|
| `volcengine-plan` | `ARK_AGENT_PLAN_API_KEY`、`VOLCENGINE_ARK_PLAN_API_KEY`、`ARK_CODE_API_KEY` |
| `volcengine-coding` | `ARK_CODING_PLAN_API_KEY`、`VOLCENGINE_CODING_API_KEY`、`HUOSHAN_API_KEY` |

在 web 的 Models 页录入 key（写入 DSH 凭据库），或 `export` 环境变量。如果已有 `ARK_CODE_API_KEY` / `HUOSHAN_API_KEY`，bundle 会作为回退自动使用。

通过 `cordis.patch.yml` 的 bundle config 可覆盖每条路由首选的引用：

```yaml
- id: llm-volcengine
  name: dsh-llm-volcengine
  config:
    agentPlanApiKeyEnv: ARK_AGENT_PLAN_API_KEY
    codingPlanApiKeyEnv: ARK_CODING_PLAN_API_KEY
    defaultReasoning: high
```

`defaultReasoning` 取 `off | minimal | low | medium | high | xhigh | max`（默认 `high`）。

## 提供商路由

### `volcengine-plan` — 火山方舟 Agent Plan

- 端点：`https://ark.cn-beijing.volces.com/api/plan/v3`
- 协议：多数模型用 `openai-responses`；Kimi K2.6 / K2.7 Code 用 `openai-completions`（同一个混合 api 的 provider）
- `reasoning.effort` 映射到所选思考档位

| 模型 ID | 上下文 | 输出上限 | 输入 | 思考档位 |
|---|---|---|---|---|
| `deepseek-v4-pro` | 100万 | 384000 | 文本 | low·medium·high·xhigh·max |
| `deepseek-v4-flash` | 100万 | 384000 | 文本 | low·medium·high·xhigh·max |
| `glm-5.2` | 100万 | 128000 | 文本 | low·medium·high·xhigh·max |
| `glm-5.3` | 100万 | 128000 | 文本 | low·medium·high·xhigh·max |
| `kimi-k3` | 100万 | 128000 | 文本+图像 | low·high·max |
| `minimax-m2.7` | 20万 | 128000 | 文本 | low·medium·high·xhigh·max |
| `minimax-m3` | 51.2万 | 128000 | 文本+图像 | low·medium·high·xhigh·max |
| `doubao-seed-2.0-mini` | 25.6万 | 128000 | 文本+图像 | low·medium·high·xhigh·max |
| `doubao-seed-2.0-lite` | 25.6万 | 128000 | 文本+图像 | low·medium·high·xhigh·max |
| `doubao-seed-2.0-code` | 25.6万 | 128000 | 文本+图像 | low·medium·high·xhigh·max |
| `doubao-seed-2.0-pro` | 25.6万 | 128000 | 文本+图像 | low·medium·high·xhigh·max |
| `kimi-k2.6` | 25.6万 | 32000 | 文本+图像 | off·high |
| `kimi-k2.7-code` | 25.6万 | 32000 | 文本+图像 | high |

### `volcengine-coding` — 火山方舟 Coding Plan

- 端点：`https://ark.cn-beijing.volces.com/api/coding/v3`
- 协议：`openai-completions`，`supportsDeveloperRole: false`、`supportsStore: false`、`supportsStrictMode: false`、`maxTokensField: "max_tokens"`
- DeepSeek/GLM 接受 `reasoning_effort`；Kimi 用 `qwen` 的 `enable_thinking` 开关；MiniMax/Doubao-seed-code 不支持思考控制（推理内容自动捕获）

| 模型 ID | 上下文 | 输出上限 | 输入 | 思考档位 |
|---|---|---|---|---|
| `deepseek-v4-pro` | 100万 | 384000 | 文本 | low·medium·high·xhigh·max |
| `deepseek-v4-flash` | 100万 | 384000 | 文本 | low·medium·high·xhigh·max |
| `glm-5.2` | 100万 | 128000 | 文本 | low·medium·high·xhigh·max |
| `glm-5.3` | 100万 | 128000 | 文本 | low·medium·high·xhigh·max |
| `kimi-k2.6` | 25.6万 | 32000 | 文本+图像 | off·high |
| `kimi-k2.7-code` | 25.6万 | 32000 | 文本+图像 | high |
| `minimax-m2.7` | 20万 | 128000 | 文本 | — |
| `minimax-m3` | 51.2万 | 128000 | 文本+图像 | — |
| `doubao-seed-code` | 25.6万 | 32000 | 文本+图像 | — |
| `doubao-seed-2.0-code` | 25.6万 | 65536 | 文本+图像 | low·medium·high·xhigh·max |
| `doubao-seed-2.0-pro` | 25.6万 | 128000 | 文本+图像 | low·medium·high·xhigh·max |
| `doubao-seed-2.0-lite` | 25.6万 | 128000 | 文本+图像 | low·medium·high·xhigh·max |

## 工作原理

bundle 插入一条插件 row（`id: llm-volcengine`）。apply 时：

1. 用 `createProvider` 直接构建两个 pi-ai `Provider`，把完整 `compat` 块附在每个 `Model` 上。因为模型是在代码里构造的（不走 `dsh-llm-pi-ai` 的 settings 解析），Coding Plan 网关所需的 compat 字段能直接进到 pi-ai，不受已安装的 `dsh-llm-pi-ai` compat schema 限制。
2. 用 `@deepseek-ai/dsh-llm-pi-ai` 导出的 `PiAiAdapter` 包裹它们——它已实现 harness 的 `LlmAdapter` 契约（stream/resolveModel/listModels），并按模型 `thinkingLevelMap` 做思考档位限幅。
3. 通过 `ctx.llm.registerAdapter` 注册这两条路由，提供商由此进入模型选择器与请求路由，和内置路由并无二致。

Agent Plan 的模型共用一个混合 api 的 provider（`createProvider` 的 `api` 用 map），Kimi K2.6/K2.7 Code 分发到 `openai-completions`，其余走 `openai-responses`。

## 致谢

模型目录、输出上限与兼容性开关来自社区验证的火山方舟 [pi](https://pi.dev) 扩展：

- [`pi-provider-volcengine-agent-plan`](https://pi.dev/packages/pi-provider-volcengine-agent-plan) —— Agent Plan 的 Responses 路径、套餐分级与 Kimi 路由决策
- [`pi-provider-volcengine-codingplan`](https://www.npmjs.com/package/pi-provider-volcengine-codingplan) —— Coding Plan 的 compat 开关与模型上限
- [`pi-provider-volcengine-ark`](https://www.npmjs.com/package/pi-provider-volcengine-ark) —— coding 端点的各模型 thinking 格式

本 bundle 把这些 compat 结论适配到 DeepSeek Harness 的 LLM 接缝。

## 许可证

MIT