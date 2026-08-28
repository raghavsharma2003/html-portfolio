// Owner-only exact-version feedback for private replica turns.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { recordOwnedTurnFeedback } from "./_replica-feedback.js";

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
  if (!allow(ipOf(req), "replica_feedback", 80)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_feedback_user", 160)) return res.status(429).json({ error: "slow_down" });
    const feedback = await recordOwnedTurnFeedback(q, user.id, req.body || {});
    return res.status(201).json({ feedback });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "replica_feedback_failed" : String(error.code || error.message) });
  }
}

