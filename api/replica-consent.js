import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { grantAccountConsent, listOwnedConsent, revokeOwnedConsent } from "./_replica-consent.js";

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
  if (!allow(ipOf(req), "replica_consent", 30)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_consent_user", 30)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};

    if (body.op === "grant") {
      const consents = await grantAccountConsent(q, user.id, body.replica_id, body);
      return consents.length
        ? res.status(201).json({ consents })
        : res.status(404).json({ error: "replica_not_found" });
    }
    if (body.op === "list") {
      return res.status(200).json({ consents: await listOwnedConsent(q, user.id, body.replica_id) });
    }
    if (body.op === "revoke") {
      const consents = await revokeOwnedConsent(q, user.id, body.replica_id, body.scopes);
      const sourceErasure = Array.isArray(body.scopes)
        && body.scopes.some((scope) => scope === "capture" || scope === "storage");
      return consents.length
        ? res.status(200).json({
          consents,
          replica_state: "non_operational",
          ...(sourceErasure ? { source_erasure: "pending" } : {}),
        })
        : res.status(404).json({ error: "active_consent_not_found" });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "consent_failure" : error.message });
  }
}
