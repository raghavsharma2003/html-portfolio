// The scheduled half of the follower's monthly note (WS-R137, migration
// 136) - `api/org-weekly-note-sweep.js`'s own shape, restated for the
// follower lane. Runs DAILY (`0 6 * * *`), not monthly: the due-select
// (`api/_room-month-note.js#dueFollowerMonthNoteCandidates`) is idempotent
// by absence (a follower who already has a row for the target month is
// never re-selected) and quiet-hours-gated (a follower inside their own
// quiet window this tick is simply left for tomorrow) - a daily cadence is
// what makes "left for tomorrow" actually mean something, rather than a
// follower who is asleep on the 1st of the month never getting that month's
// note at all.
//
// Cron auth mirrors org-weekly-note-sweep.js/checkins-sweep.js and the rest
// of this family: a constant-time comparison against CRON_SECRET, which
// Vercel itself sends as `Authorization: Bearer $CRON_SECRET` when the env
// var is configured. No secret configured means no path in, ever.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { sendFollowerMonthNotes } from "./_room-month-note.js";
import { withSweepRun } from "./_sweep-run.js";
import { withDoor } from "./_incidents.js";

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
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit) || 200));
    const summary = await withSweepRun(q, "room-month-note", () => sendFollowerMonthNotes(q, { limit }));
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "room_month_note_sweep_failed" : error.code || error.message });
  }
}

// WS-R123: every derived cron door is wrapped, and evals/incidents/run.mjs
// fails by name on one that is not.
export default withDoor(q, "room-month-note-sweep.js", handler);
