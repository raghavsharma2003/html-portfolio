import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { grantAccountConsent, grantVerifiedModelConsent, listOwnedConsent, revokeOwnedConsent } from "./_replica-consent.js";
import { configuredFaceSessionErasureBroker } from "./_face-session/registry.js";
import { deleteOwnedFaceSessionNow } from "./_replica-face-session.js";

export const config = { maxDuration: 60 };

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
    if (body.op === "grant_verified_model") {
      const consents = await grantVerifiedModelConsent(q, user.id, body.replica_id, body);
      return res.status(201).json({ consents });
    }
    if (body.op === "list") {
      return res.status(200).json({ consents: await listOwnedConsent(q, user.id, body.replica_id) });
    }
    if (body.op === "revoke") {
      const consents = await revokeOwnedConsent(q, user.id, body.replica_id, body.scopes);
      const sourceErasure = Array.isArray(body.scopes)
        && body.scopes.some((scope) => scope === "capture" || scope === "storage");
      const biometricWithdrawal = Array.isArray(body.scopes)
        && body.scopes.some((scope) => ["capture", "storage", "biometric"].includes(scope));
      let providerSessionErasure = biometricWithdrawal ? "pending" : "not_required";
      if (consents.length && biometricWithdrawal) {
        try {
          const broker = configuredFaceSessionErasureBroker();
          const deleted = broker
            ? await deleteOwnedFaceSessionNow(q, user.id, body.replica_id, null, broker, {
              providerTimeoutMs: 12_000,
            })
            : null;
          providerSessionErasure = deleted ? "confirmed" : "pending";
        } catch {
          providerSessionErasure = "pending";
        }
      }
      return consents.length
        ? res.status(200).json({
          consents,
          replica_state: "non_operational",
          provider_session_erasure: providerSessionErasure,
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
