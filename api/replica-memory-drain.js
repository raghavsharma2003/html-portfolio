// Authenticated, bounded post-turn delivery for the owner's own Meet memory.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { llm } from "./consolidate.js";
import { drainOwnerMemory } from "./_owner-memory-drain.js";

export const config = { maxDuration: 60 };

export function createOwnerMemoryDrainHandler({ db = q, authenticate = requireUser, model = llm, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function ownerMemoryDrainHandler(req, res) {
    try {
      const user = await authenticate(req);
      if (!allow(user.id, "owner_memory_drain_user", 20)) return res.status(429).json({ error: "slow_down" });
      const memory = await drainOwnerMemory({ db, ownerUserId: user.id, input: req.body || {}, model, env, fetchImpl });
      return res.status(memory.state === "pending" ? 202 : 200).json({ memory });
    } catch (error) {
      if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return res.status(status).json({
        error: status === 500 ? "owner_memory_drain_failed" : String(error?.code || error?.message || "owner_memory_drain_failed"),
        memory: { state: "unavailable" },
      });
    }
  };
}

const serve = createOwnerMemoryDrainHandler();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "owner_memory_drain", 30)) return res.status(429).json({ error: "slow_down" });
  return serve(req, res);
}
