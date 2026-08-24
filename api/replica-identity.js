import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  latestOwnedIdentityCase,
  revokeOwnedIdentityCase,
  submitOwnedIdentityCase,
} from "./_replica-identity.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "replica_identity", 20)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_identity_user", 12)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};
    if (body.op === "status") {
      return res.status(200).json({ identity_case: await latestOwnedIdentityCase(q, user.id, body.replica_id) });
    }
    if (body.op === "submit") {
      const identityCase = await submitOwnedIdentityCase(q, user.id, body.replica_id, body);
      return identityCase
        ? res.status(201).json({ identity_case: identityCase })
        : res.status(409).json({ error: "identity_case_not_authorized_or_daily_limit" });
    }
    if (body.op === "revoke") {
      const identityCase = await revokeOwnedIdentityCase(q, user.id, body.replica_id, body.identity_case_id);
      return identityCase
        ? res.status(202).json({ identity_case: identityCase, source_erasure: "pending" })
        : res.status(404).json({ error: "identity_case_not_found" });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "identity_failure" : error.code || error.message });
  }
}
