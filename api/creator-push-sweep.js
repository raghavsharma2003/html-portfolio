// The scheduled half of the creator's weekly push (WS-R74, migration 118) -
// `api/pulse-sweep.js`'s own shape. Runs AFTER pulse-sweep (0 3 * * 1) so
// this week's Pulse snapshot exists before this sweep reads it for the
// push's own headline (`api/_creator-push.js#pulseHeadlineFor`); 0 4 * * 1
// gives pulse-sweep a full hour to finish first.
//
// Cron auth mirrors pulse-sweep.js and the rest of the */N-minute and
// hourly family: a constant-time comparison against CRON_SECRET, which
// Vercel itself sends as `Authorization: Bearer $CRON_SECRET` when the env
// var is configured. No secret configured means no path in, ever.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import {
  sendCreatorWeeklyPushes,
  creatorPushSubscriptionsFor,
  revokeCreatorPushById,
} from "./_creator-push.js";
import { withSweepRun } from "./_sweep-run.js";

export const config = { maxDuration: 60 };

function authorized(req) {
  const expected = Buffer.from(String(process.env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
    // WS-R21: the ops board's heartbeat (migration 084).
    const summary = await withSweepRun(q, "creator-push", () =>
      sendCreatorWeeklyPushes(q, {
        limit,
        creatorPushSubscriptionsFor: (ownerUserId) => creatorPushSubscriptionsFor(q, ownerUserId),
        revokeCreatorPushSubscription: (db, id) => revokeCreatorPushById(db, id),
      }));
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "creator_push_sweep_failed" : error.code || error.message });
  }
}

export default withDoor(q, "creator-push-sweep.js", handler);
