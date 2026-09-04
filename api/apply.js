// Creator applications - the HTTP half of WS-R23 (migration 086).
//
//   PUBLIC (no auth)
//     POST {op:"submit", name, archive_link, audience, contact}
//
//   OPERATOR (bearer token, OPS_OWNER_USER_IDS)
//     POST {op:"list",  status?, limit?}
//     POST {op:"erase", contact}
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape. Every
// decision lives in api/_apply.js / api/_invites.js, where a fake `db` can
// reach it - api/checkins.js is this file's own pattern.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { consume } from "./_rate-limit.js";
import { requireUser, AuthError } from "./_auth.js";
import { ApplyError, submitApplication, listApplications, eraseApplicationsByContact } from "./_apply.js";
import { InvitesError, requireOperator } from "./_invites.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = req.body || {};
  const op = String(body.op || "submit");

  try {
    if (op === "submit") {
      if (!allow(ipOf(req), "apply_ip", 10)) return res.status(429).json({ error: "slow_down" });
      // WS-R26: the persistent second layer - the in-memory gate above
      // resets on a cold start, this one does not.
      const gate = await consume(q, { scope: "apply_submit_ip", key: ipOf(req) });
      if (!gate.ok) {
        res.setHeader("Retry-After", String(gate.retryAfterSeconds));
        return res.status(429).json({ error: gate.code, retry_after_seconds: gate.retryAfterSeconds });
      }
      const application = await submitApplication(q, body);
      return res.status(201).json({ application });
    }

    // Every other op is operator-only. Identity comes from the verified
    // bearer token alone, never from anything in the request body.
    const user = await requireUser(req);
    requireOperator(user.id);
    if (!allow(user.id, "apply_operator", 60)) return res.status(429).json({ error: "slow_down" });

    if (op === "list") {
      const applications = await listApplications(q, { status: body.status, limit: body.limit });
      return res.status(200).json({ applications });
    }
    if (op === "erase") {
      return res.status(200).json(await eraseApplicationsByContact(q, body.contact));
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof ApplyError) return res.status(error.status).json({ error: error.code });
    if (error instanceof InvitesError) return res.status(error.status).json({ error: error.code });
    if (error instanceof AuthError) return res.status(error.status || 401).json({ error: error.code });
    console.error("[apply] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "apply_failure" });
  }
}
