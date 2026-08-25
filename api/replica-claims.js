// Owner-only cited claim extraction. Raw transcripts never leave the server
// response boundary and model proposals can only enter as review-pending.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { createProductionClaimExtractor } from "./_claim-extraction/registry.js";
import { extractOwnedClaims, ownedClaimExtractionStatus } from "./_replica-claims.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "replica_claims", 20)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_claims_user", 30)) return res.status(429).json({ error: "slow_down" });
    if (req.method === "GET") {
      const extraction = await ownedClaimExtractionStatus(q, user.id, req.query?.replica_id);
      return extraction ? res.status(200).json({ extraction }) : res.status(404).json({ error: "replica_not_found" });
    }
    const body = req.body || {};
    if (body.op !== "extract") return res.status(400).json({ error: "unknown_op" });
    const controller = new AbortController();
    req.on?.("close", () => controller.abort(new Error("client_closed")));
    const extractor = createProductionClaimExtractor();
    const run = await extractOwnedClaims(q, user.id, body.replica_id, extractor, controller.signal);
    return run ? res.status(200).json({ run }) : res.status(404).json({ error: "replica_not_found" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "claim_extraction_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  }
}
