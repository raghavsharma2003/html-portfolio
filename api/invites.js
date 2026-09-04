// Creator invites - the HTTP half of WS-R23 (migration 086).
//
//   OPERATOR ONLY (bearer token, OPS_OWNER_USER_IDS)
//     POST {op:"issue",  contact?, application_id?, ttl_days?}
//     POST {op:"list",   status?, limit?}
//     POST {op:"revoke", invite_id}
//     POST {op:"erase",  invite_id}
//
// Nothing here is public: creating a code is an operator action from the
// first line of the workstream brief, and redeeming one happens inside
// api/replica.js's own create path, never through this file. Thin by
// construction: cors, rate limit, auth, dispatch, error shape. Every
// decision lives in api/_invites.js, where a fake `db` can reach it.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { requireUser, AuthError } from "./_auth.js";
import {
  InvitesError,
  requireOperator,
  issueInvite,
  listInvites,
  revokeInvite,
  eraseInvite,
} from "./_invites.js";

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
  if (!allow(ipOf(req), "invites_ip", 30)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  const op = String(body.op || "");

  try {
    const user = await requireUser(req);
    requireOperator(user.id);
    if (!allow(user.id, "invites_operator", 60)) return res.status(429).json({ error: "slow_down" });

    if (op === "issue") {
      const result = await issueInvite(q, user.id, {
        contact: body.contact,
        applicationId: body.application_id,
        ttlDays: body.ttl_days,
      });
      // The one response that carries the plaintext code. Never logged,
      // never returned again by any other op.
      return res.status(201).json(result);
    }
    if (op === "list") {
      const invites = await listInvites(q, { status: body.status, limit: body.limit });
      return res.status(200).json({ invites });
    }
    if (op === "revoke") {
      return res.status(200).json({ invite: await revokeInvite(q, body.invite_id) });
    }
    if (op === "erase") {
      return res.status(200).json(await eraseInvite(q, body.invite_id));
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof InvitesError) return res.status(error.status).json({ error: error.code });
    if (error instanceof AuthError) return res.status(error.status || 401).json({ error: error.code });
    console.error("[invites] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "invites_failure" });
  }
}
