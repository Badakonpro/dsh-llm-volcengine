# dsh-llm-volcengine — 火山方舟接入 DeepSeek Harness 的思考强度修复插件

> 为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）接入火山方舟 **Agent Plan** 与 **Coding Plan**，思考强度（thinking effort）兼容性已实测验证。
>
> GitHub: https://github.com/Badakonpro/dsh-llm-volcengine · License: MIT

---

## 一、这是什么

`dsh-llm-volcengine` 是一个 DeepSeek Harness **profile bundle（插件包）**。装上它之后，DSH 的模型选择器里会多出两个提供商：

| 提供商 | 对应火山方舟套餐 | 端点 | 协议 |
|---|---|---|---|
| `volcengine-plan/<模型>` | **Agent Plan**（智能体套餐） | `https://ark.cn-beijing.volces.com/api/plan/v3` | OpenAI Responses（Kimi 走 Chat Completions） |
| `volcengine-coding/<模型>` | **Coding Plan**（编程套餐） | `https://ark.cn-beijing.volces.com/api/coding/v3` | OpenAI Chat Completions |

并且两个提供商都支持**手动切换思考强度**：`low` / `medium` / `high` / `xhigh` / `max` 五档。

---

## 二、为什么要写这个插件（踩坑记录）

把火山方舟接进 DSH 看起来只是写几行 `settings.yaml` 的事，实际上一路都是坑。本插件把以下所有问题一次性解决：

### 坑 1：Agent Plan 必须走 Responses 协议 + `/api/plan/v3`

网上（包括 Claude Code 生态）流传的接入方式是 Anthropic 风格端点 `/api/plan` + `anthropic-messages` 协议。这条路径**能跑通基础对话，但思考强度不可调**——pi-ai 的 anthropic 路径把 reasoning 映射成 `budget_tokens`（token 预算），而火山网关真正认识的是 Responses 协议里的 `reasoning.effort`（思考档位）。

> 社区实测结论（[pi-provider-volcengine-agent-plan](https://pi.dev/packages/pi-provider-volcengine-agent-plan)）：Agent Plan 的正确姿势是
> **`openai-responses` + `https://ark.cn-beijing.volces.com/api/plan/v3`**。
> 本插件已实测确认：`reasoning.effort: "max"` 在 `/api/plan/v3/responses` 上返回 200，思考真实生效。

### 坑 2：Coding Plan 网关拒绝 `developer` 角色（HTTP 400）

一旦模型开启 reasoning，pi-ai 会把系统提示词以 OpenAI 的 `developer` 角色发送——而火山 Coding Plan 网关只认 `system / assistant / user / tool`，**每个请求都会 400**：

```
The parameter `messages.role` ... invalid value: `developer`, supported values are: `system`, `assistant`, `user`, `tool`
```

解决：每个模型强制 `compat.supportsDeveloperRole: false`。

### 坑 3：Coding Plan 网关只认 `max_tokens`，不接受 `store`

pi-ai 对未知域名默认发 `store: false` 和 `max_completion_tokens`，火山网关对前者虽容忍但会拒绝超限的 `max_tokens`（glm 上限 128000），字段名不对也会出问题。解决：`supportsStore: false` + `maxTokensField: "max_tokens"`。

### 坑 4：各模型 `maxTokens` 上限不同

| 模型 | 输出上限 |
|---|---|
| deepseek-v4-pro / flash | **384000** |
| glm-5.2 / 5.3、minimax、doubao-seed-2.0-pro/lite | 128000 |
| doubao-seed-2.0-code | 65536 |
| kimi-k2.6 / k2.7-code | 32000 |

写死一个统一上限，要么撑爆小模型（400），要么浪费大模型。每个模型必须带各自的实测上限。

### 坑 5：DSH 的 settings compat schema 只放行两个字段

手改 `settings.yaml` 时，`supportsDeveloperRole`、`maxTokensField` 等字段会被 `dsh-llm-pi-ai` 的配置 schema 过滤掉，根本到不了 pi-ai。

> 本插件的关键设计：**不用 settings.yaml 声明 provider，而是在插件代码里直接用 pi-ai 的 `createProvider` 构造 `Model`，把完整 `compat` 块直接附在模型对象上**——完全绕开 schema 限制，天然免疫上游 schema 变动。

### 坑 6：火山网关的溢出错误文案 pi-ai 识别不了

方舟的上下文溢出错误是 `OutofContextError: ...`，不在 pi-ai 内置的溢出检测正则里，长对话溢出会直接报错而不是自动压缩重试。插件已在底层补上该模式的识别。

---

## 三、安装

在 DSH profile 根目录（如 `~/.dsh/profiles/web`）执行：

```bash
dsh plugin --profile web add dsh-llm-volcengine
```

然后**重启 DSH**。模型选择器里即可看到：

- `volcengine-plan/deepseek-v4-pro`、`volcengine-plan/glm-5.2`、`volcengine-plan/kimi-k3` ……
- `volcengine-coding/deepseek-v4-flash`、`volcengine-coding/glm-5.2` ……

> 如果还没发布到 npm，也可以用 Git URL 安装：`dsh plugin --profile web add git+https://github.com/Badakonpro/dsh-llm-volcengine.git`

## 四、凭据

插件按顺序尝试以下环境变量名（通过 DSH 凭据服务解析，**值不会写入插件**）：

| 路由 | 尝试顺序 |
|---|---|
| `volcengine-plan` | `ARK_AGENT_PLAN_API_KEY` → `VOLCENGINE_ARK_PLAN_API_KEY` → `ARK_CODE_API_KEY` |
| `volcengine-coding` | `ARK_CODING_PLAN_API_KEY` → `VOLCENGINE_CODING_API_KEY` → `HUOSHAN_API_KEY` |

已有 `ARK_CODE_API_KEY` / `HUOSHAN_API_KEY` 的用户**零配置直接可用**（自动回退）。

也可以在 `cordis.patch.yml` 里通过 bundle config 覆盖：

```yaml
- id: llm-volcengine
  name: dsh-llm-volcengine
  config:
    agentPlanApiKeyEnv: ARK_AGENT_PLAN_API_KEY
    codingPlanApiKeyEnv: ARK_CODING_PLAN_API_KEY
    defaultReasoning: high   # off | minimal | low | medium | high | xhigh | max
```

## 五、模型目录

### Agent Plan（13 个模型）

| 模型 | 上下文 | 输出 | 思考档位 |
|---|---|---|---|
| deepseek-v4-pro / flash | 100万 | 384000 | low·medium·high·xhigh·max |
| glm-5.2 / 5.3 | 100万 | 128000 | low·medium·high·xhigh·max |
| kimi-k3 | 100万 | 128000 | low·high·max |
| minimax-m2.7 / m3 | 20万 / 51.2万 | 128000 | low·medium·high·xhigh·max |
| doubao-seed-2.0-mini / lite / code / pro | 25.6万 | 128000 | low·medium·high·xhigh·max |
| kimi-k2.6 / k2.7-code | 25.6万 | 32000 | off·high / high |

### Coding Plan（12 个模型）

| 模型 | 上下文 | 输出 | 思考档位 |
|---|---|---|---|
| deepseek-v4-pro / flash | 100万 | 384000 | low·medium·high·xhigh·max |
| glm-5.2 / 5.3 | 100万 | 128000 | low·medium·high·xhigh·max |
| kimi-k2.6 / k2.7-code | 25.6万 | 32000 | off·high / high |
| minimax-m2.7 / m3 | 20万 / 51.2万 | 128000 | —（推理自动捕获） |
| doubao-seed-code | 25.6万 | 32000 | —（推理自动捕获） |
| doubao-seed-2.0-code / pro / lite | 25.6万 | 65536 / 128000 | low·medium·high·xhigh·max |

## 六、技术原理

```
cordis.patch.yml  ──插入──>  plugin row (id: llm-volcengine)
                                │
lib/index.js  apply()  ◄───────┘
   │  1. createProvider() 直接构建两个 pi-ai Provider
   │     · Model 对象内联完整 compat（绕过 DSH schema）
   │     · Agent Plan 用 api map 混合分发（Responses + Chat Completions）
   │  2. PiAiAdapter（@deepseek-ai/dsh-llm-pi-ai 导出）包装
   │  3. ctx.llm.registerAdapter() 注册两条路由
   └─> 模型选择器 / 请求路由 立即可用
```

- **思考强度**：每个模型带 `thinkingLevelMap`，pi-ai 据此做档位限幅（`clampThinkingLevel`）与协议映射（Responses → `reasoning.effort`；Completions → `reasoning_effort` 或 Kimi 的 `enable_thinking`）。
- **凭据**：DSH 凭据服务优先，环境变量回退，多候选名顺序尝试。
- **归因头**：请求自动携带 DSH `attributionHeaders()`。

## 七、致谢

模型目录与兼容性开关基于社区已验证的 pi 扩展：

- [pi-provider-volcengine-agent-plan](https://pi.dev/packages/pi-provider-volcengine-agent-plan) — Agent Plan 的 Responses 路径、Kimi 路由决策
- [pi-provider-volcengine-codingplan](https://www.npmjs.com/package/pi-provider-volcengine-codingplan) — Coding Plan 的 compat 开关与模型上限
- [pi-provider-volcengine-ark](https://www.npmjs.com/package/pi-provider-volcengine-ark) — coding 端点各模型 thinking 格式

## 八、许可证

MIT
