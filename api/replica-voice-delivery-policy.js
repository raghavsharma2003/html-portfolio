import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  buildOwnedVoiceDeliveryPolicy,
  ownedVoiceDeliveryPolicyStatus,
} from "./_replica-voice-delivery-policy.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!new Set(["GET", "POST"]).has(req.method)) return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "replica_voice_delivery_policy", 30)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_voice_delivery_policy_user", 20)) return res.status(429).json({ error: "slow_down" });
    const input = req.method === "GET" ? req.query || {} : req.body || {};
    if (req.method === "GET") {
      const status = await ownedVoiceDeliveryPolicyStatus(q, user.id, input);
      return res.status(200).json({ voice_delivery: status });
    }
    if (input.op !== "build") return res.status(400).json({ error: "unknown_operation" });
    const policy = await buildOwnedVoiceDeliveryPolicy(q, user.id, input);
    return res.status(201).json({ policy });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const payload = { error: status === 500 ? "voice_delivery_policy_failed" : String(error.code || error.message) };
    if (error?.details && status < 500) payload.details = error.details;
    return res.status(status).json(payload);
  }
}

export const config = { maxDuration: 30 };
