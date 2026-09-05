// The scheduled half of the operator's morning digest (WS-R88, migration
// 125) - `api/creator-push-sweep.js`'s own shape. Runs at 03:15 UTC, AFTER
// the self-check at 02:30 (`vercel.json`) so the digest can carry that
// morning's own self-check verdict rather than yesterday's.
//
// Cron auth mirrors self-check.js/creator-push-sweep.js and the rest of
// this family: a constant-time comparison against CRON_SECRET, which
// Vercel itself sends as `Authorization: Bearer $CRON_SECRET` when the env
// var is configured. No secret configured means no path in, ever.
//
// Thin by construction: auth and dispatch live here, every decision lives
// in api/_operator-digest.js where evals/operator-digest/run.mjs can reach
// it with a fake db. This is the ONE place `api/_ops.js` and
// `api/_operator-digest.js` are both imported and wired together - see
// api/_operator-digest.js's own header on why neither imports the other.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { opsOverview, operatorPushSubscriptionsFor, revokeOperatorPushById } from "./_ops.js";
import { sendOperatorDigest } from "./_operator-digest.js";
import { withSweepRun } from "./_sweep-run.js";

// A handful of already-fetched ops-board reads plus, at most, one insert and
// a few dozen pushes on a bad morning - well under the default.
export const config = { maxDuration: 60 };

function authorized(req) {
  const expected = Buffer.from(String(process.env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    // WS-R21: the ops board's own heartbeat (migration 084).
    const summary = await withSweepRun(q, "operator-digest", () =>
      sendOperatorDigest(q, {
        opsOverviewFn: (db, now) => opsOverview(db, now),
        operatorSubscriptionsFor: (db, ownerId) => operatorPushSubscriptionsFor(db, ownerId),
        revokeOperatorSubscription: (db, id) => revokeOperatorPushById(db, id),
        // WS-R98: the digest's own Telegram fallback, best-effort, beside
        // the push - `api/checkins-sweep.js`'s own `fetch: globalThis.fetch`
        // line, restated.
        fetch: globalThis.fetch,
      }));
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    return res.status(500).json({ error: "operator_digest_sweep_failed" });
  }
}
