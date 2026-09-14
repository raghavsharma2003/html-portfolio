// The scheduled half of drift watch — every replica with an active runtime
// capability, recomputed, and a row written only when it changed. WS-R9.
//
// Cron auth mirrors api/replica-voice-identity-sweep.js and the rest of the
// */5-minute family: a constant-time comparison against CRON_SECRET, which
// Vercel itself sends as `Authorization: Bearer $CRON_SECRET` when the env
// var is configured (https://vercel.com/docs/cron-jobs). No secret configured
// means no path in, ever — never open by accident.
//
// Every tick is cheap and side-effect-free beyond the guarded write: three
// small SQL reads and one local file read per replica, no model call, no
// network call, no GPU wake. `maxDuration` is well under the default because
// nothing here waits on anything slow — the whole point of watching drift
// through stored evidence rather than synthesizing fresh audio is that this
// sweep never has to pay for a cold GPU to ask "did anything change".
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import { runDriftWatchSweep } from "./_drift-watch.js";
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
    // WS-R21: the ops board's heartbeat (migration 084). Wraps the call, not
    // the response - `summary` is returned to the caller byte-identical to
    // before this change.
    const summary = await withSweepRun(q, "drift-watch", () => runDriftWatchSweep({ db: q, limit }));
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "drift_watch_sweep_failed" : error.code || error.message });
  }
}

export default withDoor(q, "drift-watch-sweep.js", handler);
