// One truthful predicate for every server surface that needs the conversational
// reply engine. The capability shape is intentionally content-free: clients
// may know whether a reply can be generated, but never which provider, model,
// variable name, or credential is behind it.

import { OPENROUTER_KEY } from "./_config.js";
import { azureSurfaceReplyConfig } from "./_azure-surface-reply.js";
import { resolveReplyServingProvider } from "./_model-serving-policy.js";

export const REPLY_ENGINE_UNAVAILABLE = "reply_engine_unavailable";

export function replyEngineCapability(env = process.env) {
  const bakedKey = env === process.env ? OPENROUTER_KEY : "";
  let provider;
  try { provider = resolveReplyServingProvider(env); } catch { provider = null; }
  let available = provider === "openrouter" && Boolean(String(env?.OPENROUTER_API_KEY || env?.OPENROUTER_KEY || bakedKey || "").trim());
  if (provider === "azure_foundry") {
    try { azureSurfaceReplyConfig(env); available = true; } catch { available = false; }
  }
  return {
    available,
    state: available ? "ready" : "unavailable",
    reason: available ? null : REPLY_ENGINE_UNAVAILABLE,
  };
}
