// One truthful predicate for every server surface that needs the conversational
// reply engine. The capability shape is intentionally content-free: clients
// may know whether a reply can be generated, but never which provider, model,
// variable name, or credential is behind it.

import { createProductionRoomReplyGenerator } from "./_dialogue/registry.js";

export const REPLY_ENGINE_UNAVAILABLE = "reply_engine_unavailable";

export function replyEngineCapability(env = process.env) {
  let available = false;
  try { createProductionRoomReplyGenerator({ env }); available = true; } catch { available = false; }
  return {
    available,
    state: available ? "ready" : "unavailable",
    reason: available ? null : REPLY_ENGINE_UNAVAILABLE,
  };
}
