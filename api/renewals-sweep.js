// The renewal reminder sweep (WS-R37, migration 099). Daily: a subscription
// due within the next 7 days gets one visit, across whichever channels
// apply to its subject kind - `api/checkins-sweep.js`'s own shape (cron
// auth, `withSweepRun` heartbeat, `fetch` passed explicitly for the web
// push and Telegram deliverers).
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { sweep } from "./_renewals.js";
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    // WS-R21: the ops board's heartbeat (migration 084), `api/checkins-
    // sweep.js`'s own call shape. `fetch` is required, explicitly, by the
    // web push deliverer - never a fallback to a global on its own.
    const summary = await withSweepRun(q, "renewals", () => sweep({ db: q, env: process.env, fetch: globalThis.fetch }, Date.now()));
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "renewals_sweep_failed" : error.code || error.message });
  }
}
