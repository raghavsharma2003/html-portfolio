import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { runVoiceErasureSweep } from "./_replica-voice-erasure.js";

export const config = { maxDuration: 300 };

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function authorizedReplicaErasure(req, env = process.env) {
  const configured = String(env.CRON_SECRET || env.REPLICA_ERASURE_SECRET || "");
  const supplied = String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return sameSecret(configured, supplied);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "replica_erasure_sweep", 30)) return res.status(429).json({ error: "slow_down" });
  if (!authorizedReplicaErasure(req)) return res.status(403).json({ error: "not_authorized" });
  if (["1", "true", "yes"].includes(String(process.env.REPLICA_ERASURE_KILL || "").toLowerCase())) {
    return res.status(200).json({ ok: true, disabled: true });
  }
  try {
    const summary = await runVoiceErasureSweep({ db: q });
    return res.status(200).json({ ok: true, ...summary });
  } catch {
    return res.status(503).json({ error: "replica_erasure_sweep_failed" });
  }
}
