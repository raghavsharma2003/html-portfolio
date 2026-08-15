// judge-provider.mjs — WS-BATTERY (SPEC §13, this workstream's own file).
//
// The single dispatch point that makes "swap the D2/qualification judge"
// a CONFIG CHANGE instead of a code change (task brief). A judge is fully
// described by a plain JudgeConfig object:
//
//   {
//     id:              "vendor/model-string" — display id, keys judges.json rows
//     family:          "anthropic" | "openai" | "google" | "deepseek" | "xai" | ...
//     provider:        "azure" | "openrouter" | "openai-compatible" | "anthropic"
//     model:           model / deployment id sent in the request body
//     baseURL:         required for "openai-compatible" and "anthropic"
//                      (azure's endpoint and openrouter's URL are fixed/derived
//                      from creds — see callJudgeProvider below)
//     apiKeyEnv:       name of the env var / creds field holding the key.
//                      NEVER a key itself — this file only ever reads
//                      `creds[apiKeyEnv]`, it never sees or logs the value's
//                      origin. azure is the one exception: it uses
//                      creds.AZURE_ENDPOINT/AZURE_KEY (api/_config.js), same
//                      as the rest of this repo's Azure call sites.
//     tokenParam:      "max_tokens" | "max_completion_tokens" — per-deployment
//                      quirk (gpt-5.x-family Azure deployments reject
//                      max_tokens; confirmed live, see judge-backtest.mjs).
//     temperature:     number | null (null/undefined => field omitted —
//                      some reasoning deployments reject any explicit temp
//                      other than their default; see gpt-5.6-terra).
//     reasoningEffort: string | null (null => field omitted). "none" is the
//                      confirmed-live value that stops a reasoning model from
//                      silently burning its whole token budget on hidden
//                      reasoning_tokens and returning an empty completion.
//     maxTokens:       default response cap for this judge's calls.
//     pricing:         { inUsdPerTok, outUsdPerTok } | undefined — USD per
//                      token. Required to project or cap spend (d2.mjs);
//                      absent for the three credits-billed judges tested so
//                      far because Azure credit consumption has no published
//                      per-token cash rate in this repo (judges.json's own
//                      creditRateNote) — that is a true "unknown", not a
//                      zero, and callers must treat it that way.
//   }
//
// This module makes NO network call on import and performs NO credential
// lookup of its own — every live caller below takes `creds` from its caller,
// so nothing here can accidentally read api/_config.js or process.env behind
// a --dry-run flag. mockJudgeCall() below is the $0 path: pure, seeded,
// deterministic, no fetch.
import { mulberry32 } from "./common.mjs";

// ── cost -------------------------------------------------------------------

// USD for one call's measured usage, under a judge's declared pricing.
// Returns NaN (never 0) when pricing is unknown — a caller that wants to
// enforce a spend cap MUST treat NaN as "cannot certify this is under cap",
// not as "free". This is the one line standing between "--max-spend" being
// a real guarantee and it being a guess.
export function callCostUsd(config, usage) {
  if (!usage) return 0;
  if (!config.pricing) return NaN;
  const { inUsdPerTok, outUsdPerTok } = config.pricing;
  return (usage.prompt_tokens || 0) * inUsdPerTok + (usage.completion_tokens || 0) * outUsdPerTok;
}

// ── live callers -------------------------------------------------------------
// Every OpenAI-style provider (azure, openrouter, openai-compatible) shares
// one request/response shape; only the URL and auth header differ. Anthropic's
// native Messages API does not, so it gets its own function and its usage
// object is normalized to the same {prompt_tokens, completion_tokens} shape
// so downstream cost/CI code never has to know which provider answered.

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callOpenAIStyle({ url, key, authHeader, model, tokenParam = "max_tokens", temperature, reasoningEffort, system, user, maxTokens, extraHeaders = {} }) {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
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
    if (r.status === 429 || r.status >= 500) {
      await sleep(1200 * (attempt + 1));
      continue;
    }
    const errBody = await r.text();
    throw new Error(`${url} ${r.status}: ${errBody.slice(0, 300)}`);
  }
  throw new Error(`${url}: exhausted retries`);
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
      // normalized to the OpenAI-shaped usage object every other provider
      // returns, so callCostUsd/CI code never branches on provider.
      const usage = j?.usage ? { prompt_tokens: j.usage.input_tokens || 0, completion_tokens: j.usage.output_tokens || 0 } : null;
      return { text, usage };
    }
    if (r.status === 429 || r.status >= 500) {
      await sleep(1200 * (attempt + 1));
      continue;
    }
    const errBody = await r.text();
    throw new Error(`${url} ${r.status}: ${errBody.slice(0, 300)}`);
  }
  throw new Error(`${url}: exhausted retries`);
}

// GET .../openai/deployments — Azure's management-plane deployment list,
// pulled out of judge-backtest.mjs verbatim (unchanged behavior) so both
// that file and any future caller can verify a deployment actually exists
// before spending a call on it.
export async function verifyAzureDeployments({ endpoint, key }) {
  const base = endpoint.replace(/\/openai\/v1\/?$/, "");
  const r = await fetch(`${base}/openai/deployments?api-version=2023-03-15-preview`, {
    headers: { "api-key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`deployments list ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.data || []).map((d) => ({ id: d.id, model: d.model, status: d.status }));
}

// The single entry point every D-battery judged suite should call for a real
// (non-mock) judgment. `creds` is whatever the caller loaded (api/_config.js
// exports + selected process.env vars) — this function never loads its own.
export async function callJudgeProvider(config, { system, user, maxTokens, creds }) {
  const cap = maxTokens ?? config.maxTokens ?? 300;
  switch (config.provider) {
    case "azure": {
      const endpoint = creds?.AZURE_ENDPOINT;
      const key = creds?.AZURE_KEY;
      if (!endpoint || !key) throw new Error(`judge "${config.id}": azure provider requires creds.AZURE_ENDPOINT/AZURE_KEY (api/_config.js)`);
      return callOpenAIStyle({
        url: `${endpoint}/chat/completions`,
        key,
        authHeader: { name: "api-key", value: (k) => k },
        model: config.model,
        tokenParam: config.tokenParam ?? "max_tokens",
        temperature: config.temperature,
        reasoningEffort: config.reasoningEffort,
        system,
        user,
        maxTokens: cap,
      });
    }
    case "openrouter": {
      const envName = config.apiKeyEnv || "OPENROUTER_KEY";
      const key = creds?.[envName];
      if (!key) throw new Error(`judge "${config.id}": openrouter provider requires creds.${envName}`);
      return callOpenAIStyle({
        url: "https://openrouter.ai/api/v1/chat/completions",
        key,
        authHeader: { name: "Authorization", value: (k) => `Bearer ${k}` },
        model: config.model,
        tokenParam: config.tokenParam ?? "max_tokens",
        temperature: config.temperature ?? 0,
        reasoningEffort: config.reasoningEffort,
        system,
        user,
        maxTokens: cap,
        extraHeaders: { "X-Title": "Meera WS-BATTERY" },
      });
    }
    case "openai-compatible": {
      if (!config.baseURL) throw new Error(`judge "${config.id}": openai-compatible provider requires config.baseURL`);
      const envName = config.apiKeyEnv;
      const key = envName ? creds?.[envName] : undefined;
      if (!key) throw new Error(`judge "${config.id}": openai-compatible provider requires creds.${envName}`);
      return callOpenAIStyle({
        url: `${config.baseURL.replace(/\/$/, "")}/chat/completions`,
        key,
        authHeader: { name: "Authorization", value: (k) => `Bearer ${k}` },
        model: config.model,
        tokenParam: config.tokenParam ?? "max_tokens",
        temperature: config.temperature,
        reasoningEffort: config.reasoningEffort,
        system,
        user,
        maxTokens: cap,
      });
    }
    case "anthropic": {
      if (!config.baseURL) throw new Error(`judge "${config.id}": anthropic provider requires config.baseURL`);
      const envName = config.apiKeyEnv;
      const key = envName ? creds?.[envName] : undefined;
      if (!key) throw new Error(`judge "${config.id}": anthropic provider requires creds.${envName}`);
      return callAnthropicNative({ baseURL: config.baseURL, key, model: config.model, system, user, maxTokens: cap });
    }
    default:
      throw new Error(`judge "${config.id}": unknown provider "${config.provider}"`);
  }
}

// ── the $0 mock path ---------------------------------------------------------
// Deterministic: the SAME (judge id, system, user) always produces the SAME
// mock verdict, on any machine, any run — a dry-run is worthless as a
// pipeline proof if it is itself flaky. `respond(rnd)` lets each caller build
// its own verdict-shaped text (judge-backtest.mjs's {"overall":...} vs
// d2.mjs's three-axis object) from one seeded RNG in [0,1).
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mockJudgeCall({ judgeId, system, user, respond }) {
  const rnd = mulberry32(fnv1a(`${judgeId} ${system.length} ${user}`));
  const text = respond(rnd);
  // token counts are a deterministic proxy (chars/4), not a real tokenizer —
  // labeled MOCK everywhere it surfaces so nobody mistakes it for a
  // measurement. Good enough to exercise the cost-meter/--max-spend CODE
  // PATH, which is the thing dry-run exists to prove.
  const usage = {
    prompt_tokens: Math.max(1, Math.round((system.length + user.length) / 4)),
    completion_tokens: Math.max(1, Math.round(text.length / 4)),
  };
  return { text, usage };
}
