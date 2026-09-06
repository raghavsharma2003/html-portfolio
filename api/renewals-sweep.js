// The renewal reminder sweep (WS-R37, migration 099). Daily: a subscription
// due within the next 7 days gets one visit, across whichever channels
// apply to its subject kind - `api/checkins-sweep.js`'s own shape (cron
// auth, `withSweepRun` heartbeat, `fetch` passed explicitly for the web
// push and Telegram deliverers).
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import { sweep } from "./_renewals.js";
// WS-R75 (migration 119). "The daily sweep (WS-R37's own cron) gains two
// statements" — this workstream's own law 2 — folded into THIS handler
// rather than a second cron entry: `dormancySweep` runs alongside, never
// instead of, the renewal work below, and both summaries land in the SAME
// "renewals" vy_sweep_run row (`dormancyThisWeek`, api/_dormancy.js, reads
// that row's own 7-day history rather than a dedicated ledger).
import { dormancySweep } from "./_dormancy.js";
import { withSweepRun } from "./_sweep-run.js";

// A network call per due row across up to three channels, so this needs
// more headroom than a pure-SQL sweep - `api/checkins-sweep.js`'s own
// number, restated for the identical reason.
export const config = { maxDuration: 120 };

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
    // WS-R21: the ops board's heartbeat (migration 084), `api/checkins-
    // sweep.js`'s own call shape. `fetch` is required, explicitly, by the
    // web push deliverer - never a fallback to a global on its own.
    const summary = await withSweepRun(q, "renewals", async () => {
      const runAt = Date.now();
      const deps = { db: q, env: process.env, fetch: globalThis.fetch };
      const renewals = await sweep(deps, runAt);
      // WS-R75: the dormancy sweep is gated on its own env var
      // (`ROOM_DORMANCY`), never on this cron existing — with the flag off
      // it returns `{dormancyDisabled: true, ...zeros}` and runs neither of
      // its two statements, so a database with migration 119 unapplied or
      // the flag off pays no extra cost here at all.
      const dormancy = await dormancySweep(deps, runAt);
      return { ...renewals, ...dormancy };
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "renewals_sweep_failed" : error.code || error.message });
  }
}

export default withDoor(q, "renewals-sweep.js", handler);
