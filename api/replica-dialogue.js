// Authenticated private dialogue for an active, version-frozen self replica.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { createProductionDialogueGenerator } from "./_dialogue/registry.js";
import { createReplicaDialogueHandler } from "./_replica-dialogue.js";

async function requireLimitedUser(req) {
  const user = await requireUser(req);
  if (!allow(user.id, "replica_dialogue_user", 40)) {
    throw Object.assign(new Error("slow_down"), { code: "slow_down", status: 429 });
  }
  return user;
}

const serve = createReplicaDialogueHandler({
  db: q,
  requireUser: requireLimitedUser,
  resolveGenerator: async () => createProductionDialogueGenerator(),
});

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
  if (!allow(ipOf(req), "replica_dialogue", 30)) return res.status(429).json({ error: "slow_down" });
  try {
    return await serve(req, res);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    return res.status(500).json({ error: "replica_dialogue_failed" });
  }
}
