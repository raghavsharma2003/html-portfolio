// GET /api/ops - the platform-operator ops board (WS-R21).
//
// Thin by construction: auth and dispatch live here, every decision lives in
// api/_ops.js where evals/ops/run.mjs can reach it with a fake db.
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
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { opsBoardConfigured, isOpsOwner, opsOverview } from "./_ops.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!allow(ipOf(req), "ops", 30)) return res.status(429).json({ error: "slow_down" });

  // Checked before any bearer token is read: an unconfigured board is not a
  // 401 or a 403, it is not here.
  if (!opsBoardConfigured()) return res.status(404).json({ error: "not_found" });

  try {
    const user = await requireUser(req);
    if (!isOpsOwner(user.id)) return res.status(404).json({ error: "not_found" });
    const overview = await opsOverview(q, Date.now());
    return res.status(200).json({ ok: true, ...overview });
  } catch (error) {
    // A dead/missing session gets the same non-answer as a wrong user id -
    // the board never distinguishes "you are not signed in" from "you are
    // not the operator" for anyone who is not the operator.
    if (error instanceof AuthError) return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: "ops_overview_failed" });
  }
}
