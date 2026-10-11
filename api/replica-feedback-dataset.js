// Owner-only construction of a content-free, leakage-safe feedback manifest.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { buildOwnedFeedbackDataset, readOwnedFeedbackDatasetReview } from "./_replica-feedback-dataset.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  const reading = req.method === "GET";
  if (!allow(ipOf(req), reading ? "replica_feedback_dataset_read" : "replica_feedback_dataset", reading ? 60 : 12)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, reading ? "replica_feedback_dataset_read_user" : "replica_feedback_dataset_user", reading ? 100 : 20)) return res.status(429).json({ error: "slow_down" });
    if (reading) return res.status(200).json({ review: await readOwnedFeedbackDatasetReview(q, user.id, req.query?.replica_id) });
    const result = await buildOwnedFeedbackDataset(q, user.id, req.body?.replica_id, req.body?.expected_source_set_hash);
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "feedback_dataset_failed" : String(error.code || error.message), ...(status < 500 && error.details ? { details: error.details } : {}) });
  }
}
