/**
 * dsh-llm-volcengine — Volcengine Ark Agent Plan & Coding Plan providers for
 * DeepSeek Harness (DSH).
 *
 * Two provider routes are registered through a pi-ai-backed LlmAdapter:
 *
 *   volcengine-plan    — Volcengine Ark Agent Plan.
 *                        Endpoint: https://ark.cn-beijing.volces.com/api/plan/v3
 *                        Protocol: openai-responses (Kimi K2.6/K2.7 Code use
 *                        openai-completions via a mixed-api provider).
 *                        Thinking effort maps natively to `reasoning.effort`.
 *
 *   volcengine-coding  — Volcengine Ark Coding Plan.
 *                        Endpoint: https://ark.cn-beijing.volces.com/api/coding/v3
 *                        Protocol: openai-completions with the compat overrides
 *                        the Coding Plan gateway requires
 *                        (supportsDeveloperRole: false, maxTokensField:
 *                        "max_tokens", …). Thinking effort maps to
 *                        reasoning_effort (DeepSeek/GLM) or enable_thinking
 *                        (Kimi).
 *
 * Model catalogs, max output tokens, and compatibility switches are sourced from
 * the community-verified Volcengine Ark provider extensions
 * (pi-provider-volcengine-agent-plan, pi-provider-volcengine-codingplan,
 * pi-provider-volcengine-ark) and from direct endpoint testing performed during
 * development. Per-request thinking levels low/medium/high/xhigh/max are exposed
 * where the endpoint honors them.
 *
 * Credentials are resolved in order through the DSH credential service, falling
 * back to ambient environment variables. This is a self-contained adapter that
 * builds pi-ai Provider and Model objects directly, so the compat fields the
 * Coding Plan gateway requires reach pi-ai without depending on the
 * dsh-llm-pi-ai settings compat schema.
 *
 * @module dsh-llm-volcengine
 */

import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { LlmError, assertUsableApiKey, attributionHeaders, resolveRetryPolicy, LlmAdapter } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

/**
 * Default credential resolution order, tried left to right.
 * @internal
 */
const AGENT_PLAN_KEY_ENVS = ["ARK_AGENT_PLAN_API_KEY", "VOLCENGINE_ARK_PLAN_API_KEY", "ARK_CODE_API_KEY"];
const CODING_PLAN_KEY_ENVS = ["ARK_CODING_PLAN_API_KEY", "VOLCENGINE_CODING_API_KEY", "HUOSHAN_API_KEY"];

const AGENT_PLAN_BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3";
const CODING_PLAN_BASE_URL = "https://ark.cn-beijing.volces.com/api/coding/v3";

const PLAN_PROVIDER_ID = "volcengine-plan";
const CODE_PROVIDER_ID = "volcengine-coding";

const DEFAULT_REASONING = "high";
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;

/** Thinking level map exposing low/medium/high/xhigh/max (off pinned null). */
const FIVE_TIER = {
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/**
 * Base compatibility switches the Coding Plan (openai-completions) gateway
 * requires. The gateway rejects the OpenAI `developer` role, the `store`
 * field, and non-`max_tokens` field names with HTTP 400, so all are overridden
 * here rather than left to pi-ai's URL-derived auto-detection.
 */
const CODING_COMPAT_BASE = {
  supportsDeveloperRole: false,
  supportsStore: false,
  supportsStrictMode: false,
  maxTokensField: "max_tokens",
  supportsReasoningEffort: true,
};

/** Shared cost placeholder; pi-ai requires a cost block but the harness does not bill. */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function cost(input, output, cacheRead = 0, cacheWrite = 0) {
  return { input, output, cacheRead, cacheWrite };
}

/**
 * Agent Plan model catalog. Most models use openai-responses; Kimi K2.6 and
 * Kimi K2.7 Code route to openai-completions (Agent Plan Responses tool-calls
 * returned repeated server errors for these two during community testing).
 */
const AGENT_PLAN_MODELS = [
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text"],
    contextWindow: 1024000,
    maxTokens: 384000,
    cost: cost(0.435, 0.87, 0.003625),
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text"],
    contextWindow: 1024000,
    maxTokens: 384000,
    cost: cost(0.14, 0.28, 0.0028),
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "glm-5.2",
    name: "GLM 5.2",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text"],
    contextWindow: 1024000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "glm-5.3",
    name: "GLM 5.3",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text"],
    contextWindow: 1024000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: { off: null, low: "low", high: "high", max: "max" },
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 128000,
    cost: NO_COST,
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: { ...FIVE_TIER, off: null },
    input: ["text"],
    contextWindow: 200000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text", "image"],
    contextWindow: 512000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "doubao-seed-2.0-mini",
    name: "Doubao Seed 2.0 Mini",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 128000,
    cost: cost(0.03, 0.28, 0.01, 0.0024),
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "doubao-seed-2.0-lite",
    name: "Doubao Seed 2.0 Lite",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 128000,
    cost: cost(0.09, 0.51, 0.02, 0.0024),
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "doubao-seed-2.0-code",
    name: "Doubao Seed 2.0 Code",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 128000,
    cost: cost(0.9, 4.48),
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "doubao-seed-2.0-pro",
    name: "Doubao Seed 2.0 Pro",
    api: "openai-responses",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 128000,
    cost: cost(0.45, 2.24, 0.09, 0.0024),
    compat: { supportsDeveloperRole: true, supportsLongCacheRetention: true },
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    api: "openai-completions",
    reasoning: true,
    thinkingLevelMap: { off: "minimal", high: "high" },
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 32000,
    cost: NO_COST,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      supportsStore: true,
      supportsUsageInStreaming: true,
      supportsLongCacheRetention: false,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
    },
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    api: "openai-completions",
    reasoning: true,
    thinkingLevelMap: { off: null, high: "high" },
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 32000,
    cost: NO_COST,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      supportsStore: true,
      supportsUsageInStreaming: true,
      supportsLongCacheRetention: false,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
    },
  },
];

/**
 * Coding Plan model catalog, all openai-completions with the gateway compat
 * base. DeepSeek/GLM accept reasoning_effort (verified by endpoint testing);
 * Kimi uses the qwen enable_thinking toggle; MiniMax/Doubao-seed-code expose
 * no thinking control (reasoning captured by the stream).
 */
const CODING_PLAN_MODELS = [
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text"],
    contextWindow: 1024000,
    maxTokens: 384000,
    cost: cost(0.435, 0.87, 0.003625),
    compat: { ...CODING_COMPAT_BASE, thinkingFormat: "deepseek" },
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text"],
    contextWindow: 1024000,
    maxTokens: 384000,
    cost: cost(0.14, 0.28, 0.0028),
    compat: { ...CODING_COMPAT_BASE, thinkingFormat: "deepseek" },
  },
  {
    id: "glm-5.2",
    name: "GLM 5.2",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text"],
    contextWindow: 1024000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: CODING_COMPAT_BASE,
  },
  {
    id: "glm-5.3",
    name: "GLM 5.3",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text"],
    contextWindow: 1024000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: CODING_COMPAT_BASE,
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    reasoning: true,
    thinkingLevelMap: { off: "minimal", high: "high" },
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 32000,
    cost: NO_COST,
    compat: { ...CODING_COMPAT_BASE, thinkingFormat: "qwen", supportsReasoningEffort: false },
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    reasoning: true,
    thinkingLevelMap: { off: null, high: "high" },
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 32000,
    cost: NO_COST,
    compat: { ...CODING_COMPAT_BASE, thinkingFormat: "qwen", supportsReasoningEffort: false },
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    reasoning: false,
    input: ["text"],
    contextWindow: 200000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: CODING_COMPAT_BASE,
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 512000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: CODING_COMPAT_BASE,
  },
  {
    id: "doubao-seed-code",
    name: "Doubao Seed Code",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 32000,
    cost: NO_COST,
    compat: CODING_COMPAT_BASE,
  },
  {
    id: "doubao-seed-2.0-code",
    name: "Doubao Seed 2.0 Code",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 65536,
    cost: NO_COST,
    compat: CODING_COMPAT_BASE,
  },
  {
    id: "doubao-seed-2.0-pro",
    name: "Doubao Seed 2.0 Pro",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: CODING_COMPAT_BASE,
  },
  {
    id: "doubao-seed-2.0-lite",
    name: "Doubao Seed 2.0 Lite",
    reasoning: true,
    thinkingLevelMap: FIVE_TIER,
    input: ["text", "image"],
    contextWindow: 256000,
    maxTokens: 128000,
    cost: NO_COST,
    compat: CODING_COMPAT_BASE,
  },
];

/** Harness attribution headers are stripped from user/provider headers by name. */
function bakeHeaders(providerHeaders) {
  const attribution = attributionHeaders();
  const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
  return {
    ...Object.fromEntries(Object.entries(providerHeaders ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  };
}

/**
 * Resolve the effective API key for one route by trying each candidate env
 * reference through the DSH credential service, then ambient environment.
 * @param ctx - the Cordis fiber context.
 * @param candidates - credential reference names tried in order.
 * @param routeLabel - display name for diagnostics.
 * @returns the usable key.
 * @throws {LlmError} MISSING_CREDENTIAL when no candidate resolves a key.
 */
async function resolveRouteKey(ctx, candidates, routeLabel) {
  const credentials = ctx.get("credentials");
  const launchEnv = launchEnvironmentOf(ctx);
  for (const ref of candidates) {
    const hit = credentials !== undefined ? (await credentials.resolve(ref))?.value : launchEnv.get(ref)?.value;
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, "llm-volcengine", ref);
  }
  throw new LlmError(
    `llm-volcengine: no credential for ${routeLabel}; tried ${candidates.join(", ")} — store one through the credentials service (the web Models page writes it) or export it`,
    "MISSING_CREDENTIAL",
  );
}

/**
 * Build one pi-ai Provider. Agent Plan uses a mixed-api map so Kimi models on
 * the responses route can dispatch to openai-completions.
 * @param spec - provider construction spec.
 * @returns a pi-ai Provider.
 */
function buildPiProvider(spec) {
  const apiKeyAuth = { name: spec.displayName, resolve: () => Promise.resolve({}) };
  const apiMap = spec.usesResponses
    ? { "openai-responses": openAIResponsesApi(), "openai-completions": openAICompletionsApi() }
    : openAICompletionsApi();
  return createProvider({
    id: spec.id,
    name: spec.displayName,
    baseUrl: spec.baseUrl,
    headers: spec.headers,
    auth: { apiKey: apiKeyAuth },
    models: spec.models,
    api: apiMap,
  });
}

/**
 * Materialize one resolved profile for the PiAiAdapter.
 * @param provider - route key.
 * @param displayName - display name.
 * @param piProvider - built pi-ai Provider.
 * @param reasoning - configured default thinking level.
 * @param candidates - credential reference names.
 * @returns the resolved profile object.
 */
function makeProfile(provider, displayName, piProvider, reasoning, candidates) {
  return {
    provider,
    displayName,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, `llm-volcengine: provider "${provider}" retryPolicy`),
    piProvider,
    configuredMaxTokens: new Map(),
    ...reasoning === undefined ? {} : { reasoning },
    ...candidates.length === 0 ? {} : { apiKeyEnv: credentialRef(candidates[0]) },
    keyCandidates: candidates,
  };
}

/** Plugin identity for the Cordis loader. */
export const name = "dsh-llm-volcengine";
export const inject = ["llm"];

/**
 * Register Volcengine Ark Agent Plan and Coding Plan provider routes.
 * @param ctx - the Cordis fiber context.
 * @param config - optional bundle config (agentPlanApiKeyEnv,
 *                 codingPlanApiKeyEnv, defaultReasoning).
 */
export function apply(ctx, config = {}) {
  const defaultReasoning = config.defaultReasoning ?? DEFAULT_REASONING;
  const agentKeyCandidates = config.agentPlanApiKeyEnv
    ? [config.agentPlanApiKeyEnv, ...AGENT_PLAN_KEY_ENVS.filter((e) => e !== config.agentPlanApiKeyEnv)]
    : AGENT_PLAN_KEY_ENVS;
  const codingKeyCandidates = config.codingPlanApiKeyEnv
    ? [config.codingPlanApiKeyEnv, ...CODING_PLAN_KEY_ENVS.filter((e) => e !== config.codingPlanApiKeyEnv)]
    : CODING_PLAN_KEY_ENVS;

  const agentDisplay = "Volcengine Ark Agent Plan";
  const codeDisplay = "Volcengine Ark Coding Plan";

  const agentPlanProvider = buildPiProvider({
    id: PLAN_PROVIDER_ID,
    displayName: agentDisplay,
    baseUrl: AGENT_PLAN_BASE_URL,
    models: AGENT_PLAN_MODELS.map((m) => ({ ...m, provider: PLAN_PROVIDER_ID, baseUrl: AGENT_PLAN_BASE_URL, cost: m.cost ?? NO_COST })),
    usesResponses: true,
  });
  const codingPlanProvider = buildPiProvider({
    id: CODE_PROVIDER_ID,
    displayName: codeDisplay,
    baseUrl: CODING_PLAN_BASE_URL,
    models: CODING_PLAN_MODELS.map((m) => ({ ...m, provider: CODE_PROVIDER_ID, baseUrl: CODING_PLAN_BASE_URL, cost: m.cost ?? NO_COST })),
    usesResponses: false,
  });

  const profiles = new Map([
    [PLAN_PROVIDER_ID, makeProfile(PLAN_PROVIDER_ID, agentDisplay, agentPlanProvider, defaultReasoning, agentKeyCandidates)],
    [CODE_PROVIDER_ID, makeProfile(CODE_PROVIDER_ID, codeDisplay, codingPlanProvider, defaultReasoning, codingKeyCandidates)],
  ]);

  const resolveApiKey = async (provider, profile) => {
    const candidates = profile.keyCandidates ?? [];
    const routeLabel = profile.displayName ?? provider;
    return resolveRouteKey(ctx, candidates, routeLabel);
  };

  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey,
    resolveAttachments: () => ctx.get("attachments"),
  });

  const routes = [PLAN_PROVIDER_ID, CODE_PROVIDER_ID];
  let registration;
  const ensureRegistration = () => {
    if (registration === undefined) {
      registration = ctx.llm.registerAdapter(routes, adapter);
    }
  };
  ensureRegistration();

  const ensureDirectory = () => {
    const entries = [
      { provider: PLAN_PROVIDER_ID, displayName: agentDisplay, settingsNs: "llm-volcengine", settingsPath: ["providers", PLAN_PROVIDER_ID], declared: true },
      { provider: CODE_PROVIDER_ID, displayName: codeDisplay, settingsNs: "llm-volcengine", settingsPath: ["providers", CODE_PROVIDER_ID], declared: true },
    ];
    const directory = ctx.llm.registerConfigurableProviders
      ? ctx.llm.registerConfigurableProviders(entries)
      : undefined;
    return directory;
  };
  ensureDirectory();

  ctx.effect?.(() => () => {
    registration?.();
  });
}