// harness/providers.mjs — one dispatch point, so adding a judge is a CONFIG
// change and never a code change.
//
// A judge is fully described by a plain JudgeConfig object:
//
//   {
//     id:              display id; keys every output row
//     family:          "anthropic" | "openai" | "xai" | "deepseek" | "mistral" | ...
//                      Used to detect a vendor-family conflict with an arm.
//     provider:        "azure" | "openrouter" | "openai-compatible" | "anthropic"
//     model:           model / deployment id sent in the request body
//     baseURL:         required for "openai-compatible" and "anthropic"
//     apiKeyEnv:       NAME of the environment variable holding the key.
//                      NEVER a key. This module reads process.env[apiKeyEnv]
//                      and nothing else; no key is ever logged or serialised.
//     tokenParam:      "max_tokens" | "max_completion_tokens" — a per-deployment
//                      quirk, see protocol/QUIRKS.md
//     temperature:     number | null (null => omit the field entirely; some
//                      reasoning deployments reject any explicit value)
//     reasoningEffort: string | null (null => omit). "none" is what stops a
//                      reasoning model silently spending its whole visible
//                      token budget on hidden reasoning
//     maxTokens:       response cap for this judge's calls
//     pricing:         { promptPerToken, completionPerToken } | null.
//                      null means UNKNOWN, which is not zero — see costUsd.
//   }
//
// No network call happens on import and no credential is read here except
// through `process.env[config.apiKeyEnv]` at call time.

const AZURE_ENDPOINT_ENV = "JUDGE_AZURE_ENDPOINT";

/** USD for one call's usage. Returns NaN — never 0 — when pricing is unknown.
 *  A caller enforcing a spend cap MUST treat NaN as "cannot certify this is
 *  under cap". This one line is the difference between a spend cap being a
 *  guarantee and being a guess.
 *
 *  Note the field names. In the run that produced this paper's only cash
 *  figure, the configs declared `prompt_per_token` while the helper read
 *  `inUsdPerTok`, so the priced path returned NaN and serialised as null. The
 *  guard behaved correctly (an unknown rate must never print as $0) and the
 *  total had to be computed by hand. Keep one spelling. */
export function costUsd(config, usage) {
  if (!usage) return 0;
  if (!config.pricing) return NaN;
  const { promptPerToken, completionPerToken } = config.pricing;
  if (promptPerToken == null || completionPerToken == null) return NaN;
  return (usage.prompt_tokens || 0) * promptPerToken + (usage.completion_tokens || 0) * completionPerToken;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOpenAIStyle({ url, key, authHeader, model, tokenParam = "max_tokens", temperature, reasoningEffort, system, user, maxTokens, extraHeaders = {} }) {
  const body = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(temperature === null || temperature === undefined ? {} : { temperature }),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    [tokenParam]: maxTokens,
  };
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  headers[authHeader.name] = authHeader.value(key);
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    if (r.ok) {
      const j = await r.json();
      return { text: j?.choices?.[0]?.message?.content ?? "", usage: j?.usage ?? null };
    }
    if (r.status === 429 || r.status >= 500) { await sleep(1200 * (attempt + 1)); continue; }
    throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("exhausted retries");
}

async function callAnthropicNative({ baseURL, key, model, system, user, maxTokens }) {
  const url = `${baseURL.replace(/\/$/, "")}/v1/messages`;
  const body = { model, system, max_tokens: maxTokens, messages: [{ role: "user", content: user }] };
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (r.ok) {
      const j = await r.json();
      const text = (j?.content || []).map((b) => b?.text || "").join("");
      // normalised to the OpenAI-shaped usage object so nothing downstream
      // branches on which provider answered
      const usage = j?.usage ? { prompt_tokens: j.usage.input_tokens || 0, completion_tokens: j.usage.output_tokens || 0 } : null;
      return { text, usage };
    }
    if (r.status === 429 || r.status >= 500) { await sleep(1200 * (attempt + 1)); continue; }
    throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("exhausted retries");
}

export async function callJudge(config, { system, user, maxTokens }) {
  const cap = maxTokens ?? config.maxTokens ?? 300;
  const key = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
  switch (config.provider) {
    case "azure": {
      const endpoint = process.env[AZURE_ENDPOINT_ENV];
      if (!endpoint || !key) throw new Error(`judge "${config.id}": set ${AZURE_ENDPOINT_ENV} and ${config.apiKeyEnv}`);
      return callOpenAIStyle({
        url: `${endpoint.replace(/\/$/, "")}/chat/completions`, key,
        authHeader: { name: "api-key", value: (k) => k },
        model: config.model, tokenParam: config.tokenParam ?? "max_tokens",
        temperature: config.temperature, reasoningEffort: config.reasoningEffort,
        system, user, maxTokens: cap,
      });
    }
    case "openrouter": {
      if (!key) throw new Error(`judge "${config.id}": set ${config.apiKeyEnv}`);
      return callOpenAIStyle({
        url: "https://openrouter.ai/api/v1/chat/completions", key,
        authHeader: { name: "Authorization", value: (k) => `Bearer ${k}` },
        model: config.model, tokenParam: config.tokenParam ?? "max_tokens",
        temperature: config.temperature ?? 0, reasoningEffort: config.reasoningEffort,
        system, user, maxTokens: cap,
      });
    }
    case "openai-compatible": {
      if (!config.baseURL) throw new Error(`judge "${config.id}": openai-compatible requires baseURL`);
      if (!key) throw new Error(`judge "${config.id}": set ${config.apiKeyEnv}`);
      return callOpenAIStyle({
        url: `${config.baseURL.replace(/\/$/, "")}/chat/completions`, key,
        authHeader: { name: "Authorization", value: (k) => `Bearer ${k}` },
        model: config.model, tokenParam: config.tokenParam ?? "max_tokens",
        temperature: config.temperature, reasoningEffort: config.reasoningEffort,
        system, user, maxTokens: cap,
      });
    }
    case "anthropic": {
      if (!config.baseURL) throw new Error(`judge "${config.id}": anthropic requires baseURL`);
      if (!key) throw new Error(`judge "${config.id}": set ${config.apiKeyEnv}`);
      return callAnthropicNative({ baseURL: config.baseURL, key, model: config.model, system, user, maxTokens: cap });
    }
    default:
      throw new Error(`judge "${config.id}": unknown provider "${config.provider}"`);
  }
}

// ── the $0 path ─────────────────────────────────────────────────────────────
// Deterministic: the same (judge id, system, user) always yields the same mock
// verdict, on any machine. A dry run is worthless as a pipeline proof if it is
// itself flaky.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
import { mulberry32 } from "./rng.mjs";

export function mockJudge({ judgeId, system, user, respond }) {
  const rnd = mulberry32(fnv1a(`${judgeId} ${system.length} ${user}`));
  const text = respond(rnd);
  // token counts are a deterministic chars/4 proxy, labelled MOCK wherever they
  // surface — enough to exercise the cost-meter code path, never a measurement
  return {
    text,
    usage: {
      prompt_tokens: Math.max(1, Math.round((system.length + user.length) / 4)),
      completion_tokens: Math.max(1, Math.round(text.length / 4)),
    },
  };
}
