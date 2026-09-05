// The scheduled half of the Suite admin's weekly note (WS-R127, migration
// 132) - `api/creator-push-sweep.js`'s own shape, restated for the admin
// lane. Runs at 0 5 * * 1, an hour after creator-push-sweep (0 4 * * 1),
// which itself runs an hour after pulse-sweep (0 3 * * 1) - this note reads
// no Pulse data at all (see api/_org-weekly-note.js's own header), so it has
// no ordering dependency on either sweep; the hour of headroom is kept
// anyway, this workstream's own convention rather than a real requirement,
// so a slow Monday morning never has two heavy weekly sweeps racing the
// same minute.
//
// Cron auth mirrors pulse-sweep.js/creator-push-sweep.js and the rest of the
// */N-minute and hourly family: a constant-time comparison against
// CRON_SECRET, which Vercel itself sends as `Authorization: Bearer
// $CRON_SECRET` when the env var is configured. No secret configured means
// no path in, ever.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import {
  sendOrgWeeklyNotes,
  orgAdminUserIds,
  buildOrgWeeklyNote,
} from "./_org-weekly-note.js";
import { creatorPushSubscriptionsFor, revokeCreatorPushById } from "./_creator-push.js";
import { withSweepRun } from "./_sweep-run.js";

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
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
    const summary = await withSweepRun(q, "org-weekly-note", () =>
      sendOrgWeeklyNotes(q, {
        limit,
        orgAdminUserIds: (orgId) => orgAdminUserIds(q, orgId),
        creatorPushSubscriptionsFor: (ownerUserId) => creatorPushSubscriptionsFor(q, ownerUserId),
        revokeCreatorPushSubscription: (db, id) => revokeCreatorPushById(db, id),
        buildOrgWeeklyNote: (db, org, now) => buildOrgWeeklyNote(db, org, now),
      }));
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "org_weekly_note_sweep_failed" : error.code || error.message });
  }
}
