// Embeddings — SPEC §2.5 / §0.3 adjudication: halfvec(1536), person-filtered
// EXACT SCAN (no HNSW — a multi-tenant ANN index silently starves the small
// per-dyad corpora this product actually has). This module only produces
// vectors and the SQL literal to carry them; the scan itself lives beside
// each caller's own query (opRecall in api/memory.js, the nightly pass in
// api/consolidate.js) because the right join differs per caller.
//
// text-embedding-3-small, 1536-d — matches vy_embedding's column exactly.
// Azure first (same `extract-model` reversal condition: a bad Azure minute
// must cost a slower call, never a lost memory), OpenRouter fallback. Both
// verified live against the real deployment before this file was written:
// Azure /embeddings on the same openai/v1-compatible surface memory.js
// already calls for extraction returns 200 with 1536 dims; OpenRouter's
// /api/v1/embeddings on `openai/text-embedding-3-small` does too.
import { AZURE_ENDPOINT, AZURE_KEY, OPENROUTER_KEY } from "./_config.js";
import { assertAzureServingOrigin, isAzureOnlyServing } from "./_model-serving-policy.js";

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIM = 1536;

// Cost bookkeeping, per §4.3 discipline: numbers, so they can be checked.
// Per-process (serverless instances are ephemeral, same posture as _gkeys.js
// cooldown state) — callers that need a durable total read this before
// their invocation ends and log it themselves (consolidate.js, the backfill
// script), which is why this is a snapshot getter rather than a sink.
const cost = { azure_calls: 0, azure_tokens: 0, openrouter_calls: 0, openrouter_tokens: 0, failures: 0 };
export function embedCostSnapshot() {
  return { ...cost };
}

async function embedAzure(inputs, { env, fetchImpl }) {
  // An injected environment never inherits deployment credentials; strict
  // serving also requires an explicit runtime Azure configuration.
  const baked = env === process.env && !isAzureOnlyServing(env);
  const endpoint = env.AZURE_ENDPOINT || (baked ? AZURE_ENDPOINT : "");
  const key = env.AZURE_API_KEY || (baked ? AZURE_KEY : "");
  if (!endpoint || !key) return null;
  assertAzureServingOrigin(endpoint, env);
  const r = await fetchImpl(`${endpoint}/embeddings`, {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
    signal: AbortSignal.timeout(15_000),
    ...(isAzureOnlyServing(env) ? { redirect: "error" } : {}),
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!Array.isArray(j?.data) || j.data.length !== inputs.length) return null;
  cost.azure_calls++;
  cost.azure_tokens += Number(j?.usage?.total_tokens) || 0;
  return j.data.slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function embedOpenRouter(inputs, { env, fetchImpl }) {
  const key = env.OPENROUTER_API_KEY || (env === process.env ? OPENROUTER_KEY : "");
  if (!key) return null;
  const r = await fetchImpl("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Meera",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: inputs }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!Array.isArray(j?.data) || j.data.length !== inputs.length) return null;
  cost.openrouter_calls++;
  cost.openrouter_tokens += Number(j?.usage?.total_tokens) || 0;
  return j.data.slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embed up to a handful of short strings in one call. Returns one vector (or
 *  null on total failure — every caller must treat null as "skip this write /
 *  fall back to keyword-only", never as an error worth failing the request
 *  for: an embedding is an enhancement, never the only path to a memory. */
export async function embedBatch(texts, options = {}) {
  const env = options.env || process.env;
  const transport = { env, fetchImpl: options.fetchImpl || globalThis.fetch };
  const inputs = texts.map((t) => String(t || "").slice(0, 4000)).filter(Boolean);
  if (!inputs.length) return [];
  try {
    const az = await embedAzure(inputs, transport);
    if (az && az.every((v) => Array.isArray(v) && v.length === EMBED_DIM)) return az;
  } catch {
    /* the optional legacy fallback is selected below */
  }
  if (!isAzureOnlyServing(env)) {
    try {
      const or = await embedOpenRouter(inputs, transport);
      if (or && or.every((v) => Array.isArray(v) && v.length === EMBED_DIM)) return or;
    } catch {
      /* both failed */
    }
  }
  cost.failures += inputs.length;
  return inputs.map(() => null);
}

export async function embedOne(text, options = {}) {
  const [v] = await embedBatch([text], options);
  return v || null;
}

/** halfvec SQL literal for a parameterized query: cast with `$n::halfvec`. */
export function toHalfvecLiteral(vec) {
  return `[${vec.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}

// Published text-embedding-3-small rate, for the cost arithmetic in reports
// only — never used to gate a call (quality is never traded for cost, per
// CLAUDE.md's standing instruction).
export const PRICE_PER_1K_TOKENS = 0.00002;
