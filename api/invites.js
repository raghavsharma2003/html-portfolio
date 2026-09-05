// Creator invites - the HTTP half of WS-R23 (migration 086) and WS-R47
// (migration 106).
//
//   OPERATOR ONLY (bearer token, OPS_OWNER_USER_IDS)
//     POST {op:"issue",  contact?, application_id?, ttl_days?}
//     POST {op:"list",   status?, limit?}
//     POST {op:"revoke", invite_id}
//     POST {op:"erase",  invite_id}
//
//   ANY SIGNED-IN CREATOR (bearer token, no allowlist - WS-R47)
//     POST {op:"mine_issue", contact?, ttl_days?}
//     POST {op:"mine_list"}
//
// Nothing here is public: creating a code is either an operator action or a
// creator acting on their own account, never an anonymous one, and redeeming
// one happens inside api/replica.js's own create path, never through this
// file. Thin by construction: cors, rate limit, auth, dispatch, error shape.
// Every decision lives in api/_invites.js, where a fake `db` can reach it.
//
// The owner ops are dispatched BEFORE `requireOperator` runs, on purpose:
// they are not an operator capability at all, and gating them behind an
// operator check first would make every creator without OPS_OWNER_USER_IDS
// membership see `operator_only` before ever reaching their own two ops.
// `user.id` - the verified bearer's own id, never an `issued_by_user_id`
// field the client could put in the request body - is the only identity
// either owner op ever passes down, the same "identity comes only from the
// verified token" law `requireOperator`'s own doc comment states for the
// operator path.
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
  issueCreatorInvite,
  myInvites,
} from "./_invites.js";
import { withDoor } from "./_incidents.js";

const OWNER_OPS = new Set(["mine_issue", "mine_list"]);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "invites_ip", 30)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  const op = String(body.op || "");

  try {
    const user = await requireUser(req);

    if (OWNER_OPS.has(op)) {
      if (!allow(user.id, "invites_owner", 30)) return res.status(429).json({ error: "slow_down" });
      if (op === "mine_issue") {
        const result = await issueCreatorInvite(q, user.id, {
          contact: body.contact,
          ttlDays: body.ttl_days,
        });
        // Same law as the operator issue response below: the one moment the
        // plaintext code exists outside the creator's own clipboard.
        return res.status(201).json(result);
      }
      // op === "mine_list"
      return res.status(200).json(await myInvites(q, user.id));
    }

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

// WS-R58 (migration 109). See api/room.js's own comment for what this does.
export default withDoor(q, "invites.js", handler);
