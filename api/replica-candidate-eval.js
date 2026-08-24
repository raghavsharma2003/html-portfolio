// Owner-only blinded candidate evaluation. Candidate identity and A/B mapping
// never cross this boundary.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  loadOwnedCandidateEvaluation,
  recordOwnedCandidateJudgment,
} from "./_replica-candidate-eval.js";

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
  if (!allow(ipOf(req), "replica_candidate_eval", 90)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_candidate_eval_user", 180)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};
    if (body.op === "status") {
      return res.status(200).json({ evaluation: await loadOwnedCandidateEvaluation(q, user.id, body.replica_id) });
    }
    if (body.op === "judge") {
      const result = await recordOwnedCandidateJudgment(q, user.id, body);
      return res.status(201).json({ result });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "candidate_eval_failed" : String(error.code || error.message),
    });
  }
}
