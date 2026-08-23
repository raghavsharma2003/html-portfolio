// Owner-only construction of a content-free, leakage-safe feedback manifest.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { buildOwnedFeedbackDataset } from "./_replica-feedback-dataset.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "replica_feedback_dataset", 12)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_feedback_dataset_user", 20)) return res.status(429).json({ error: "slow_down" });
    const dataset = await buildOwnedFeedbackDataset(q, user.id, req.body?.replica_id);
    return res.status(201).json({ dataset });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "feedback_dataset_failed" : String(error.code || error.message), ...(status < 500 && error.details ? { details: error.details } : {}) });
  }
}

