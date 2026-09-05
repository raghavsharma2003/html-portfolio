// GET  /api/ops - the platform-operator ops board (WS-R21).
// POST /api/ops {op:"push_subscribe"|"push_revoke", ...}  - the operator's
//      own browser push subscription (WS-R62, migration 114).
//
// Thin by construction: auth and dispatch live here, every decision lives in
// api/_ops.js where evals/ops/run.mjs (and evals/room-doors/run.mjs's own
// class (e)) can reach it with a fake db.
//
// LAW 1, restated at the one place that enforces it: platform-operator only,
// 404 by name for everyone else, checked in this order -
//   1. is OPS_OWNER_USER_IDS configured AT ALL - unset means 404 for every
//      caller, before a bearer token is even read.
//   2. resolve the caller's identity through the SAME bearer path
//      api/replica.js uses (api/_auth.js's requireUser) - never a second
//      auth system.
//   3. is THIS user's id on the allowlist - not on it gets the identical 404
//      a signed-out stranger gets, never 403, so the board's existence is
//      never disclosed to anyone it is not for.
//
// LAW 2 (WS-R62): law 1's step 3 is a courtesy 404, not the write's own
// gate. `subscribeOperatorPush`/`revokeOperatorPush` (api/_ops.js) decide
// whether a row is written or revoked in their OWN SQL's WHERE clause,
// with `OPS_OWNER_USER_IDS` passed as a parameter - so even if this door's
// own `isOpsOwner` check above it were ever wrong, no row for a
// non-operator id could result. See api/_ops.js's own header on this
// section for the full argument and `evals/room-doors/run.mjs`'s class (e)
// negative control that exercises it directly, bypassing this door.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  opsBoardConfigured,
  isOpsOwner,
  opsOverview,
  subscribeOperatorPush,
  revokeOperatorPush,
  OpsPushError,
  operatorPushSubscriptionsFor,
  revokeOperatorPushById,
} from "./_ops.js";
// WS-R88 (migration 125). "Send a test digest now" - the ops board's own
// operator op, cased below alongside push_subscribe/push_revoke.
import { sendTestOperatorDigest } from "./_operator-digest.js";
import { bodyTooLarge, ROOM_DOOR_BODY_CAP_BYTES } from "./_room-surface.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "ops", 30)) return res.status(429).json({ error: "slow_down" });

  // Checked before any bearer token is read: an unconfigured board is not a
  // 401 or a 403, it is not here.
  if (!opsBoardConfigured()) return res.status(404).json({ error: "not_found" });

  try {
    const user = await requireUser(req);
    if (!isOpsOwner(user.id)) return res.status(404).json({ error: "not_found" });

    if (req.method === "GET") {
      const overview = await opsOverview(q, Date.now());
      return res.status(200).json({ ok: true, ...overview });
    }

    const body = req.body || {};
    // WS-R89: the one shared cap every POST door checks first.
    if (bodyTooLarge(body, ROOM_DOOR_BODY_CAP_BYTES)) return res.status(413).json({ error: "body_too_large" });
    const op = String(body.op || "");

    if (op === "push_subscribe") {
      const result = await subscribeOperatorPush(q, user.id, {
        endpoint: body.endpoint,
        p256dh: body.p256dh,
        auth: body.auth,
      });
      return res.status(200).json(result);
    }
    if (op === "push_revoke") {
      const result = await revokeOperatorPush(q, user.id, body.endpoint);
      return res.status(200).json(result);
    }
    // WS-R88 (migration 125). Sends to the CALLER's own subscription(s)
    // only, marked as a test, and writes no ledger row -
    // api/_operator-digest.js#sendTestOperatorDigest's own header.
    if (op === "send_test_digest") {
      const result = await sendTestOperatorDigest(q, user.id, {
        opsOverviewFn: (db, now) => opsOverview(db, now),
        operatorSubscriptionsFor: (db, ownerId) => operatorPushSubscriptionsFor(db, ownerId),
        revokeOperatorSubscription: (db, id) => revokeOperatorPushById(db, id),
      });
      return res.status(200).json(result);
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    // A dead/missing session gets the same non-answer as a wrong user id -
    // the board never distinguishes "you are not signed in" from "you are
    // not the operator" for anyone who is not the operator.
    if (error instanceof AuthError) return res.status(404).json({ error: "not_found" });
    if (error instanceof OpsPushError) return res.status(error.status).json({ error: error.code });
    return res.status(500).json({ error: "ops_overview_failed" });
  }
}
