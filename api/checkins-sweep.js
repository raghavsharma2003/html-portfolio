// The scheduled half of check-ins - every active, due, paid-tier follower
// schedule, delivered once through the ONE reply door (WS-R16).
//
// Cron auth mirrors api/drift-watch-sweep.js and the rest of the */5-minute
// family: a constant-time comparison against CRON_SECRET, which Vercel
// itself sends as `Authorization: Bearer $CRON_SECRET` when the env var is
// configured (https://vercel.com/docs/cron-jobs). No secret configured means
// no path in, ever.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { sweep } from "./_checkins.js";
import { loadTeacherAgent } from "./_teachersheet.js";

// A model call per due row, so this needs more headroom than drift watch's
// pure-SQL sweep - bounded well under Vercel's own hard ceiling.
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
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
    // `fetch` is required, explicitly, by `deliverers.webPush` (WS-R22) — the
    // module never falls back to a global on its own, so a caller that
    // forgets this line gets a loud throw rather than a silent skip. The
    // platform's own global `fetch` is the real one here; only an eval
    // injects a fake.
    const summary = await sweep({ db: q, limit, loadAgent: loadTeacherAgent, fetch: globalThis.fetch }, Date.now());
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "checkins_sweep_failed" : error.code || error.message });
  }
}
